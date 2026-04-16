import mongoose from 'mongoose';
import { generateRecoveryToken } from '../utils/recoveryToken.js';

// ============================================
// ENV HELPERS
// ============================================

const cfg = {
  maxAttempts:   () => parseInt(process.env.MAX_RECOVERY_ATTEMPTS)      || 3,
  cooldownHours: () => parseInt(process.env.RECOVERY_COOLDOWN_HOURS)    || 0,
  maxAgeDays:    () => 7,
  tokenTTL:      () => parseInt(process.env.RECOVERY_TOKEN_TTL_SECONDS) || 72 * 60 * 60,
  staleAckMins:  () => parseInt(process.env.RECOVERY_STALE_ACK_MINS)    || 10,
};

// ============================================
// ATTEMPT SUB-SCHEMA
// ============================================

const attemptSchema = new mongoose.Schema(
  {
    attemptNumber: {
      type:     Number,
      required: true,
    },

    status: {
      type:    String,
      enum:    ['pending', 'sent', 'failed'],
      default: 'pending',
    },

    // Attribution: 'cron' is the only sender now that admin sends are removed.
    // Kept as an enum field so historical 'admin' records remain readable.
    sentBy: {
      type:    String,
      enum:    ['admin', 'cron'],
      default: 'cron',
    },

    initiatedAt: { type: Date, default: Date.now },
    sentAt:      Date,
    failReason:  String,

    token: {
      type:   String,
      select: false,
    },

    tokenId:        String,
    tokenIssuedAt:  Date,
    tokenExpiresAt: Date,

    // True when the cron sweep marks this token expired without a click.
    tokenExpiredUnclicked: { type: Boolean, default: false },

    // True when the user clicked the link AFTER the JWT had already expired.
    // Distinct from tokenExpiredUnclicked — that flag means they never came;
    // this flag means they came late. Both can coexist on the same attempt
    // if the cron sweeps first and then the user clicks.
    clickedAfterExpiry: { type: Boolean, default: false },

    linkClickedAt:  Date,
    linkClickCount: { type: Number, default: 0 },

    checkoutStepAtClick: String,
  },
  { _id: true }
);

// ============================================
// RECOVERY EMAIL SCHEMA
// ============================================

const recoveryEmailSchema = new mongoose.Schema(
  {
    checkout: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Checkout',
      required: true,
      index:    true,
    },
    user: {
      type:  mongoose.Schema.Types.ObjectId,
      ref:   'User',
      index: true,
    },
    email: {
      type:     String,
      required: true,
      index:    true,
    },

    attempts: {
      type:     [attemptSchema],
      default:  [],
      validate: {
        validator: function (v) { return v.length <= 10; },
        message:   'Attempt log cannot exceed 10 entries',
      },
    },

    confirmedAttempts: { type: Number, default: 0 },
    pendingAck:        { type: Boolean, default: false, index: true },
    lastSentAt:        { type: Date, index: true },
    lastTokenId:       String,
    totalLinkClicks:   { type: Number, default: 0, index: true },
    lastClickedAttemptNumber: Number,

    cartSnapshot: {
      items: [{
        product:  mongoose.Schema.Types.ObjectId,
        name:     String,
        price:    Number,
        quantity: Number,
        image:    String,
      }],
      pricing: {
        itemPrice:      Number,
        taxPrice:       Number,
        shippingPrice:  Number,
        totalPrice:     Number,
        discountCode:   String,
        discountAmount: Number,
        currency:       { type: String, default: 'USD' },
      },
      customerName: String,
      snapshotAt:   Date,
    },

    outcome: {
      type:    String,
      enum:    [
        'pending', 'sent', 'clicked',
        'converted', 'organic', 're_abandoned',
        'expired', 'exhausted', 'failed',
      ],
      default: 'pending',
      index:   true,
    },
    resolvedAt: Date,
  },
  {
    timestamps: true,
    toJSON:  { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ============================================
// INDEXES
// ============================================

recoveryEmailSchema.index(
  { checkout: 1 },
  { unique: true, name: 'checkout_unique_idx' }
);

recoveryEmailSchema.index(
  { outcome: 1, confirmedAttempts: 1, lastSentAt: -1 },
  { name: 'send_page_list_idx' }
);

recoveryEmailSchema.index(
  { outcome: 1, createdAt: -1 },
  { name: 'outcome_created_idx' }
);

recoveryEmailSchema.index(
  { pendingAck: 1, updatedAt: -1 },
  { name: 'pending_ack_sweep_idx' }
);

recoveryEmailSchema.index(
  { 'attempts.tokenId': 1 },
  { name: 'attempt_token_idx' }
);

recoveryEmailSchema.index(
  { email: 1, outcome: 1 },
  { name: 'email_outcome_idx' }
);

recoveryEmailSchema.index(
  { outcome: 1, lastSentAt: 1, confirmedAttempts: 1 },
  { name: 'cron_eligibility_idx' }
);

// ============================================
// VIRTUALS
// ============================================

recoveryEmailSchema.virtual('lastAttempt').get(function () {
  if (!this.attempts?.length) return null;
  return this.attempts[this.attempts.length - 1];
});

recoveryEmailSchema.virtual('everClicked').get(function () {
  return (this.attempts || []).some(a => !!a.linkClickedAt);
});

recoveryEmailSchema.virtual('nextAvailableAt').get(function () {
  if (!this.lastSentAt) return null;
  return new Date(
    this.lastSentAt.getTime() + cfg.cooldownHours() * 60 * 60 * 1000
  );
});

// ============================================
// INSTANCE METHODS
// ============================================

/**
 * canSend
 * Single gate for all send decisions. Called by cron only.
 */
recoveryEmailSchema.methods.canSend = function (checkout) {
  if (checkout.conversion?.isConverted) {
    return { canSend: false, reason: 'Checkout already converted' };
  }

  const ACTIVE_OUTCOMES = ['pending', 'sent', 'clicked', 're_abandoned'];
  if (!ACTIVE_OUTCOMES.includes(this.outcome)) {
    return {
      canSend: false,
      reason:  `Recovery campaign already resolved: ${this.outcome}`,
    };
  }

  if (this.pendingAck) {
    const staleThreshold = new Date(
      Date.now() - cfg.staleAckMins() * 60 * 1000
    );
    const isStale = this.updatedAt && this.updatedAt < staleThreshold;

    if (!isStale) {
      return {
        canSend: false,
        reason:  'A send is already in progress — please retry in a moment.',
      };
    }
  }

  if (this.confirmedAttempts >= cfg.maxAttempts()) {
    return {
      canSend: false,
      reason:  `Maximum recovery attempts (${cfg.maxAttempts()}) reached`,
    };
  }

  if (this.lastSentAt) {
    const hoursSinceLast =
      (Date.now() - this.lastSentAt.getTime()) / (1000 * 60 * 60);

    if (hoursSinceLast < cfg.cooldownHours()) {
      const hoursRemaining = Math.ceil(cfg.cooldownHours() - hoursSinceLast);
      return {
        canSend:         false,
        reason:          `Cooldown active — ${hoursRemaining}h remaining`,
        nextAvailableAt: this.nextAvailableAt,
      };
    }
  }

  const referenceDate =
    checkout.abandonment?.firstAbandonedAt ||
    checkout.abandonment?.abandonedAt;

  if (referenceDate) {
    const daysSince =
      (Date.now() - new Date(referenceDate).getTime()) / (1000 * 60 * 60 * 24);

    if (daysSince > cfg.maxAgeDays()) {
      return {
        canSend: false,
        reason:  `Cart abandoned ${Math.floor(daysSince)} days ago (max ${cfg.maxAgeDays()} days)`,
      };
    }
  }

  if (checkout.expiresAt && new Date(checkout.expiresAt) <= new Date()) {
    return { canSend: false, reason: 'Checkout document has expired' };
  }

  return { canSend: true };
};


/**
 * initiateSend
 * Opens a new attempt slot and generates a signed JWT.
 */
recoveryEmailSchema.methods.initiateSend = function (checkout, sentBy = 'cron') {
  const check = this.canSend(checkout);
  if (!check.canSend) throw new Error(check.reason);

  const attemptNumber   = this.confirmedAttempts + 1;
  const tokenTTLSeconds = this._resolveTokenTTL(checkout);

  const jti = [
    checkout._id.toString(),
    attemptNumber,
    Date.now(),
    Math.random().toString(36).slice(2, 9),
  ].join('-');

  const token = generateRecoveryToken(
    {
      checkoutId: checkout._id,
      userId:     checkout.user?._id?.toString() ?? checkout.user.toString(),
      email:      checkout.email,
    },
    { expiresIn: tokenTTLSeconds, jti }
  );

  const now            = new Date();
  const tokenExpiresAt = new Date(Date.now() + tokenTTLSeconds * 1000);

  this.attempts.push({
    attemptNumber,
    status:        'pending',
    sentBy,
    initiatedAt:   now,
    token,
    tokenId:       jti,
    tokenIssuedAt: now,
    tokenExpiresAt,
  });

  this.lastTokenId = jti;
  this.pendingAck  = true;

  this.takeCartSnapshot(checkout);

  if (this.outcome === 'pending') {
    this.outcome = 'sent';
  }

  if (this.outcome === 'expired') {
    this.outcome = 'sent';
  }

  return token;
};


/**
 * acknowledgeSent
 * Call after the mailer confirms delivery.
 */
recoveryEmailSchema.methods.acknowledgeSent = function () {
  const attempt = this._findAttemptByTokenId(this.lastTokenId, 'pending');

  if (attempt) {
    attempt.status = 'sent';
    attempt.sentAt = new Date();
  }

  this.confirmedAttempts += 1;
  this.lastSentAt         = new Date();
  this.pendingAck         = false;
};


/**
 * recordSendFailure
 * Call when the mailer throws after initiateSend.
 */
recoveryEmailSchema.methods.recordSendFailure = function (reason) {
  const attempt = this._findAttemptByTokenId(this.lastTokenId, 'pending');

  if (attempt) {
    attempt.status     = 'failed';
    attempt.failReason = reason || 'Unknown mailer error';
  }

  this.pendingAck = false;

  if (this.confirmedAttempts === 0) {
    this.outcome = 'pending';
  }

  const allAttemptsFailed = this.attempts.length > 0 &&
    this.attempts.every(a => a.status === 'failed');
  const hitCap = this.attempts.length >= cfg.maxAttempts();

  if (allAttemptsFailed && hitCap) {
    this._resolveOutcome('failed');
  }
};


/**
 * recordLinkClick
 * Call from redeemRecoveryToken after JWT verification succeeds (valid token).
 *
 * KEY FIX: 'exhausted' is intentionally NOT blocked here.
 * exhausted = the cron sent all allowed emails, a send-cap signal.
 * It does NOT mean the user cannot click a token that is still
 * cryptographically valid. If the user clicks before the JWT exp elapses,
 * the full recovery flow should run and outcome should advance to 'clicked'.
 *
 * Only truly expired JWTs (exp claim elapsed) are blocked, and those are
 * handled by recordExpiredLinkClick below, not this method.
 */
recoveryEmailSchema.methods.recordLinkClick = function (tokenId, checkoutStep) {
  const attempt = this._findAttemptByTokenId(tokenId);
  if (!attempt) return null;

  if (!attempt.linkClickedAt) {
    attempt.linkClickedAt = new Date();
  }

  attempt.linkClickCount = (attempt.linkClickCount || 0) + 1;

  this.totalLinkClicks = (this.totalLinkClicks || 0) + 1;

  if (checkoutStep && !attempt.checkoutStepAtClick) {
    attempt.checkoutStepAtClick = checkoutStep;
  }

  this.lastClickedAttemptNumber = attempt.attemptNumber;

  // Advance outcome to 'clicked' for any active or send-capped state.
  // exhausted is included here — it just means no more sends, but a valid
  // token click is a real user action that should be tracked and promoted.
  // The only states that truly block progression are the absolute terminals
  // (converted, organic) and behavioural terminal (re_abandoned), which
  // _resolveOutcome handles via its priority ladder.
  const PROMOTABLE_TO_CLICKED = ['sent', 'pending', 'exhausted', 'expired'];
  if (PROMOTABLE_TO_CLICKED.includes(this.outcome)) {
    this._resolveOutcome('clicked');
  }

  return attempt;
};


/**
 * recordExpiredLinkClick
 * Call from redeemRecoveryToken when the JWT exp claim has elapsed.
 *
 * This is separate from recordLinkClick because:
 *  - The full recovery flow does NOT run for expired tokens
 *  - We still want to record that the user tried to click (real signal)
 *  - We do NOT advance outcome to 'clicked' (the cart was not restored)
 *  - We DO increment click counts so analytics shows the attempt
 *
 * The clickedAfterExpiry flag lets analytics distinguish:
 *   "user never came" (tokenExpiredUnclicked=true, clickedAfterExpiry=false)
 *   from
 *   "user came too late" (clickedAfterExpiry=true)
 */
recoveryEmailSchema.methods.recordExpiredLinkClick = function (tokenId) {
  // Fall back to lastTokenId if the bare decode didn't surface jti
  const resolvedId = tokenId || this.lastTokenId;
  const attempt    = this._findAttemptByTokenId(resolvedId);

  if (!attempt) return null;

  // Always record the click — this is the signal that was being lost
  attempt.linkClickCount     = (attempt.linkClickCount || 0) + 1;
  attempt.clickedAfterExpiry = true;
  this.totalLinkClicks       = (this.totalLinkClicks   || 0) + 1;

  if (!attempt.linkClickedAt) {
    attempt.linkClickedAt = new Date();
  }

  this.lastClickedAttemptNumber = attempt.attemptNumber;

  // Do NOT call _resolveOutcome('clicked') — the cart was not restored,
  // so promoting outcome would be misleading. The exhausted/expired outcome
  // remains intact; analytics can detect this case via:
  //   totalLinkClicks > 0 AND outcome IN ('exhausted', 'expired')
  // or directly via attempt.clickedAfterExpiry === true.

  return attempt;
};


/**
 * markTokenExpired
 * Called by the cron sweep when a token's exp date passes without a click.
 */
recoveryEmailSchema.methods.markTokenExpired = function (tokenId) {
  const attempt = this._findAttemptByTokenId(tokenId);
  if (attempt && !attempt.linkClickedAt) {
    attempt.tokenExpiredUnclicked = true;
  }

  const hasExpiredUnclicked = this.attempts.some(
    a => a.tokenExpiredUnclicked && !a.linkClickedAt
  );

  if (hasExpiredUnclicked) {
    this._resolveOutcome('expired');
  }
};


/**
 * markReAbandoned
 * Called by the abandonment detection system (checkout cron / webhook) when a
 * cart that was already in an active recovery campaign is abandoned again.
 *
 * This is the ONLY correct trigger for 're_abandoned'. It must never be set
 * by token expiry or cron sweeps — those are temporal signals, not behavioural.
 *
 * Correct lifecycle:
 *   sent/clicked → user returns to checkout → leaves again → re_abandoned
 *
 * 're_abandoned' is semi-terminal: only 'converted' or 'organic' can overwrite
 * it (a re-abandoned cart that later converts is a valid and desirable outcome).
 */
recoveryEmailSchema.methods.markReAbandoned = function () {
  this._resolveOutcome('re_abandoned');
};


/**
 * resolveOutcome
 * Public wrapper for _resolveOutcome.
 */
recoveryEmailSchema.methods.resolveOutcome = function (outcome) {
  this._resolveOutcome(outcome);
};


/**
 * takeCartSnapshot
 * Frozen copy of the cart for the email template renderer.
 * Only written on the first call — subsequent calls are no-ops.
 */
recoveryEmailSchema.methods.takeCartSnapshot = function (checkout) {
  if (this.cartSnapshot?.snapshotAt) return;

  const firstName = checkout.shippingInfo?.firstName || '';
  const lastName  = checkout.shippingInfo?.lastName  || '';

  this.cartSnapshot = {
    items: (checkout.items || []).map(item => ({
      product:  item.product,
      name:     item.name,
      price:    item.price,
      quantity: item.quantity,
      image:    item.image,
    })),
    pricing: {
      itemPrice:      checkout.pricing?.itemPrice,
      taxPrice:       checkout.pricing?.taxPrice,
      shippingPrice:  checkout.pricing?.shippingPrice,
      totalPrice:     checkout.pricing?.totalPrice,
      discountCode:   checkout.pricing?.discountCode,
      discountAmount: checkout.pricing?.discountAmount,
      currency:       checkout.pricing?.currency || 'USD',
    },
    customerName: [firstName, lastName].filter(Boolean).join(' ') || null,
    snapshotAt:   new Date(),
  };
};

// ============================================
// PRIVATE HELPERS
// ============================================

recoveryEmailSchema.methods._findAttemptByTokenId = function (tokenId, status) {
  return this.attempts.find(
    a => a.tokenId === tokenId && (status ? a.status === status : true)
  );
};

/**
 * _resolveOutcome
 *
 * Priority ladder (highest → lowest):
 *
 *   Tier 1 — Absolute terminal (converted, organic):
 *     Nothing ever overwrites a confirmed conversion.
 *
 *   Tier 2 — Semi-terminal (re_abandoned):
 *     Behavioural signal — user returned and left again.
 *     Only absolute terminals (converted/organic) can replace it.
 *
 *   Tier 3 — Hard terminal (failed):
 *     Unrecoverable mailer/system failure.
 *     Only absolute terminals can replace it.
 *     NOTE: 'exhausted' intentionally removed from HARD_TERMINAL.
 *     exhausted = send cap reached, purely a send-side signal.
 *     A valid token click must still be able to advance it to 'clicked'.
 *
 *   Tier 4 — Soft terminal (exhausted, expired):
 *     exhausted = all sends done, no clicks yet.
 *     expired   = token(s) elapsed, user may still click a later valid token.
 *     Both can be overwritten by 'clicked', 'converted', 'organic',
 *     're_abandoned', or a new 'sent' (follow-up email).
 *
 *   Everything else — freely overwritable (pending, sent, clicked).
 */
recoveryEmailSchema.methods._resolveOutcome = function (outcome) {
  // Tier 1 — absolute terminal: nothing ever overwrites these.
  const ABSOLUTE_TERMINAL = ['converted', 'organic'];
  if (ABSOLUTE_TERMINAL.includes(this.outcome)) return;

  // Tier 2 — semi-terminal: only absolute terminals can replace re_abandoned.
  const SEMI_TERMINAL = ['re_abandoned'];
  if (SEMI_TERMINAL.includes(this.outcome) && !ABSOLUTE_TERMINAL.includes(outcome)) return;

  // Tier 3 — hard terminal: only absolute terminals can replace failed.
  // exhausted is intentionally NOT here — see docblock above.
  const HARD_TERMINAL = ['failed'];
  if (HARD_TERMINAL.includes(this.outcome) && !ABSOLUTE_TERMINAL.includes(outcome)) return;

  // Tier 4 — soft terminals (exhausted, expired): fall through.
  // A valid token click, new send, or conversion can overwrite these freely.

  this.outcome    = outcome;
  this.resolvedAt = new Date();
};

recoveryEmailSchema.methods._resolveTokenTTL = function (checkout) {
  let ttl = cfg.tokenTTL();

  if (checkout.expiresAt) {
    const secondsUntilExpiry = Math.floor(
      (new Date(checkout.expiresAt).getTime() - Date.now()) / 1000
    );
    if (secondsUntilExpiry <= 0) {
      throw new Error('Checkout has expired — cannot issue a recovery token.');
    }
    if (secondsUntilExpiry < ttl) ttl = secondsUntilExpiry;
  }

  return ttl;
};

// ============================================
// STATIC METHODS
// ============================================

recoveryEmailSchema.statics.findOrCreateForCheckout = async function (checkout) {
  return this.findOneAndUpdate(
    { checkout: checkout._id },
    {
      $setOnInsert: {
        checkout: checkout._id,
        user:     checkout.user,
        email:    checkout.email,
      },
    },
    {
      upsert:              true,
      new:                 true,
      setDefaultsOnInsert: true,
    }
  );
};


recoveryEmailSchema.statics.getAnalytics = async function (startDate, endDate) {
  const matchBase = { createdAt: { $gte: startDate, $lte: endDate } };

  const [summary, outcomeBreakdown, attemptDistribution, clickFunnel, sentByBreakdown] =
    await Promise.all([

      this.aggregate([
        { $match: matchBase },
        {
          $group: {
            _id:   null,
            total: { $sum: 1 },

            totalConfirmedAttempts: { $sum: '$confirmedAttempts' },
            totalLinkClicks:        { $sum: '$totalLinkClicks' },

            everClicked: {
              $sum: { $cond: [{ $gt: ['$totalLinkClicks', 0] }, 1, 0] },
            },

            converted:    { $sum: { $cond: [{ $eq: ['$outcome', 'converted']   }, 1, 0] } },
            organic:      { $sum: { $cond: [{ $eq: ['$outcome', 'organic']      }, 1, 0] } },
            re_abandoned: { $sum: { $cond: [{ $eq: ['$outcome', 're_abandoned'] }, 1, 0] } },
            exhausted:    { $sum: { $cond: [{ $eq: ['$outcome', 'exhausted']    }, 1, 0] } },
            expired:      { $sum: { $cond: [{ $eq: ['$outcome', 'expired']      }, 1, 0] } },
            failed:       { $sum: { $cond: [{ $eq: ['$outcome', 'failed']       }, 1, 0] } },
            clicked:      { $sum: { $cond: [{ $eq: ['$outcome', 'clicked']      }, 1, 0] } },
            stillPending: { $sum: { $cond: [{ $eq: ['$outcome', 'pending']      }, 1, 0] } },
            stillSent:    { $sum: { $cond: [{ $eq: ['$outcome', 'sent']         }, 1, 0] } },

            // Track expired-link clicks separately from normal clicks.
            // This counts campaigns where at least one attempt was clicked
            // after the token had already expired (clickedAfterExpiry=true).
            expiredButClicked: {
              $sum: {
                $cond: [
                  {
                    $gt: [
                      {
                        $size: {
                          $filter: {
                            input: '$attempts',
                            as:    'a',
                            cond:  { $eq: ['$$a.clickedAfterExpiry', true] },
                          },
                        },
                      },
                      0,
                    ],
                  },
                  1,
                  0,
                ],
              },
            },

            avgAttemptsPerCheckout: { $avg: '$confirmedAttempts' },
          },
        },
      ]),

      this.aggregate([
        { $match: matchBase },
        {
          $group: {
            _id:   '$outcome',
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
      ]),

      this.aggregate([
        {
          $match: {
            ...matchBase,
            outcome: { $in: ['converted', 'organic'] },
          },
        },
        {
          $lookup: {
            from:         'checkouts',
            localField:   'checkout',
            foreignField: '_id',
            as:           'checkoutDoc',
          },
        },
        { $unwind: { path: '$checkoutDoc', preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id:          '$confirmedAttempts',
            conversions:  { $sum: 1 },
            totalRevenue: { $sum: '$checkoutDoc.pricing.totalPrice' },
            avgCartValue: { $avg: '$checkoutDoc.pricing.totalPrice' },
          },
        },
        { $sort: { _id: 1 } },
      ]),

      this.aggregate([
        { $match: matchBase },
        {
          $group: {
            _id:       null,
            totalSent: {
              $sum: { $cond: [{ $gte: ['$confirmedAttempts', 1] }, 1, 0] },
            },
            clicked: {
              $sum: {
                $cond: [
                  { $in: ['$outcome', ['clicked', 'converted', 're_abandoned']] },
                  1, 0,
                ],
              },
            },
            converted: {
              $sum: {
                $cond: [
                  { $in: ['$outcome', ['converted', 'organic']] },
                  1, 0,
                ],
              },
            },
          },
        },
      ]),

      this.aggregate([
        { $match: matchBase },
        { $unwind: { path: '$attempts', preserveNullAndEmptyArrays: true } },
        { $match: { 'attempts.status': 'sent' } },
        {
          $group: {
            _id:   '$attempts.sentBy',
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

  const s  = summary[0] || {
    total: 0, totalConfirmedAttempts: 0, totalLinkClicks: 0, everClicked: 0,
    converted: 0, organic: 0, re_abandoned: 0, exhausted: 0, expired: 0,
    failed: 0, clicked: 0, stillPending: 0, stillSent: 0,
    expiredButClicked: 0, avgAttemptsPerCheckout: 0,
  };
  const cf = clickFunnel[0] || { totalSent: 0, clicked: 0, converted: 0 };

  const sendAttribution = { admin: 0, cron: 0 };
  for (const row of sentByBreakdown) {
    if (row._id === 'admin' || row._id === 'cron') {
      sendAttribution[row._id] = row.count;
    }
  }

  return {
    totalCampaigns:         s.total,
    totalSendAttempts:      s.totalConfirmedAttempts,
    totalLinkClicks:        s.totalLinkClicks,
    linkClickRate:
      s.total > 0 ? Math.round((s.everClicked / s.total) * 10000) / 100 : 0,
    conversionRate:
      s.total > 0 ? Math.round(((s.converted + s.organic) / s.total) * 10000) / 100 : 0,
    avgAttemptsPerCheckout:
      Math.round((s.avgAttemptsPerCheckout || 0) * 10) / 10,

    // expiredButClicked: campaigns where the user clicked but the token had
    // already elapsed — previously invisible in analytics.
    expiredButClicked: s.expiredButClicked,

    outcomes: {
      converted:    s.converted,
      organic:      s.organic,
      re_abandoned: s.re_abandoned,
      exhausted:    s.exhausted,
      expired:      s.expired,
      failed:       s.failed,
      clicked:      s.clicked,
      sent:         s.stillSent,
      pending:      s.stillPending,
    },

    clickFunnel: {
      sent:      cf.totalSent,
      clicked:   cf.clicked,
      converted: cf.converted,
      sentToClickRate:
        cf.totalSent > 0
          ? Math.round((cf.clicked   / cf.totalSent) * 10000) / 100 : 0,
      clickToConvertRate:
        cf.clicked > 0
          ? Math.round((cf.converted / cf.clicked)   * 10000) / 100 : 0,
    },

    revenueAttribution: attemptDistribution.map(row => ({
      attemptNumber: row._id,
      conversions:   row.conversions,
      totalRevenue:  Math.round((row.totalRevenue || 0) * 100) / 100,
      avgCartValue:  Math.round((row.avgCartValue  || 0) * 100) / 100,
    })),

    sendAttribution,
    outcomeBreakdown,
  };
};


recoveryEmailSchema.statics.getPendingStaleAcks = async function () {
  const threshold = new Date(
    Date.now() - cfg.staleAckMins() * 60 * 1000
  );
  return this.find(
    { pendingAck: true, updatedAt: { $lt: threshold } },
    { _id: 1, checkout: 1, lastTokenId: 1, updatedAt: 1 }
  ).lean();
};

// ============================================
// MIDDLEWARE
// ============================================

recoveryEmailSchema.pre('save', function (next) {
  if (this.isModified('attempts') && !this.pendingAck) {
    this.confirmedAttempts = this.attempts.filter(
      a => a.status === 'sent'
    ).length;
  }
  next();
});

export default mongoose.model('RecoveryEmail', recoveryEmailSchema);
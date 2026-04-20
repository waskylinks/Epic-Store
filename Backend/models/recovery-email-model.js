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
    attemptNumber: { type: Number, required: true },

    status: {
      type:    String,
      enum:    ['pending', 'sent', 'failed'],
      default: 'pending',
    },

    // 'cron' is the only sender now. 'admin' kept for historical record readability.
    sentBy: {
      type:    String,
      enum:    ['admin', 'cron'],
      default: 'cron',
    },

    initiatedAt: { type: Date, default: Date.now },
    sentAt:      Date,
    failReason:  String,

    token: { type: String, select: false },

    tokenId:        String,
    tokenIssuedAt:  Date,
    tokenExpiresAt: Date,

    // Set by cron sweep when this token's JWT exp elapsed with no click.
    // Means: "user never came for this attempt."
    tokenExpiredUnclicked: { type: Boolean, default: false },

    // Set when user clicked AFTER JWT exp had already elapsed.
    // Means: "user was interested but came too late."
    // Cart is NOT restored when this is true.
    clickedAfterExpiry: { type: Boolean, default: false },

    linkClickedAt:       Date,
    linkClickCount:      { type: Number, default: 0 },
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
      type:    [attemptSchema],
      default: [],
      validate: {
        validator: (v) => v.length <= 10,
        message:   'Attempt log cannot exceed 10 entries',
      },
    },

    confirmedAttempts:        { type: Number,  default: 0 },
    pendingAck:               { type: Boolean, default: false, index: true },
    lastSentAt:               { type: Date,    index: true },
    lastTokenId:              String,
    totalLinkClicks:          { type: Number,  default: 0, index: true },
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
      type: String,
      enum: [
        'pending',      // no emails sent yet
        'sent',         // at least one email sent, awaiting click
        'clicked',      // user clicked a valid token — cart restored
        'converted',    // user completed checkout after recovery
        'organic',      // user converted without using recovery link
        're_abandoned', // user clicked, returned, then left again — TERMINAL for sends
        'exhausted',    // all N emails have been sent — send-side signal only
        'expired',      // all tokens elapsed, user never clicked — true terminal
        'failed',       // unrecoverable mailer/system failure
      ],
      default: 'pending',
      index:   true,
    },
    resolvedAt: Date,
  },
  {
    timestamps: true,
    toJSON:     { virtuals: true },
    toObject:   { virtuals: true },
  }
);

// ============================================
// INDEXES
// ============================================

recoveryEmailSchema.index({ checkout: 1 }, { unique: true, name: 'checkout_unique_idx' });
recoveryEmailSchema.index({ outcome: 1, confirmedAttempts: 1, lastSentAt: -1 }, { name: 'send_page_list_idx' });
recoveryEmailSchema.index({ outcome: 1, createdAt: -1 }, { name: 'outcome_created_idx' });
recoveryEmailSchema.index({ pendingAck: 1, updatedAt: -1 }, { name: 'pending_ack_sweep_idx' });
recoveryEmailSchema.index({ 'attempts.tokenId': 1 }, { name: 'attempt_token_idx' });
recoveryEmailSchema.index({ email: 1, outcome: 1 }, { name: 'email_outcome_idx' });
recoveryEmailSchema.index({ outcome: 1, lastSentAt: 1, confirmedAttempts: 1 }, { name: 'cron_eligibility_idx' });

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
  return new Date(this.lastSentAt.getTime() + cfg.cooldownHours() * 60 * 60 * 1000);
});

// ============================================
// INSTANCE METHODS
// ============================================

/**
 * canSend
 * Gate for all cron send decisions.
 *
 * ACTIVE_OUTCOMES are the only states where the cron will attempt a new send.
 *
 * KEY CHANGE: 're_abandoned' is intentionally NOT in ACTIVE_OUTCOMES.
 * Once a user clicks a recovery link and then abandons again, the sequence
 * is suppressed entirely. There is no value in sending more emails to someone
 * who has already demonstrated they came back and still chose to leave.
 * Re-abandonment is a behavioural signal that the recovery campaign is over.
 *
 * 'clicked' IS in ACTIVE_OUTCOMES so that if the user clicks but doesn't
 * convert, the cron can still send a follow-up email if attempts remain.
 * Once they re-abandon after clicking, 're_abandoned' is set and the cron stops.
 */
recoveryEmailSchema.methods.canSend = function (checkout) {
  if (checkout.conversion?.isConverted) {
    return { canSend: false, reason: 'Checkout already converted' };
  }

  // re_abandoned is intentionally excluded — sequence suppressed after re-abandonment.
  const ACTIVE_OUTCOMES = ['pending', 'sent', 'clicked'];
  if (!ACTIVE_OUTCOMES.includes(this.outcome)) {
    return {
      canSend: false,
      reason:  `Recovery campaign already resolved: ${this.outcome}`,
    };
  }

  if (this.pendingAck) {
    const staleThreshold = new Date(Date.now() - cfg.staleAckMins() * 60 * 1000);
    const isStale        = this.updatedAt && this.updatedAt < staleThreshold;
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
    const hoursSinceLast = (Date.now() - this.lastSentAt.getTime()) / (1000 * 60 * 60);
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

  // Set outcome to 'sent' for any active non-terminal state
  if (['pending', 'clicked'].includes(this.outcome)) {
    this.outcome = 'sent';
  }

  return token;
};

/**
 * acknowledgeSent
 * Called after mailer confirms delivery.
 *
 * Writes 'exhausted' immediately when confirmedAttempts reaches maxAttempts.
 * exhausted = all emails sent. Send-side signal only — nothing about token expiry.
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

  // Write exhausted immediately upon hitting the send cap.
  // Token expiry is irrelevant — exhausted purely means "sending is done."
  if (this.confirmedAttempts >= cfg.maxAttempts()) {
    this._resolveOutcome('exhausted');
  }
};

/**
 * recordSendFailure
 * Called when mailer throws after initiateSend.
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

  const allAttemptsFailed =
    this.attempts.length > 0 &&
    this.attempts.every(a => a.status === 'failed');
  const hitCap = this.attempts.length >= cfg.maxAttempts();

  if (allAttemptsFailed && hitCap) {
    this._resolveOutcome('failed');
  }
};

/**
 * recordLinkClick
 * Called from redeemRecoveryToken when JWT verification SUCCEEDS (valid token).
 *
 * Full recovery flow runs regardless of current outcome — including exhausted.
 * exhausted only means the send campaign is done. The tokens it generated
 * are still valid until their JWT exp elapses. A user clicking a valid token
 * gets their cart restored and outcome advances to 'clicked'.
 *
 * If the user then abandons again, markReAbandoned() sets 're_abandoned'
 * and canSend() blocks any further sends permanently.
 */
recoveryEmailSchema.methods.recordLinkClick = function (tokenId, checkoutStep) {
  const attempt = this._findAttemptByTokenId(tokenId);
  if (!attempt) return null;

  if (!attempt.linkClickedAt) {
    attempt.linkClickedAt = new Date();
  }

  attempt.linkClickCount = (attempt.linkClickCount || 0) + 1;
  this.totalLinkClicks   = (this.totalLinkClicks   || 0) + 1;

  if (checkoutStep && !attempt.checkoutStepAtClick) {
    attempt.checkoutStepAtClick = checkoutStep;
  }

  this.lastClickedAttemptNumber = attempt.attemptNumber;

  // Advance to 'clicked' from any state including exhausted.
  // _resolveOutcome's priority ladder protects converted, organic,
  // re_abandoned (semi-terminal), and failed (hard terminal).
  this._resolveOutcome('clicked');

  return attempt;
};

/**
 * recordExpiredLinkClick
 * Called from redeemRecoveryToken when JWT exp has ALREADY elapsed.
 *
 * Cart is NOT restored. Records the "interested but too late" signal.
 * Outcome does NOT advance — exhausted or expired stays as-is.
 */
recoveryEmailSchema.methods.recordExpiredLinkClick = function (tokenId) {
  const resolvedId = tokenId || this.lastTokenId;
  const attempt    = this._findAttemptByTokenId(resolvedId);
  if (!attempt) return null;

  attempt.linkClickCount     = (attempt.linkClickCount || 0) + 1;
  attempt.clickedAfterExpiry = true;
  this.totalLinkClicks       = (this.totalLinkClicks   || 0) + 1;

  if (!attempt.linkClickedAt) {
    attempt.linkClickedAt = new Date();
  }

  this.lastClickedAttemptNumber = attempt.attemptNumber;

  // Do NOT call _resolveOutcome — outcome stays exhausted or expired.

  return attempt;
};

/**
 * markTokenExpired
 * Called by cron sweep when a specific token's exp date passes without a click.
 * Sets tokenExpiredUnclicked on the attempt only.
 * Does NOT write 'expired' outcome — that is written by markExpiredRecords
 * only after ALL tokens across the campaign have elapsed unclicked.
 */
recoveryEmailSchema.methods.markTokenExpired = function (tokenId) {
  const attempt = this._findAttemptByTokenId(tokenId);
  if (attempt && !attempt.linkClickedAt) {
    attempt.tokenExpiredUnclicked = true;
  }
  // _resolveOutcome('expired') intentionally NOT called here.
  // See markExpiredRecords in recoveryEmailService.js.
};

/**
 * markReAbandoned
 * Called ONLY by the abandonment detection system when a cart in an
 * active recovery campaign is abandoned again after the user returned.
 *
 * This is the ONLY correct trigger for 're_abandoned'.
 *
 * After this is set, canSend() will block all future sends because
 * 're_abandoned' is not in ACTIVE_OUTCOMES. The sequence is permanently
 * suppressed — there is no path back to sending once re-abandonment occurs.
 *
 * 're_abandoned' remains overridable by 'converted' and 'organic' in
 * _resolveOutcome so that if the user eventually completes the purchase
 * through some other means, the outcome correctly reflects conversion.
 */
recoveryEmailSchema.methods.markReAbandoned = function () {
  this._resolveOutcome('re_abandoned');
};

/**
 * resolveOutcome — public wrapper for _resolveOutcome.
 */
recoveryEmailSchema.methods.resolveOutcome = function (outcome) {
  this._resolveOutcome(outcome);
};

/**
 * takeCartSnapshot
 * Frozen copy of cart for email template. Written only once.
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
 * Priority ladder:
 *
 *   Tier 1 — Absolute terminal (converted, organic):
 *     Nothing ever overwrites a confirmed conversion.
 *
 *   Tier 2 — Semi-terminal (re_abandoned):
 *     Behavioural signal — user returned and left again.
 *     Only absolute terminals (converted/organic) can replace it.
 *     canSend() blocks all future sends once this is set.
 *
 *   Tier 3 — Hard terminal (failed):
 *     Unrecoverable system failure. Only absolute terminals can replace it.
 *
 *   Tier 4 — Soft terminals (exhausted, expired):
 *     exhausted = send cap reached — overwritable by 'clicked' (valid token click)
 *     expired   = all tokens dead, no clicks — overwritable by absolute terminals
 *
 *   Everything else (pending, sent, clicked) — freely overwritable.
 */
recoveryEmailSchema.methods._resolveOutcome = function (outcome) {
  const ABSOLUTE_TERMINAL = ['converted', 'organic'];
  if (ABSOLUTE_TERMINAL.includes(this.outcome)) return;

  const SEMI_TERMINAL = ['re_abandoned'];
  if (SEMI_TERMINAL.includes(this.outcome) && !ABSOLUTE_TERMINAL.includes(outcome)) return;

  const HARD_TERMINAL = ['failed'];
  if (HARD_TERMINAL.includes(this.outcome) && !ABSOLUTE_TERMINAL.includes(outcome)) return;

  // Soft terminals (exhausted, expired) fall through freely.

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
    { upsert: true, new: true, setDefaultsOnInsert: true }
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

            // lateClicks: campaigns where user clicked after JWT exp elapsed.
            lateClicks: {
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
        { $group: { _id: '$outcome', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      this.aggregate([
        {
          $match: {
            ...matchBase,
            outcome: 'converted', // email-attributed only — organic excluded
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
            _id:          '$lastClickedAttemptNumber', // which attempt they actually clicked
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
            totalSent: { $sum: { $cond: [{ $gte: ['$confirmedAttempts', 1] }, 1, 0] } },

            // clicked = user clicked a valid (non-expired) link
            // i.e. any attempt has linkClickedAt set AND clickedAfterExpiry is false
            clicked: {
              $sum: {
                $cond: [
                  {
                    $gt: [
                      {
                        $size: {
                          $filter: {
                            input: '$attempts',
                            as:    'a',
                            cond: {
                              $and: [
                                { $ifNull: ['$$a.linkClickedAt', false] },
                                { $ne: ['$$a.clickedAfterExpiry', true] },
                              ],
                            },
                          },
                        },
                      },
                      0,
                    ],
                  },
                  1, 0,
                ],
              },
            },

            // converted = email-attributed only, NOT organic
            converted: {
              $sum: {
                $cond: [{ $eq: ['$outcome', 'converted'] }, 1, 0],
              },
            },
          },
        },
      ]),

      this.aggregate([
        { $match: matchBase },
        { $unwind: { path: '$attempts', preserveNullAndEmptyArrays: true } },
        { $match: { 'attempts.status': 'sent' } },
        { $group: { _id: '$attempts.sentBy', count: { $sum: 1 } } },
      ]),
    ]);
    
  const s  = summary[0] || {
    total: 0, totalConfirmedAttempts: 0, totalLinkClicks: 0, everClicked: 0,
    converted: 0, organic: 0, re_abandoned: 0, exhausted: 0, expired: 0,
    failed: 0, clicked: 0, stillPending: 0, stillSent: 0,
    lateClicks: 0, avgAttemptsPerCheckout: 0,
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
    lateClicks:             s.lateClicks,
    linkClickRate:
      s.total > 0 ? Math.round((s.everClicked / s.total) * 10000) / 100 : 0,
    conversionRate:
      s.total > 0 ? Math.round(((s.converted + s.organic) / s.total) * 10000) / 100 : 0,
    avgAttemptsPerCheckout:
      Math.round((s.avgAttemptsPerCheckout || 0) * 10) / 10,

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
        cf.totalSent > 0 ? Math.round((cf.clicked   / cf.totalSent) * 10000) / 100 : 0,
      clickToConvertRate:
        cf.clicked   > 0 ? Math.round((cf.converted / cf.clicked)   * 10000) / 100 : 0,
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
  const threshold = new Date(Date.now() - cfg.staleAckMins() * 60 * 1000);
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
    this.confirmedAttempts = this.attempts.filter(a => a.status === 'sent').length;
  }
  next();
});

export default mongoose.model('RecoveryEmail', recoveryEmailSchema);
import mongoose from 'mongoose';
import { generateRecoveryToken } from '../utils/recoveryToken.js';

// ============================================
// ENV HELPERS
// ============================================

const cfg = {
  maxAttempts:   () => parseInt(process.env.MAX_RECOVERY_ATTEMPTS)      || 3,
  cooldownHours: () => parseInt(process.env.RECOVERY_COOLDOWN_HOURS)    || 24,
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

    // ── Send lifecycle ────────────────────────────────────────────────────────
    // pending → send initiated, mailer not yet confirmed
    // sent    → mailer confirmed delivery (acknowledgeSent called)
    // failed  → mailer threw, attempt rolled back (recordSendFailure called)
    status: {
      type:    String,
      enum:    ['pending', 'sent', 'failed'],
      default: 'pending',
    },

    initiatedAt: { type: Date, default: Date.now },
    sentAt:      Date,
    failReason:  String,

    // ── Token ─────────────────────────────────────────────────────────────────
    // token is select:false — never returned in default queries.
    // Load with .select('+attempts.token') only when the mailer needs it.
    token: {
      type:   String,
      select: false,
    },

    // jti (JWT ID) — safe to expose, used for per-click attribution.
    // Matches the 'jti' claim in the signed JWT so redeemRecoveryToken
    // can call recordLinkClick(decoded.jti) without any extra lookup.
    tokenId:       String,
    tokenIssuedAt: Date,
    tokenExpiresAt: Date,

    // True when the token expired without ever being clicked.
    // Written by markTokenExpired(), called from redeemRecoveryToken
    // on a TokenExpiredError so analytics can distinguish "never opened"
    // from "expired after clicking".
    tokenExpiredUnclicked: { type: Boolean, default: false },

    // ── Link interaction ──────────────────────────────────────────────────────
    linkClickedAt:  Date,
    linkClickCount: { type: Number, default: 0 },

    // Checkout step at the moment the link was clicked.
    // Lets analytics compare funnel entry point vs final drop-off step.
    checkoutStepAtClick: String,
  },
  { _id: true }
);

// ============================================
// RECOVERY EMAIL SCHEMA
// ============================================

const recoveryEmailSchema = new mongoose.Schema(
  {
    // ── Core references ───────────────────────────────────────────────────────
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

    // ── Attempt log ───────────────────────────────────────────────────────────
    // One entry per admin-triggered send attempt.
    // Capped at 10 at the schema level (env MAX_RECOVERY_ATTEMPTS caps at 3
    // by default — the 10 here is a hard safety ceiling, not the business rule).
    attempts: {
      type:     [attemptSchema],
      default:  [],
      validate: {
        validator: function (v) { return v.length <= 10; },
        message:   'Attempt log cannot exceed 10 entries',
      },
    },

    // ── Fast-read aggregate fields ────────────────────────────────────────────
    // Maintained by instance methods so the admin list, RecoveryEmailButton,
    // and canSend logic never need to reduce the attempts array.

    // Count of CONFIRMED attempts (sent + failed, excluding in-flight pending).
    // Failed attempts are rolled back by recordSendFailure so they don't
    // permanently burn a slot — only sent attempts count against the limit.
    confirmedAttempts: { type: Number, default: 0 },

    // True while a send has been initiated but not yet ack'd by the mailer.
    // Cleared by acknowledgeSent (success) or recordSendFailure (failure).
    // Prevents double-sends from rapid admin clicks or network retries.
    pendingAck: { type: Boolean, default: false, index: true },

    // Most recent confirmed sentAt — used for cooldown calculations.
    lastSentAt: { type: Date, index: true },

    // tokenId (jti) of the most recently initiated attempt.
    // Used by acknowledgeSent / recordSendFailure / markTokenExpired
    // to locate the right attempt without iterating the full array.
    lastTokenId: String,

    // Stored total link clicks across ALL attempts.
    // Maintained by recordLinkClick() so aggregation sorts are index-friendly.
    // The totalLinkClicks virtual (below) derives the same value but is
    // not usable in aggregation pipelines — this field is.
    totalLinkClicks: { type: Number, default: 0, index: true },

    // attemptNumber of the attempt whose link was most recently clicked.
    // Used by the checkout controller to attribute a recovery session back
    // to a specific email send for ROI and attribution reporting.
    lastClickedAttemptNumber: Number,

    // ── Cart snapshot ─────────────────────────────────────────────────────────
    // Lightweight frozen copy of the cart at the moment of the FIRST send.
    // Passed directly to buildRecoveryEmailHtml — no full checkout load needed
    // for re-sends. Written once by takeCartSnapshot(); subsequent calls no-op.
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
      customerName: String,  // firstName + lastName at first send time
      snapshotAt:   Date,
    },

    // ── Outcome ───────────────────────────────────────────────────────────────
    // Terminal state for the entire recovery email campaign for this checkout.
    // Set once via resolveOutcome() — never overwritten after a terminal state.
    //
    //  pending      → record created, no email sent yet
    //  sent         → at least one email delivered, awaiting user action
    //  clicked      → recovery link clicked, cart restored, not yet converted
    //  converted    → checkout paid — email campaign contributed
    //  organic      → checkout paid WITHOUT an active recovery session
    //                 (user returned independently despite email being sent)
    //  re_abandoned → user clicked the link but abandoned again without paying
    //  expired      → all tokens expired without being clicked
    //  exhausted    → max attempts reached, checkout still abandoned
    //  failed       → every send attempt failed at the mailer level
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
    timestamps:  true,
    toJSON:  { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ============================================
// INDEXES
// ============================================

// One RecoveryEmail per checkout — enforced at DB level.
recoveryEmailSchema.index(
  { checkout: 1 },
  { unique: true, name: 'checkout_unique_idx' }
);

// Send-page list query: filter by outcome, sort by send recency.
recoveryEmailSchema.index(
  { outcome: 1, confirmedAttempts: 1, lastSentAt: -1 },
  { name: 'send_page_list_idx' }
);

// Analytics page: date-range queries.
recoveryEmailSchema.index(
  { outcome: 1, createdAt: -1 },
  { name: 'outcome_created_idx' }
);

// Sweep: stale pendingAck records (mailer crash recovery).
recoveryEmailSchema.index(
  { pendingAck: 1, updatedAt: -1 },
  { name: 'pending_ack_sweep_idx' }
);

// Token click attribution — redeemRecoveryToken looks up by tokenId.
recoveryEmailSchema.index(
  { 'attempts.tokenId': 1 },
  { name: 'attempt_token_idx' }
);

// Attribution + ROI analytics by email address.
recoveryEmailSchema.index(
  { email: 1, outcome: 1 },
  { name: 'email_outcome_idx' }
);

// ============================================
// VIRTUALS
// ============================================

// Most recent attempt — used by RecoveryEmailButton for UI state.
recoveryEmailSchema.virtual('lastAttempt').get(function () {
  if (!this.attempts?.length) return null;
  return this.attempts[this.attempts.length - 1];
});

// Has any attempt's link ever been clicked?
recoveryEmailSchema.virtual('everClicked').get(function () {
  return (this.attempts || []).some(a => !!a.linkClickedAt);
});

// When the next send becomes available based on cooldown.
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
 * Central gate — all send decisions flow through here.
 * Returns { canSend: Boolean, reason?: String, nextAvailableAt?: Date }
 *
 * The checkout document is passed in so we can check conversion status
 * and doc expiry without this model querying the DB itself.
 *
 * @param {Object} checkout  The related Checkout document
 */
recoveryEmailSchema.methods.canSend = function (checkout) {
  // ── Terminal state guards ─────────────────────────────────────────────────
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

  // ── In-flight guard ───────────────────────────────────────────────────────
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
    // Stale ack: mailer likely crashed — fall through and allow retry.
  }

  // ── Max attempts guard ────────────────────────────────────────────────────
  if (this.confirmedAttempts >= cfg.maxAttempts()) {
    return {
      canSend: false,
      reason:  `Maximum recovery attempts (${cfg.maxAttempts()}) reached`,
    };
  }

  // ── Cooldown guard ────────────────────────────────────────────────────────
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

  // ── Age guard ─────────────────────────────────────────────────────────────
  // Always measured from firstAbandonedAt so a re-abandonment does not
  // grant a fresh 7-day window.
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

  // ── Doc expiry guard ──────────────────────────────────────────────────────
  if (checkout.expiresAt && new Date(checkout.expiresAt) <= new Date()) {
    return { canSend: false, reason: 'Checkout document has expired' };
  }

  return { canSend: true };
};


/**
 * initiateSend
 * Opens a new attempt slot and generates a signed JWT.
 *
 * CALL PATTERN (enforced by the service):
 *   1. recoveryEmail.initiateSend(checkout)  → get token
 *   2. mailer.send(token)
 *   3a. recoveryEmail.acknowledgeSent()      → mailer succeeded
 *   3b. recoveryEmail.recordSendFailure(err) → mailer failed
 *
 * This three-step pattern prevents the pendingAck deadlock —
 * a mailer crash rolls back cleanly via recordSendFailure.
 *
 * @param   {Object} checkout  The related Checkout document
 * @returns {string}           Signed JWT (pass to mailer, never expose to client)
 */
recoveryEmailSchema.methods.initiateSend = function (checkout) {
  const check = this.canSend(checkout);
  if (!check.canSend) throw new Error(check.reason);

  const attemptNumber   = this.confirmedAttempts + 1;
  const tokenTTLSeconds = this._resolveTokenTTL(checkout);

  // Build a jti that encodes enough context to debug attribution issues
  // without decoding the full JWT.
  const jti = [
    checkout._id.toString(),
    attemptNumber,
    Date.now(),
    Math.random().toString(36).slice(2, 9),
  ].join('-');

  const token = generateRecoveryToken(
    {
      checkoutId: checkout._id,
      userId:     checkout.user,
      email:      checkout.email,
    },
    { expiresIn: tokenTTLSeconds, jti }
  );

  const now            = new Date();
  const tokenExpiresAt = new Date(Date.now() + tokenTTLSeconds * 1000);

  this.attempts.push({
    attemptNumber,
    status:        'pending',
    initiatedAt:   now,
    token,
    tokenId:       jti,
    tokenIssuedAt: now,
    tokenExpiresAt,
  });

  this.lastTokenId = jti;
  this.pendingAck  = true;

  // Snapshot the cart on the first send only — used by re-send template rendering.
  this.takeCartSnapshot(checkout);

  // Transition outcome forward if still at initial state.
  if (this.outcome === 'pending') {
    this.outcome = 'sent';
  }

  return token;
};


/**
 * acknowledgeSent
 * Call after the mailer confirms the email was handed off successfully.
 * Transitions the pending attempt to 'sent', increments confirmedAttempts,
 * and updates lastSentAt for cooldown calculations.
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
 * Marks the attempt as failed WITHOUT incrementing confirmedAttempts so
 * the admin can retry immediately. The failed attempt remains in the log
 * for observability.
 *
 * @param {string} reason  Error message from the mailer
 */
recoveryEmailSchema.methods.recordSendFailure = function (reason) {
  const attempt = this._findAttemptByTokenId(this.lastTokenId, 'pending');

  if (attempt) {
    attempt.status     = 'failed';
    attempt.failReason = reason || 'Unknown mailer error';
  }

  this.pendingAck = false;

  // Roll outcome back if this was the very first attempt so the record
  // doesn't appear as 'sent' when nothing was actually delivered.
  if (this.confirmedAttempts === 0) {
    this.outcome = 'pending';
  }
};


/**
 * recordLinkClick
 * Call from redeemRecoveryToken after JWT verification.
 * Matches the attempt by jti (from decoded.jti) and logs the interaction.
 *
 * @param   {string} tokenId       jti from the verified JWT payload
 * @param   {string} [checkoutStep] currentStep on checkout at click time
 * @returns {Object|null}          The updated attempt, or null if not found
 */
recoveryEmailSchema.methods.recordLinkClick = function (tokenId, checkoutStep) {
  const attempt = this._findAttemptByTokenId(tokenId);
  if (!attempt) return null;

  if (!attempt.linkClickedAt) {
    attempt.linkClickedAt = new Date();
  }

  attempt.linkClickCount = (attempt.linkClickCount || 0) + 1;

  // Stored field — keeps aggregation sort on totalLinkClicks index-friendly.
  this.totalLinkClicks = (this.totalLinkClicks || 0) + 1;

  if (checkoutStep && !attempt.checkoutStepAtClick) {
    attempt.checkoutStepAtClick = checkoutStep;
  }

  this.lastClickedAttemptNumber = attempt.attemptNumber;

  // Progress outcome if not already at a terminal state.
  if (['sent', 'pending'].includes(this.outcome)) {
    this.outcome = 'clicked';
  }

  return attempt;
};


/**
 * markTokenExpired
 * Best-effort audit write when redeemRecoveryToken catches a TokenExpiredError.
 * Flags the attempt so analytics can distinguish "never opened" vs "link expired
 * after being clicked". Resolves campaign outcome to 'expired' if all confirmed
 * sends have expired unclicked and max attempts was reached.
 *
 * @param {string} tokenId  jti from the decoded (but expired) JWT
 */
recoveryEmailSchema.methods.markTokenExpired = function (tokenId) {
  const attempt = this._findAttemptByTokenId(tokenId);
  if (attempt && !attempt.linkClickedAt) {
    attempt.tokenExpiredUnclicked = true;
  }

  const allSentExpired = this.attempts
    .filter(a => a.status === 'sent')
    .every(a => a.tokenExpiredUnclicked);

  if (allSentExpired && this.confirmedAttempts >= cfg.maxAttempts()) {
    this._resolveOutcome('expired');
  }
};


/**
 * resolveOutcome
 * Finalise the campaign once the checkout's fate is known.
 * Idempotent — no-op if already at a terminal state.
 *
 * Called by:
 *   verifyPaymentController → 'converted' or 'organic'
 *   markStaleCheckouts sweep → 're_abandoned', 'exhausted', 'expired'
 *
 * @param {'converted'|'organic'|'re_abandoned'|'expired'|'exhausted'|'failed'} outcome
 */
recoveryEmailSchema.methods.resolveOutcome = function (outcome) {
  this._resolveOutcome(outcome);
};


/**
 * takeCartSnapshot
 * Frozen copy of the cart for the email template renderer.
 * Only written on the first call — subsequent calls are no-ops so
 * re-sends always render the original cart the user abandoned.
 *
 * @param {Object} checkout  The full Checkout document
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

recoveryEmailSchema.methods._resolveOutcome = function (outcome) {
  const TERMINAL = ['converted', 'organic', 'exhausted', 'expired', 'failed'];
  if (TERMINAL.includes(this.outcome)) return;
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

/**
 * findOrCreateForCheckout
 * Atomic upsert — guarantees exactly one RecoveryEmail per checkout.
 * Safe under concurrent admin sends.
 *
 * @param   {Object} checkout  Full Checkout document
 * @returns {Object}           RecoveryEmail document (new or existing)
 */
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


/**
 * getAnalytics
 * Four parallel aggregations for the analytics page.
 * Results are cached by the controller (Redis, 5 min TTL).
 *
 * Includes revenueAttribution so the "is a second email worth it?"
 * ROI question is answerable directly from this payload.
 *
 * @param {Date} startDate
 * @param {Date} endDate
 */
recoveryEmailSchema.statics.getAnalytics = async function (startDate, endDate) {
  const matchBase = { createdAt: { $gte: startDate, $lte: endDate } };

  const [summary, outcomeBreakdown, attemptDistribution, clickFunnel] =
    await Promise.all([

      // ── Summary KPIs ──────────────────────────────────────────────────────
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
            reAbandoned:  { $sum: { $cond: [{ $eq: ['$outcome', 're_abandoned'] }, 1, 0] } },
            exhausted:    { $sum: { $cond: [{ $eq: ['$outcome', 'exhausted']    }, 1, 0] } },
            expired:      { $sum: { $cond: [{ $eq: ['$outcome', 'expired']      }, 1, 0] } },
            failed:       { $sum: { $cond: [{ $eq: ['$outcome', 'failed']       }, 1, 0] } },
            clicked:      { $sum: { $cond: [{ $eq: ['$outcome', 'clicked']      }, 1, 0] } },
            stillPending: { $sum: { $cond: [{ $eq: ['$outcome', 'pending']      }, 1, 0] } },
            stillSent:    { $sum: { $cond: [{ $eq: ['$outcome', 'sent']         }, 1, 0] } },

            avgAttemptsPerCheckout: { $avg: '$confirmedAttempts' },
          },
        },
      ]),

      // ── Outcome breakdown ─────────────────────────────────────────────────
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

      // ── Attempt distribution — "how many sends does it take to convert?" ──
      // Joined with checkout revenue for ROI-per-attempt-number analysis.
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
        { $unwind: { path: '$checkoutDoc', preserveNullAndEmpty: true } },
        {
          $group: {
            _id:            '$confirmedAttempts',
            conversions:    { $sum: 1 },
            totalRevenue:   { $sum: '$checkoutDoc.pricing.totalPrice' },
            avgCartValue:   { $avg: '$checkoutDoc.pricing.totalPrice' },
          },
        },
        { $sort: { _id: 1 } },
      ]),

      // ── Click funnel: sent → clicked → converted ──────────────────────────
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
                  { $in: ['$outcome', ['clicked', 'converted', 'organic', 're_abandoned']] },
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
    ]);

  const s  = summary[0] || {
    total: 0, totalConfirmedAttempts: 0, totalLinkClicks: 0, everClicked: 0,
    converted: 0, organic: 0, reAbandoned: 0, exhausted: 0, expired: 0,
    failed: 0, clicked: 0, stillPending: 0, stillSent: 0,
    avgAttemptsPerCheckout: 0,
  };
  const cf = clickFunnel[0] || { totalSent: 0, clicked: 0, converted: 0 };

  return {
    // ── KPIs ────────────────────────────────────────────────────────────────
    totalCampaigns:         s.total,
    totalSendAttempts:      s.totalConfirmedAttempts,
    totalLinkClicks:        s.totalLinkClicks,
    linkClickRate:
      s.total > 0 ? Math.round((s.everClicked / s.total) * 10000) / 100 : 0,
    conversionRate:
      s.total > 0 ? Math.round(((s.converted + s.organic) / s.total) * 10000) / 100 : 0,
    avgAttemptsPerCheckout:
      Math.round((s.avgAttemptsPerCheckout || 0) * 10) / 10,

    // ── Outcome summary ──────────────────────────────────────────────────────
    outcomes: {
      converted:   s.converted,
      organic:     s.organic,
      reAbandoned: s.reAbandoned,
      exhausted:   s.exhausted,
      expired:     s.expired,
      failed:      s.failed,
      clicked:     s.clicked,
      sent:        s.stillSent,
      pending:     s.stillPending,
    },

    // ── Click funnel ─────────────────────────────────────────────────────────
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

    // ── ROI by attempt number ────────────────────────────────────────────────
    // "Was sending a second/third email worth it?"
    revenueAttribution: attemptDistribution.map(row => ({
      attemptNumber: row._id,
      conversions:   row.conversions,
      totalRevenue:  Math.round((row.totalRevenue || 0) * 100) / 100,
      avgCartValue:  Math.round((row.avgCartValue  || 0) * 100) / 100,
    })),

    outcomeBreakdown,
  };
};


/**
 * getPendingStaleAcks
 * Used by the sweep to find RecoveryEmail records where pendingAck has been
 * true longer than the stale threshold (mailer crash recovery).
 */
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

// Self-heal: if confirmedAttempts drifted from the sent-attempt count,
// correct it before any save. Only fires when attempts was modified.
recoveryEmailSchema.pre('save', function (next) {
  if (this.isModified('attempts') && !this.pendingAck) {
    this.confirmedAttempts = this.attempts.filter(
      a => a.status === 'sent'
    ).length;
  }
  next();
});

export default mongoose.model('RecoveryEmail', recoveryEmailSchema);
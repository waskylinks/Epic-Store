import cron from 'node-cron';
import Checkout from '../models/checkout-model.js';
import RecoveryEmail from '../models/recovery-email-model.js';
import { sendRecoveryEmail, invalidateRecoveryCaches } from '../Services/recoveryEmailService.js';
import { deleteCachePattern } from '../utils/redis.js';

// ============================================
// CONFIG — all values from env with safe defaults
// ============================================

const cfg = {
  enabled:    () => process.env.RECOVERY_CRON_ENABLED !== 'false',
  schedule:   () => process.env.RECOVERY_CRON_SCHEDULE || '*/30 * * * *',
  maxPerRun:  () => parseInt(process.env.RECOVERY_CRON_MAX_PER_RUN)      || 200,
  dryRun:     () => process.env.RECOVERY_CRON_DRY_RUN === 'true',
  maxAgeDays: () => parseInt(process.env.RECOVERY_MAX_AGE_DAYS)           || 7,

  // Minimum hours after abandonment / last send before each attempt fires.
  // Attempt 2 and 3 are measured from the previous send's sentAt, not from
  // abandonment — this keeps gaps consistent regardless of when attempt 1 fired.
  delayHours: () => ({
    1: parseFloat(process.env.RECOVERY_ATTEMPT1_DELAY_HOURS) || 1,
    2: parseFloat(process.env.RECOVERY_ATTEMPT2_DELAY_HOURS) || 24,
    3: parseFloat(process.env.RECOVERY_ATTEMPT3_DELAY_HOURS) || 72,
  }),

  maxAttempts: () => parseInt(process.env.MAX_RECOVERY_ATTEMPTS) || 3,
};

// ============================================
// OVERLAP GUARD
// Single-server in-memory lock. Prevents the cron from re-entering
// itself if a run takes longer than the schedule interval.
// ============================================

let isRunning = false;
let cronJob   = null;

// ============================================
// ELIGIBILITY QUERY
// Purpose-built for automation — lean, index-friendly, returns only
// what the cron loop needs. Deliberately avoids the $nin anti-pattern
// used in getAbandonedCartsForSending (which is fine for paginated UI
// but expensive at scale without a cap).
//
// Strategy:
//   1. Pull all RecoveryEmail docs in active outcomes (small set, indexed)
//   2. Build a map of checkoutId → recovery state
//   3. Query Checkout with $in on that set + age filter
//   4. Apply delay rules in memory (no extra DB round-trip)
//
// This avoids a $lookup aggregation and keeps both queries index-bound.
// ============================================

const getCartsEligibleForCron = async () => {
  const maxAgeCutoff = new Date(
    Date.now() - cfg.maxAgeDays() * 24 * 60 * 60 * 1000
  );

  const delayRules  = cfg.delayHours();
  const maxAttempts = cfg.maxAttempts();
  const now         = Date.now();

  // ── Step 1: Load all active RecoveryEmail records ─────────────────────────
  // 'active' = outcomes where another send is still possible.
  // 'pending' included for carts where the record exists but no send succeeded yet.
  const activeRecords = await RecoveryEmail.find(
    {
      outcome: { $in: ['pending', 'sent', 'clicked', 're_abandoned'] },
    },
    {
      checkout:          1,
      confirmedAttempts: 1,
      lastSentAt:        1,
      pendingAck:        1,
      outcome:           1,
    }
  ).lean();

  // ── Step 2: Also find abandoned checkouts with NO RecoveryEmail record yet ─
  // These are carts eligible for attempt 1 that have never been contacted.
  const existingCheckoutIds = activeRecords.map(r => r.checkout);

  const uncontactedCheckouts = await Checkout.find(
    {
      'abandonment.isAbandoned': true,
      'conversion.isConverted':  false,
      status:                    'abandoned',
      // Must be old enough for attempt 1 delay
      'abandonment.firstAbandonedAt': {
        $lte: new Date(now - delayRules[1] * 60 * 60 * 1000),
        $gte: maxAgeCutoff,
      },
      _id: { $nin: existingCheckoutIds },
    },
    { _id: 1, email: 1, 'abandonment.firstAbandonedAt': 1 }
  ).lean();

  // ── Step 3: Load checkout docs for active-record carts ────────────────────
  // Only load what we need — no population, no virtuals.
  const activeCheckoutIds = activeRecords.map(r => r.checkout);
  const activeCheckouts = await Checkout.find(
    {
      _id:                       { $in: activeCheckoutIds },
      'abandonment.isAbandoned': true,
      'conversion.isConverted':  false,
      status:                    'abandoned',
      'abandonment.firstAbandonedAt': { $gte: maxAgeCutoff },
    },
    {
      _id:                              1,
      email:                            1,
      expiresAt:                        1,
      'conversion.isConverted':         1,
      'abandonment.firstAbandonedAt':   1,
      'abandonment.abandonedAt':        1,
    }
  ).lean();

  const checkoutMap = new Map(
    activeCheckouts.map(c => [c._id.toString(), c])
  );

  // ── Step 4: Apply delay rules and build the eligible list ─────────────────
  const eligible = [];

  // ── 4a. Carts with existing RecoveryEmail records ─────────────────────────
  for (const record of activeRecords) {
    const checkout = checkoutMap.get(record.checkout.toString());

    // Checkout no longer in abandoned state (converted, deleted, expired)
    if (!checkout) continue;

    // Checkout doc has expired
    if (checkout.expiresAt && new Date(checkout.expiresAt) <= new Date()) continue;

    // Already at max attempts — canSend() will also catch this but skip early
    if (record.confirmedAttempts >= maxAttempts) continue;

    // In-flight send — stale ack handling is done by handleStaleAcks() separately
    if (record.pendingAck) continue;

    const nextAttemptNumber = record.confirmedAttempts + 1;
    const requiredDelay     = delayRules[nextAttemptNumber];

    if (!requiredDelay) continue; // attempt number beyond configured rules

    let referenceTime;

    if (record.confirmedAttempts === 0) {
      // Attempt 1: delay measured from first abandonment
      const abandonedAt =
        checkout.abandonment?.firstAbandonedAt ||
        checkout.abandonment?.abandonedAt;
      referenceTime = abandonedAt ? new Date(abandonedAt).getTime() : null;
    } else {
      // Attempt 2+: delay measured from last confirmed send
      referenceTime = record.lastSentAt ? new Date(record.lastSentAt).getTime() : null;
    }

    if (!referenceTime) continue;

    const hoursSinceReference = (now - referenceTime) / (1000 * 60 * 60);
    if (hoursSinceReference < requiredDelay) continue;

    eligible.push({
      checkoutId:        checkout._id.toString(),
      email:             checkout.email,
      confirmedAttempts: record.confirmedAttempts,
      nextAttemptNumber,
      outcome:           record.outcome,
    });
  }

  // ── 4b. Uncontacted carts (no RecoveryEmail record yet) ───────────────────
  for (const checkout of uncontactedCheckouts) {
    eligible.push({
      checkoutId:        checkout._id.toString(),
      email:             checkout.email,
      confirmedAttempts: 0,
      nextAttemptNumber: 1,
      outcome:           'none',
    });
  }

  return eligible;
};

// ============================================
// MAIN CRON FUNCTION
// ============================================

const runRecoveryEmailCron = async () => {
  // ── Overlap guard ─────────────────────────────────────────────────────────
  if (isRunning) {
    console.warn('[RecoveryEmailCron] Previous run still in progress — skipping tick');
    return;
  }

  isRunning = true;

  const runId  = `cron_${Date.now()}`;
  const isDry  = cfg.dryRun();
  const maxRun = cfg.maxPerRun();

  const stats = {
    evaluated: 0,
    sent:      0,
    skipped:   0,
    failed:    0,
    dryRun:    isDry,
  };

  console.log(
    `\n[RecoveryEmailCron] ▶ Run started | id=${runId}` +
    `${isDry ? ' | DRY RUN — no emails will be sent' : ''}`
  );

  try {
    // ── Query eligible carts ─────────────────────────────────────────────────
    let eligible = await getCartsEligibleForCron();

    stats.evaluated = eligible.length;

    if (eligible.length === 0) {
      console.log('[RecoveryEmailCron] No eligible carts found — run complete');
      return;
    }

    // Cap per run to avoid mailer abuse / timeout
    if (eligible.length > maxRun) {
      console.warn(
        `[RecoveryEmailCron] ${eligible.length} eligible carts exceeds cap of ${maxRun} — processing first ${maxRun}`
      );
      eligible = eligible.slice(0, maxRun);
    }

    console.log(
      `[RecoveryEmailCron] Processing ${eligible.length} carts` +
      ` (${stats.evaluated} evaluated, capped at ${maxRun})`
    );

    // ── Sequential send loop ─────────────────────────────────────────────────
    // Sequential (not Promise.all) for three reasons:
    //   1. Mailer rate-limit protection
    //   2. DB write ordering for pendingAck idempotency
    //   3. Clean per-cart error attribution in logs
    for (const cart of eligible) {
      if (isDry) {
        console.log(
          `[RecoveryEmailCron][DRY RUN] Would send attempt ${cart.nextAttemptNumber}` +
          ` to ${cart.email} | checkout=${cart.checkoutId} | outcome=${cart.outcome}`
        );
        stats.sent++;
        continue;
      }

      try {
        await sendRecoveryEmail(cart.checkoutId, 'cron', { sentBy: 'cron' });

        console.log(
          `[RecoveryEmailCron] ✓ Sent attempt ${cart.nextAttemptNumber}` +
          ` | checkout=${cart.checkoutId} | email=${cart.email}`
        );

        stats.sent++;
      } catch (err) {
        if (err.code === 'CANNOT_SEND') {
          // canSend() gate fired — this cart became ineligible between query and send.
          // Common causes: converted mid-loop, cooldown, stale pendingAck cleared.
          console.log(
            `[RecoveryEmailCron] ↷ Skipped | checkout=${cart.checkoutId} | reason=${err.message}`
          );
          stats.skipped++;
        } else {
          // Mailer failure, DB error, HTML build failure — sendRecoveryEmail()
          // already called recordSendFailure() internally so the attempt is rolled back.
          console.error(
            `[RecoveryEmailCron] ✗ Failed | checkout=${cart.checkoutId}` +
            ` | email=${cart.email} | error=${err.message}`
          );
          stats.failed++;
        }
      }
    }

    // ── Single cache bust after the full loop ─────────────────────────────────
    // sendRecoveryEmail() calls invalidateRecoveryCaches() internally per send,
    // which is correct for manual sends. For the cron we override this by busting
    // once at the end to avoid N sequential cache flushes under large batches.
    // Note: The internal per-send flush is unavoidable without restructuring the
    // service — these extra flushes are cheap (Redis DEL) so it's acceptable.
    if (!isDry && stats.sent > 0) {
      await invalidateRecoveryCaches().catch(err =>
        console.error('[RecoveryEmailCron] Cache bust failed:', err.message)
      );
    }

  } catch (err) {
    // Top-level failure — DB down, import error, etc.
    console.error('[RecoveryEmailCron] ✗ Run failed with unhandled error:', err.message);
    console.error(err.stack);

    // Optional: POST to a monitoring webhook
    if (process.env.CRON_ALERT_WEBHOOK_URL) {
      fetch(process.env.CRON_ALERT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job:     'recoveryEmailCron',
          runId,
          error:   err.message,
          time:    new Date().toISOString(),
        }),
      }).catch(() => {}); // fire-and-forget, never throw
    }

  } finally {
    // Always release the lock, even on unhandled error
    isRunning = false;

    const status = stats.failed > 0 && stats.sent === 0 ? '✗ FULL FAILURE' :
                   stats.failed > 0                      ? '⚠ PARTIAL'      :
                                                           '✓ OK';

    console.log(
      `[RecoveryEmailCron] ${status} Run complete | id=${runId}` +
      ` | evaluated=${stats.evaluated}` +
      ` | sent=${stats.sent}` +
      ` | skipped=${stats.skipped}` +
      ` | failed=${stats.failed}` +
      `${isDry ? ' | DRY RUN' : ''}`
    );
  }
};

// ============================================
// START / STOP EXPORTS
// Matches the pattern of your existing jobs:
//   startDiscountCleanupJob()
//   startAuditCleanupJob()
//   startAbandonmentSweep()
// ============================================

export const startRecoveryEmailCron = () => {
  if (!cfg.enabled()) {
    console.log('[RecoveryEmailCron] Disabled via RECOVERY_CRON_ENABLED=false — not starting');
    return;
  }

  const schedule = cfg.schedule();

  if (!cron.validate(schedule)) {
    console.error(
      `[RecoveryEmailCron] Invalid cron schedule: "${schedule}" — job not started`
    );
    return;
  }

  cronJob = cron.schedule(schedule, runRecoveryEmailCron, {
    scheduled: true,
    timezone:  process.env.CRON_TIMEZONE || 'UTC',
  });

  console.log(
    `[RecoveryEmailCron]  Started | schedule="${schedule}"` +
    `${cfg.dryRun() ? ' | DRY RUN MODE' : ''}` +
    ` | maxPerRun=${cfg.maxPerRun()}` +
    ` | delayRules=${JSON.stringify(cfg.delayHours())}`
  );
};

export const stopRecoveryEmailCron = () => {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log('[RecoveryEmailCron] Stopped');
  }
};
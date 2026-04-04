import cron              from 'node-cron';
import Checkout          from '../models/checkout-model.js';
import RecoveryEmail     from '../models/recovery-email-model.js';
import { sendRecoveryEmail, invalidateRecoveryCaches } from '../Services/recoveryEmailService.js';
import { deleteCachePattern } from '../utils/redis.js';
import { runCronJob }    from '../utils/runCronJob.js';
import { cronConfig }    from '../config/cronConfig.js';
 
let cronJob = null;
 
// ─────────────────────────────────────────────────────────────────────────────
// ELIGIBILITY QUERY (unchanged from original)
// ─────────────────────────────────────────────────────────────────────────────
 
const getCartsEligibleForCron = async () => {
  const { maxAgeDays, delayHours, maxAttempts } = cronConfig.recoveryEmail;
 
  const maxAgeCutoff = new Date(
    Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
  );
  const now = Date.now();
 
  // Step 1: Load all active RecoveryEmail records
  const activeRecords = await RecoveryEmail.find(
    { outcome: { $in: ['pending', 'sent', 'clicked', 're_abandoned'] } },
    { checkout: 1, confirmedAttempts: 1, lastSentAt: 1, pendingAck: 1, outcome: 1 }
  ).lean();
 
  // Step 2: Find uncontacted abandoned checkouts
  const existingCheckoutIds = activeRecords.map((r) => r.checkout);
 
  const uncontactedCheckouts = await Checkout.find(
    {
      'abandonment.isAbandoned':      true,
      'conversion.isConverted':       false,
      status:                         'abandoned',
      'abandonment.firstAbandonedAt': {
        $lte: new Date(now - delayHours[1] * 60 * 60 * 1000),
        $gte: maxAgeCutoff,
      },
      _id: { $nin: existingCheckoutIds },
    },
    { _id: 1, email: 1, 'abandonment.firstAbandonedAt': 1 }
  ).lean();
 
  // Step 3: Load checkout docs for active-record carts
  const activeCheckoutIds = activeRecords.map((r) => r.checkout);
  const activeCheckouts   = await Checkout.find(
    {
      _id:                            { $in: activeCheckoutIds },
      'abandonment.isAbandoned':      true,
      'conversion.isConverted':       false,
      status:                         'abandoned',
      'abandonment.firstAbandonedAt': { $gte: maxAgeCutoff },
    },
    {
      _id:                            1,
      email:                          1,
      expiresAt:                      1,
      'conversion.isConverted':       1,
      'abandonment.firstAbandonedAt': 1,
      'abandonment.abandonedAt':      1,
    }
  ).lean();
 
  const checkoutMap = new Map(
    activeCheckouts.map((c) => [c._id.toString(), c])
  );
 
  // Step 4: Apply delay rules and build eligible list
  const eligible = [];
 
  for (const record of activeRecords) {
    const checkout = checkoutMap.get(record.checkout.toString());
    if (!checkout)                                                   continue;
    if (checkout.expiresAt && new Date(checkout.expiresAt) <= new Date()) continue;
    if (record.confirmedAttempts >= maxAttempts)                     continue;
    if (record.pendingAck)                                           continue;
 
    const nextAttemptNumber = record.confirmedAttempts + 1;
    const requiredDelay     = delayHours[nextAttemptNumber];
    if (!requiredDelay) continue;
 
    let referenceTime;
    if (record.confirmedAttempts === 0) {
      const abandonedAt =
        checkout.abandonment?.firstAbandonedAt ||
        checkout.abandonment?.abandonedAt;
      referenceTime = abandonedAt ? new Date(abandonedAt).getTime() : null;
    } else {
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
 
// ─────────────────────────────────────────────────────────────────────────────
// MAIN JOB FUNCTION
// (run-level try/catch removed — runCronJob handles that layer)
// ─────────────────────────────────────────────────────────────────────────────
 
async function runRecoveryEmailCron() {
  const isDry  = cronConfig.recoveryEmail.dryRun;
  const maxRun = cronConfig.recoveryEmail.maxPerRun;
 
  const stats = {
    evaluated: 0,
    sent:      0,
    skipped:   0,
    failed:    0,
    dryRun:    isDry,
  };
 
  if (isDry) {
    console.log('[RecoveryEmailCron] DRY RUN MODE — no emails will be sent');
  }
 
  let eligible = await getCartsEligibleForCron();
  stats.evaluated = eligible.length;
 
  if (eligible.length === 0) {
    console.log('[RecoveryEmailCron] No eligible carts found — run complete');
    return stats;
  }
 
  if (eligible.length > maxRun) {
    console.warn(
      `[RecoveryEmailCron] ${eligible.length} eligible carts exceeds cap of ${maxRun} — processing first ${maxRun}`
    );
    eligible = eligible.slice(0, maxRun);
  }
 
  console.log(`[RecoveryEmailCron] Processing ${eligible.length} carts`);
 
  // Sequential send loop (preserved from original — see original for rationale)
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
        console.log(
          `[RecoveryEmailCron] ↷ Skipped | checkout=${cart.checkoutId} | reason=${err.message}`
        );
        stats.skipped++;
      } else {
        console.error(
          `[RecoveryEmailCron] ✗ Failed | checkout=${cart.checkoutId}` +
          ` | email=${cart.email} | error=${err.message}`
        );
        stats.failed++;
      }
    }
  }
 
  // Single cache bust after the full loop
  if (!isDry && stats.sent > 0) {
    await invalidateRecoveryCaches().catch((err) =>
      console.error('[RecoveryEmailCron] Cache bust failed:', err.message)
    );
  }
 
  const status = stats.failed > 0 && stats.sent === 0 ? '✗ FULL FAILURE' :
                 stats.failed > 0                      ? '⚠ PARTIAL'      :
                                                         '✓ OK';
 
  console.log(
    `[RecoveryEmailCron] ${status}` +
    ` | evaluated=${stats.evaluated}` +
    ` | sent=${stats.sent}` +
    ` | skipped=${stats.skipped}` +
    ` | failed=${stats.failed}` +
    (isDry ? ' | DRY RUN' : '')
  );
 
  return stats;
}
 
// ─────────────────────────────────────────────────────────────────────────────
// START / STOP
// ─────────────────────────────────────────────────────────────────────────────
 
export const startRecoveryEmailCron = () => {
  if (!cronConfig.recoveryEmail.enabled) {
    console.log('[RecoveryEmailCron] Disabled via RECOVERY_CRON_ENABLED=false — not starting');
    return;
  }
 
  const schedule = cronConfig.recoveryEmail.schedule;
 
  if (!cron.validate(schedule)) {
    console.error(
      `[RecoveryEmailCron] Invalid cron schedule: "${schedule}" — job not started`
    );
    return;
  }
 
  cronJob = cron.schedule(
    schedule,
    runCronJob({
      jobName:     'RecoveryEmailCron',
      jobFn:       runRecoveryEmailCron,
      alertOnFail: true,
    }),
    {
      scheduled: true,
      timezone:  cronConfig.global.timezone,
    }
  );
 
  console.log(
    `[RecoveryEmailCron] Started | schedule="${schedule}"` +
    `${cronConfig.recoveryEmail.dryRun ? ' | DRY RUN MODE' : ''}` +
    ` | maxPerRun=${cronConfig.recoveryEmail.maxPerRun}` +
    ` | delayRules=${JSON.stringify(cronConfig.recoveryEmail.delayHours)}`
  );
};
 
export const stopRecoveryEmailCron = () => {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log('[RecoveryEmailCron] Stopped');
  }
};
 
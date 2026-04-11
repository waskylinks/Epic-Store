import cron              from 'node-cron';
import Checkout          from '../models/checkout-model.js';
import RecoveryEmail     from '../models/recovery-email-model.js';
import { sendRecoveryEmail, invalidateRecoveryCaches } from '../Services/recoveryEmailService.js';
import { runCronJob }    from '../utils/runCronJob.js';
import { cronConfig }    from '../config/cronConfig.js';

let cronJob = null;

// ─────────────────────────────────────────────────────────────────────────────
// ELIGIBILITY QUERY
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

  const existingCheckoutIds = activeRecords.map((r) => r.checkout);

  // Step 2: Find uncontacted abandoned checkouts.
  // delayHours[1] is the required wait before the first email.
  // We use $or to handle both field paths (firstAbandonedAt preferred,
  // abandonedAt as fallback for older documents).
  const firstEmailDelayCutoff = new Date(
    now - (delayHours[1] ?? 1) * 60 * 60 * 1000
  );

  const uncontactedCheckouts = await Checkout.find(
    {
      'abandonment.isAbandoned': true,
      'conversion.isConverted':  false,
      status:                    'abandoned',
      _id:                       { $nin: existingCheckoutIds },
      $or: [
        // Preferred path: firstAbandonedAt exists and is within the valid window
        {
          'abandonment.firstAbandonedAt': {
            $exists: true,
            $lte:    firstEmailDelayCutoff,
            $gte:    maxAgeCutoff,
          },
        },
        // Fallback path: firstAbandonedAt missing, use abandonedAt
        {
          'abandonment.firstAbandonedAt': { $exists: false },
          'abandonment.abandonedAt': {
            $exists: true,
            $lte:    firstEmailDelayCutoff,
            $gte:    maxAgeCutoff,
          },
        },
        // Second fallback: firstAbandonedAt is null (explicitly set to null
        // rather than missing — Mongoose can store null for unset Date fields)
        {
          'abandonment.firstAbandonedAt': null,
          'abandonment.abandonedAt': {
            $exists: true,
            $lte:    firstEmailDelayCutoff,
            $gte:    maxAgeCutoff,
          },
        },
      ],
    },
    {
      _id:                            1,
      email:                          1,
      'abandonment.firstAbandonedAt': 1,
      'abandonment.abandonedAt':      1,
    }
  ).lean();

  // Diagnostic: log what the query found so you can verify in dev
  if (process.env.NODE_ENV !== 'production') {
    const totalAbandoned = await Checkout.countDocuments({
      'abandonment.isAbandoned': true,
      'conversion.isConverted':  false,
      status:                    'abandoned',
    });
    const excludedByActiveRecord = await Checkout.countDocuments({
      'abandonment.isAbandoned': true,
      'conversion.isConverted':  false,
      status:                    'abandoned',
      _id:                       { $in: existingCheckoutIds },
    });
    const tooRecentCount = await Checkout.countDocuments({
      'abandonment.isAbandoned': true,
      'conversion.isConverted':  false,
      status:                    'abandoned',
      _id:                       { $nin: existingCheckoutIds },
      $or: [
        {
          'abandonment.firstAbandonedAt': {
            $exists: true,
            $gt:     firstEmailDelayCutoff,
          },
        },
        {
          'abandonment.firstAbandonedAt': { $in: [null, undefined] },
          'abandonment.abandonedAt':      { $exists: true, $gt: firstEmailDelayCutoff },
        },
        {
          'abandonment.firstAbandonedAt': { $exists: false },
          'abandonment.abandonedAt':      { $exists: false },
        },
      ],
    });

    console.log(
      `[RecoveryEmailCron][DEBUG] totalAbandoned=${totalAbandoned}` +
      ` | excludedByActiveRecord=${excludedByActiveRecord}` +
      ` | tooRecent(within ${delayHours[1]}h)=${tooRecentCount}` +
      ` | firstEmailDelayCutoff=${firstEmailDelayCutoff.toISOString()}` +
      ` | maxAgeCutoff=${maxAgeCutoff.toISOString()}` +
      ` | uncontactedEligible=${uncontactedCheckouts.length}`
    );
  }

  // Step 3: Load checkout docs for active-record carts
  const activeCheckoutIds = activeRecords.map((r) => r.checkout);
  const activeCheckouts   = await Checkout.find(
    {
      _id:                       { $in: activeCheckoutIds },
      'abandonment.isAbandoned': true,
      'conversion.isConverted':  false,
      status:                    'abandoned',
      $or: [
        { 'abandonment.firstAbandonedAt': { $exists: true, $ne: null, $gte: maxAgeCutoff } },
        {
          $or: [
            { 'abandonment.firstAbandonedAt': { $exists: false } },
            { 'abandonment.firstAbandonedAt': null },
          ],
          'abandonment.abandonedAt': { $exists: true, $gte: maxAgeCutoff },
        },
      ],
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

  // Step 4: Apply delay rules to active-record carts
  const eligible = [];

  for (const record of activeRecords) {
    const checkout = checkoutMap.get(record.checkout.toString());
    if (!checkout)                                                    continue;
    if (checkout.expiresAt && new Date(checkout.expiresAt) <= new Date()) continue;
    if (record.confirmedAttempts >= maxAttempts)                      continue;
    if (record.pendingAck)                                            continue;

    const nextAttemptNumber = record.confirmedAttempts + 1;
    const requiredDelay     = delayHours[nextAttemptNumber];
    if (requiredDelay == null) continue;

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

  // Step 5: Add uncontacted checkouts (first email, attempt 1)
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
      // sentBy: 'cron' is the only attribution now — admin sends have been removed
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
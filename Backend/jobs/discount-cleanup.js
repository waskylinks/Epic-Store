

import mongoose          from 'mongoose';
import cron              from 'node-cron';
import Discount          from '../models/discount-model.js';
import DiscountAnalytics from '../models/discount-analytics-model.js';
import { runCronJob }    from '../utils/runCronJob.js';
import { cronConfig }    from '../config/cronConfig.js';

// ─────────────────────────────────────────────────────────────────────────────
// CORE LOGIC
// ─────────────────────────────────────────────────────────────────────────────

export async function runCleanup() {
  const start = Date.now();
  console.log(`[DiscountCleanup] Starting — ${new Date().toISOString()}`);

  // Step 1: flip active → expired for anything past validUntil
  const expired = await Discount.bulkExpireStale();
  console.log(`[DiscountCleanup] Marked ${expired} discount(s) as expired`);

  const { totalDeleted: deleted, deletedIds } = await Discount.deleteOldExpired(
    cronConfig.discountCleanup.hardDeleteDays,
    cronConfig.discountCleanup.batchSize
  );

  console.log(
    `[DiscountCleanup] Hard-deleted ${deleted} UNUSED expired discount(s) ` +
    `older than ${cronConfig.discountCleanup.hardDeleteDays} days. ` +
    `Codes with any recorded usage are permanently retained and were not touched.`
  );

  let analyticsDeleted = 0;
  if (deletedIds.length > 0) {
    const analyticsResult = await DiscountAnalytics.deleteMany({
      discountId: { $in: deletedIds },
    });
    analyticsDeleted = analyticsResult.deletedCount;
    console.log(
      `[DiscountCleanup] Deleted ${analyticsDeleted} orphaned DiscountAnalytics document(s) ` +
      `for the same set of unused codes.`
    );
  }

  const elapsed = Date.now() - start;
  console.log(
    `[DiscountCleanup] Done in ${elapsed}ms — ` +
    `expired: ${expired}, deleted (unused only): ${deleted}, analyticsDeleted: ${analyticsDeleted}`
  );

  return { expired, deleted, analyticsDeleted, elapsedMs: elapsed };
}

// ─────────────────────────────────────────────────────────────────────────────
// A) IN-PROCESS CRON JOB (node-cron)
// ─────────────────────────────────────────────────────────────────────────────

export function startDiscountCleanupJob() {
  const expr = cronConfig.discountCleanup.cronExpression;

  if (!cron.validate(expr)) {
    console.error(`[DiscountCleanup] Invalid cron expression: "${expr}"`);
    return;
  }

  cron.schedule(
    expr,
    runCronJob({
      jobName:     'DiscountCleanup',
      jobFn:       runCleanup,
      alertOnFail: true,
    }),
    { timezone: cronConfig.global.timezone }
  );

  console.log(`[DiscountCleanup] Job scheduled — cron: "${expr}"`);
}

// ─────────────────────────────────────────────────────────────────────────────
// B) STANDALONE SCRIPT ENTRY POINT
// Run: node jobs/discount-cleanup.js
// ─────────────────────────────────────────────────────────────────────────────

async function runStandalone() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('[DiscountCleanup] MONGODB_URI is not set');
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
    console.log('[DiscountCleanup] Connected to MongoDB');

    await runCleanup();

    await mongoose.disconnect();
    console.log('[DiscountCleanup] Disconnected — exiting');
    process.exit(0);
  } catch (err) {
    console.error('[DiscountCleanup] Fatal error:', err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
}

const isMain = process.argv[1] && process.argv[1].endsWith('discount-cleanup.js');
if (isMain) runStandalone();
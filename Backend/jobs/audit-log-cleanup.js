import mongoose          from 'mongoose';
import cron              from 'node-cron';
import { randomUUID }    from 'crypto';
import DiscountAuditLog  from '../models/DiscountAuditLog.js';
import AuditPurgeLog     from '../models/AuditPurgeLog.js';
import { runCronJob }    from '../utils/runCronJob.js';
import { sendCronAlert } from '../utils/cronAlert.js';
import { cronConfig }    from '../config/cronConfig.js';
 
// ─────────────────────────────────────────────────────────────────────────────
// CORE LOGIC
// ─────────────────────────────────────────────────────────────────────────────
 
export async function runAuditCleanup() {
  const start = Date.now();
  console.log(`[AuditCleanup] Starting — ${new Date().toISOString()}`);
 
  const { retentionDays, graceDays, batchSize } = cronConfig.auditCleanup;
 
  const results = {
    flagged:        0,
    deleted:        0,
    safetyReset:    0,
    purgeReceiptId: null,
    elapsedMs:      0,
  };
 
  try {
    await pass1Flag(results, { retentionDays, graceDays });
    await pass2AutoDelete(results, { batchSize });
    await pass3SafetyReset(results);
  } catch (err) {
    console.error('[AuditCleanup] Error during run:', err);
    throw err;
  }
 
  results.elapsedMs = Date.now() - start;
  console.log(
    `[AuditCleanup] Done in ${results.elapsedMs}ms — ` +
    `flagged: ${results.flagged}, deleted: ${results.deleted}, ` +
    `safetyReset: ${results.safetyReset}`
  );
 
  return results;
}
 
// ─────────────────────────────────────────────────────────────────────────────
// PASS 1 — Flag records older than retentionDays (silent)
// ─────────────────────────────────────────────────────────────────────────────
 
async function pass1Flag(results, { retentionDays, graceDays }) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
 
  const scheduledDeleteAt = new Date();
  scheduledDeleteAt.setDate(scheduledDeleteAt.getDate() + graceDays);
 
  const flagResult = await DiscountAuditLog.updateMany(
    { status: 'active', performedAt: { $lt: cutoff } },
    { $set: { status: 'pending_deletion', scheduledDeleteAt } }
  );
 
  results.flagged = flagResult.modifiedCount;
 
  await DiscountAuditLog.logSystemEvent('sweep_run', {
    flaggedCount:  results.flagged,
    retentionDays,
    graceDays,
    cutoffDate:    cutoff.toISOString(),
  });
 
  if (results.flagged > 0) {
    console.log(
      `[AuditCleanup] Pass 1: flagged ${results.flagged} record(s) ` +
      `(scheduledDeleteAt: ${scheduledDeleteAt.toISOString()})`
    );
  } else {
    console.log(`[AuditCleanup] Pass 1: no records to flag`);
  }
}
 
// ─────────────────────────────────────────────────────────────────────────────
// PASS 2 — Auto-delete matured records
// FIX #12 — two sub-passes instead of loading the full result set into memory.
// FIX #4  — date range computed with reduce() instead of Math.min/max spread.
// UPDATE #3 — countMismatch fires Slack warning alert.
// ─────────────────────────────────────────────────────────────────────────────
 
async function pass2AutoDelete(results, { batchSize }) {
  const now        = new Date();
  const runCeiling = new mongoose.Types.ObjectId();
 
  const baseFilter = {
    status:            'pending_deletion',
    scheduledDeleteAt: { $lte: now },
    _id:               { $lt: runCeiling },
  };
 
  // Sub-pass A: aggregate metadata only (no document bodies loaded)
  const metaAgg = await DiscountAuditLog.aggregate([
    { $match: baseFilter },
    {
      $group: {
        _id:            null,
        recordCount:    { $sum: 1 },
        minPerformedAt: { $min: '$performedAt' },
        maxPerformedAt: { $max: '$performedAt' },
        codes:          { $addToSet: '$discountCode' },
      },
    },
  ]);
 
  if (!metaAgg.length || metaAgg[0].recordCount === 0) {
    console.log(`[AuditCleanup] Pass 2: no matured records to delete`);
    return;
  }
 
  const { recordCount, minPerformedAt, maxPerformedAt, codes } = metaAgg[0];
  const dateRangeFrom         = new Date(minPerformedAt);
  const dateRangeTo           = new Date(maxPerformedAt);
  const discountCodesAffected = codes.filter((c) => c !== 'SYSTEM');
  const batchReference        = randomUUID();
 
  // Write receipt BEFORE any deletion
  const receipt = await AuditPurgeLog.createReceipt({
    batchReference,
    recordCount,
    dateRangeFrom,
    dateRangeTo,
    discountCodesAffected,
  });
 
  console.log(
    `[AuditCleanup] Pass 2: receipt written (batchReference: ${batchReference}). ` +
    `Deleting ${recordCount} record(s) in batches of ${batchSize}…`
  );
 
  // Sub-pass B: batch-delete — only _id fields loaded per iteration
  let totalDeleted = 0;
 
  while (true) {
    const batch = await DiscountAuditLog.find(baseFilter, { _id: 1 })
      .limit(batchSize)
      .lean();
 
    if (batch.length === 0) break;
 
    const ids = batch.map((r) => r._id);
    const { deletedCount } = await DiscountAuditLog.deleteMany({ _id: { $in: ids } });
    totalDeleted += deletedCount;
 
    await new Promise((resolve) => setImmediate(resolve));
  }
 
  const countMismatch = totalDeleted !== recordCount;
 
  await AuditPurgeLog.finalise(
    batchReference,
    totalDeleted,
    countMismatch
      ? `Partial deletion detected: expected ${recordCount}, deleted ${totalDeleted}. ` +
        `Remaining records will be re-processed in next run.`
      : null
  );
 
  await DiscountAuditLog.logSystemEvent('sweep_auto_deleted', {
    deletedCount:            totalDeleted,
    expectedCount:           recordCount,
    batchReference,
    purgeReceiptId:          receipt._id,
    dateRangeFrom:           dateRangeFrom.toISOString(),
    dateRangeTo:             dateRangeTo.toISOString(),
    discountCodesAffected,
    partialDeletionDetected: countMismatch,
  });
 
  results.deleted        = totalDeleted;
  results.purgeReceiptId = receipt._id;
 
  console.log(
    `[AuditCleanup] Pass 2: deleted ${totalDeleted}/${recordCount} record(s). ` +
    (countMismatch ? '⚠ Partial deletion detected.' : 'Complete.')
  );
 
  // UPDATE #3 — fire Slack warning on partial deletion
  if (countMismatch) {
    await sendCronAlert({
      jobName:  'AuditCleanup',
      runId:    batchReference,
      status:   'partial',
      severity: 'warning',
      message:  `Partial deletion detected. Expected ${recordCount}, deleted ${totalDeleted}. Will re-process in next run.`,
      counts:   { expected: recordCount, deleted: totalDeleted },
    });
  }
}
 
// ─────────────────────────────────────────────────────────────────────────────
// PASS 3 — Safety-net reset for records that survived Pass 2
// ─────────────────────────────────────────────────────────────────────────────
 
async function pass3SafetyReset(results) {
  const safetyMarginCutoff = new Date();
  safetyMarginCutoff.setDate(safetyMarginCutoff.getDate() - 1);
 
  const resetResult = await DiscountAuditLog.updateMany(
    {
      status:            'pending_deletion',
      scheduledDeleteAt: { $lt: safetyMarginCutoff },
    },
    {
      $set:   { status: 'active' },
      $unset: { scheduledDeleteAt: '' },
    }
  );
 
  results.safetyReset = resetResult.modifiedCount;
 
  if (results.safetyReset > 0) {
    await DiscountAuditLog.logSystemEvent('sweep_window_expired', {
      resetCount: results.safetyReset,
      reason:
        'Records found in pending_deletion state past their scheduledDeleteAt. ' +
        'Likely caused by a partial deletion in a previous run. ' +
        'Records reset to active and will be re-flagged in next CRON run.',
    });
 
    console.warn(
      `[AuditCleanup] Pass 3 (safety net): reset ${results.safetyReset} ` +
      `stale pending_deletion record(s) to active.`
    );
  } else {
    console.log(`[AuditCleanup] Pass 3: no stale records found`);
  }
}
 
// ─────────────────────────────────────────────────────────────────────────────
// A) IN-PROCESS CRON JOB (node-cron)
// ─────────────────────────────────────────────────────────────────────────────
 
export function startAuditCleanupJob() {
  const expr = cronConfig.auditCleanup.cronExpression;
 
  if (!cron.validate(expr)) {
    console.error(`[AuditCleanup] Invalid cron expression: "${expr}"`);
    return;
  }
 
  cron.schedule(
    expr,
    runCronJob({
      jobName:     'AuditCleanup',
      jobFn:       runAuditCleanup,
      alertOnFail: true,
    }),
    { timezone: cronConfig.global.timezone }
  );
 
  console.log(`[AuditCleanup] Job scheduled — cron: "${expr}"`);
}
 
// ─────────────────────────────────────────────────────────────────────────────
// B) STANDALONE SCRIPT
// ─────────────────────────────────────────────────────────────────────────────
 
async function runStandalone() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('[AuditCleanup] MONGODB_URI is not set');
    process.exit(1);
  }
 
  try {
    await mongoose.connect(uri);
    console.log('[AuditCleanup] Connected to MongoDB');
    await runAuditCleanup();
    await mongoose.disconnect();
    console.log('[AuditCleanup] Disconnected — exiting');
    process.exit(0);
  } catch (err) {
    console.error('[AuditCleanup] Fatal error:', err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
}
 
const isMain =
  process.argv[1] && process.argv[1].endsWith('audit-log-cleanup.js');
if (isMain) runStandalone();
 
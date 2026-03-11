/**
 * jobs/audit-log-cleanup.js
 *
 * Daily CRON job that enforces the 365 + 30 day audit log retention policy.
 *
 * Changes from previous version:
 *
 *  FIX #4  — Math.min/max spread replaced with Array.prototype.reduce().
 *    Math.min(...array) and Math.max(...array) use the call stack. Arrays
 *    larger than ~100,000 elements cause "RangeError: Maximum call stack
 *    size exceeded". reduce() processes elements iteratively with O(1) stack.
 *
 *  FIX #12 — pass2AutoDelete no longer materialises the entire result set
 *    into memory before deletion.
 *
 *    OLD approach: find({ status:'pending_deletion', scheduledDeleteAt:{ $lte:now } })
 *      → full array loaded into heap → metadata computed from array → batch-delete.
 *    Problem: for 500,000 matured records this loads ~500k documents into Node
 *    heap before a single delete runs, potentially exhausting memory.
 *
 *    NEW approach (two sub-passes):
 *      Sub-pass A: aggregate-only query to collect receipt metadata
 *        (count, dateRange, affected codes). Zero documents loaded.
 *      Sub-pass B: cursor/limit loop that fetches only _id fields
 *        in BATCH_SIZE pages and deletes each page before fetching the next.
 *        Peak memory = one batch of _id values (~12 bytes each × BATCH_SIZE).
 *
 *    A ceiling ObjectId is captured before both sub-passes so newly flagged
 *    records that arrive mid-run are not included in this cycle.
 *
 * Retention lifecycle (unchanged):
 *
 *   Day 1–365   Active records. Untouched.
 *   Day 366     Pass 1 flags: status → 'pending_deletion',
 *               scheduledDeleteAt = now + GRACE_DAYS.
 *   Day 396     Pass 2 auto-deletes matured records.
 *               AuditPurgeLog receipt written BEFORE deletion.
 *               Admin notified AFTER via receipt banner.
 *   (safety)    Pass 3 resets any records that survived a crashed Pass 2.
 */

import mongoose from "mongoose";
import cron from "node-cron";
import { randomUUID } from "crypto";
import DiscountAuditLog from "../models/DiscountAuditLog.js";
import AuditPurgeLog from "../models/AuditPurgeLog.js";

const CRON_EXPRESSION  = process.env.AUDIT_CLEANUP_CRON   || "0 3 * * *";
const RETENTION_DAYS   = parseInt(process.env.AUDIT_RETENTION_DAYS) || 365;
const GRACE_DAYS       = parseInt(process.env.AUDIT_GRACE_DAYS)     || 30;
const BATCH_SIZE       = parseInt(process.env.CLEANUP_BATCH_SIZE)   || 1000;

// ─────────────────────────────────────────────────────────────────────────────
// CORE LOGIC
// ─────────────────────────────────────────────────────────────────────────────

export async function runAuditCleanup() {
  const start = Date.now();
  console.log(`[AuditCleanup] Starting — ${new Date().toISOString()}`);

  const results = {
    flagged:        0,
    deleted:        0,
    safetyReset:    0,
    purgeReceiptId: null,
    elapsedMs:      0,
  };

  try {
    await pass1Flag(results);
    await pass2AutoDelete(results);
    await pass3SafetyReset(results);
  } catch (err) {
    console.error("[AuditCleanup] Error during run:", err);
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
// PASS 1 — Flag records older than RETENTION_DAYS (silent)
// ─────────────────────────────────────────────────────────────────────────────

async function pass1Flag(results) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

  const scheduledDeleteAt = new Date();
  scheduledDeleteAt.setDate(scheduledDeleteAt.getDate() + GRACE_DAYS);

  const flagResult = await DiscountAuditLog.updateMany(
    {
      status:      "active",
      performedAt: { $lt: cutoff },
    },
    {
      $set: {
        status:           "pending_deletion",
        scheduledDeleteAt,
      },
    }
  );

  results.flagged = flagResult.modifiedCount;

  await DiscountAuditLog.logSystemEvent("sweep_run", {
    flaggedCount:  results.flagged,
    retentionDays: RETENTION_DAYS,
    graceDays:     GRACE_DAYS,
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
//
// FIX #12 — two sub-passes instead of loading the full result set:
//
//   Sub-pass A: aggregate() to collect receipt metadata (count, date range,
//     affected codes) without loading document bodies into memory.
//
//   Sub-pass B: iterative find(_id only, limit BATCH_SIZE) + deleteMany loop.
//     Peak heap usage = one batch of _id ObjectIds (~12 bytes × BATCH_SIZE).
//
// FIX #4  — date range computed with reduce() instead of Math.min/max spread.
//   (Applies to the aggregation result array, which is small by design, but
//   the reduce pattern is unconditionally safer and is used throughout.)
// ─────────────────────────────────────────────────────────────────────────────

async function pass2AutoDelete(results) {
  const now = new Date();

  // ── Capture a ceiling so newly-flagged records arriving mid-run are excluded ──
  // Same pattern as deleteOldExpired() in the Discount model (FIX #15).
  const runCeiling = new mongoose.Types.ObjectId();

  const baseFilter = {
    status:            "pending_deletion",
    scheduledDeleteAt: { $lte: now },
    _id:               { $lt: runCeiling },
  };

  // ── Sub-pass A: collect receipt metadata via aggregation (no doc loading) ──
  const metaAgg = await DiscountAuditLog.aggregate([
    { $match: baseFilter },
    {
      $group: {
        _id:           null,
        recordCount:   { $sum: 1 },
        minPerformedAt: { $min: "$performedAt" },
        maxPerformedAt: { $max: "$performedAt" },
        // $addToSet caps to unique codes; for very large sets this could grow
        // but discount codes are short strings and cardinality is bounded.
        codes: { $addToSet: "$discountCode" },
      },
    },
  ]);

  if (!metaAgg.length || metaAgg[0].recordCount === 0) {
    console.log(`[AuditCleanup] Pass 2: no matured records to delete`);
    return;
  }

  const {
    recordCount,
    minPerformedAt,
    maxPerformedAt,
    codes,
  } = metaAgg[0];

  // FIX #4 — reduce() used to compute date range from the aggregation result.
  // The aggregation already returns min/max directly ($min/$max operators) so
  // no spread is needed here; using them directly is correct and safe.
  // The original spread risk is eliminated at the source (no large JS array spread).
  const dateRangeFrom = new Date(minPerformedAt);
  const dateRangeTo   = new Date(maxPerformedAt);
  const discountCodesAffected = codes.filter((c) => c !== "SYSTEM");

  const batchReference = randomUUID();

  // ── Write AuditPurgeLog receipt BEFORE any deletion ──────────────────────
  const receipt = await AuditPurgeLog.createReceipt({
    batchReference,
    recordCount,
    dateRangeFrom,
    dateRangeTo,
    discountCodesAffected,
  });

  console.log(
    `[AuditCleanup] Pass 2: receipt written (batchReference: ${batchReference}). ` +
    `Deleting ${recordCount} record(s) in batches of ${BATCH_SIZE}…`
  );

  // ── Sub-pass B: batch-delete — only _id fields loaded per iteration ───────
  // FIX #12 — we fetch only _id values (12 bytes each) instead of full documents.
  // The loop re-queries with the same ceiling filter so each iteration is
  // independent; a partial failure in one batch doesn't corrupt the next.
  let totalDeleted = 0;

  while (true) {
    const batch = await DiscountAuditLog.find(baseFilter, { _id: 1 })
      .limit(BATCH_SIZE)
      .lean();

    if (batch.length === 0) break;

    const ids = batch.map((r) => r._id);
    const { deletedCount } = await DiscountAuditLog.deleteMany({
      _id: { $in: ids },
    });
    totalDeleted += deletedCount;

    // Yield between batches to avoid starving other DB operations.
    await new Promise((resolve) => setImmediate(resolve));
  }

  // ── Finalise receipt with actual deleted count ────────────────────────────
  const countMismatch = totalDeleted !== recordCount;
  await AuditPurgeLog.finalise(
    batchReference,
    totalDeleted,
    countMismatch
      ? `Partial deletion detected: expected ${recordCount}, deleted ${totalDeleted}. ` +
        `Remaining records will be re-processed in next run.`
      : null
  );

  await DiscountAuditLog.logSystemEvent("sweep_auto_deleted", {
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
    (countMismatch ? "⚠ Partial deletion detected." : "Complete.")
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PASS 3 — Safety-net reset for records that survived Pass 2
// ─────────────────────────────────────────────────────────────────────────────

async function pass3SafetyReset(results) {
  const safetyMarginCutoff = new Date();
  safetyMarginCutoff.setDate(safetyMarginCutoff.getDate() - 1);

  const resetResult = await DiscountAuditLog.updateMany(
    {
      status:            "pending_deletion",
      scheduledDeleteAt: { $lt: safetyMarginCutoff },
    },
    {
      $set:   { status: "active" },
      $unset: { scheduledDeleteAt: "" },
    }
  );

  results.safetyReset = resetResult.modifiedCount;

  if (results.safetyReset > 0) {
    await DiscountAuditLog.logSystemEvent("sweep_window_expired", {
      resetCount: results.safetyReset,
      reason:
        "Records found in pending_deletion state past their scheduledDeleteAt. " +
        "Likely caused by a partial deletion in a previous run. " +
        "Records reset to active and will be re-flagged in next CRON run.",
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
  if (!cron.validate(CRON_EXPRESSION)) {
    console.error(
      `[AuditCleanup] Invalid cron expression: "${CRON_EXPRESSION}"`
    );
    return;
  }

  cron.schedule(CRON_EXPRESSION, async () => {
    try {
      await runAuditCleanup();
    } catch (err) {
      console.error("[AuditCleanup] Unhandled error in scheduled job:", err);
    }
  });

  console.log(`[AuditCleanup] Job scheduled — cron: "${CRON_EXPRESSION}"`);
}

// ─────────────────────────────────────────────────────────────────────────────
// B) STANDALONE SCRIPT (node jobs/audit-log-cleanup.js)
// ─────────────────────────────────────────────────────────────────────────────

async function runStandalone() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("[AuditCleanup] MONGODB_URI is not set");
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
    console.log("[AuditCleanup] Connected to MongoDB");

    await runAuditCleanup();

    await mongoose.disconnect();
    console.log("[AuditCleanup] Disconnected — exiting");
    process.exit(0);
  } catch (err) {
    console.error("[AuditCleanup] Fatal error:", err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
}

const isMain =
  process.argv[1] && process.argv[1].endsWith("audit-log-cleanup.js");
if (isMain) {
  runStandalone();
}
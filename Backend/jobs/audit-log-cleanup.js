/**
 * jobs/audit-log-cleanup.js
 *
 * Daily CRON job that enforces the 365 + 30 day audit log retention policy.
 *
 * Retention lifecycle (no admin input required — system is fully autonomous):
 *
 *   Day 1 – 365   Active audit records. Untouched. Admin unaware.
 *   Day 366       CRON Pass 1 flags records: status → 'pending_deletion',
 *                 scheduledDeleteAt = now + AUDIT_GRACE_DAYS. SILENT.
 *   Day 366–395   Grace period. Yearly audit / finance cycle completes.
 *                 Records accumulate silently in pending pool.
 *                 Admin sees NOTHING during this window.
 *   Day 396       CRON Pass 2 auto-deletes matured records.
 *                 AuditPurgeLog receipt written BEFORE deletion.
 *                 Admin notified AFTER the fact via receipt banner.
 *                 Admin has ZERO control over this — cannot cancel,
 *                 delay, or recover deleted records.
 *
 * Three-pass structure per daily run:
 *
 *   Pass 1 — Flag new records (silent)
 *     Finds status:'active' records older than AUDIT_RETENTION_DAYS.
 *     Sets status:'pending_deletion', scheduledDeleteAt = now + AUDIT_GRACE_DAYS.
 *     Writes sweep_run system entry. No notification.
 *
 *   Pass 2 — Auto-delete matured records
 *     Finds status:'pending_deletion' where scheduledDeleteAt <= now.
 *     Writes AuditPurgeLog receipt FIRST.
 *     Hard-deletes in batches. Writes sweep_auto_deleted system entry.
 *     This is what triggers the admin receipt banner in the UI.
 *
 *   Pass 3 — Safety-net reset (server crash / downtime recovery)
 *     Finds status:'pending_deletion' where scheduledDeleteAt < now - 1 day
 *     that somehow survived Pass 2 (partial deletion from a previous crash).
 *     Resets to status:'active'. Writes sweep_window_expired entry.
 *     These records are immediately re-flagged in Pass 1 of the next run.
 *
 * Setup:
 *   Import and call startAuditCleanupJob() in your server entry point
 *   alongside startDiscountCleanupJob():
 *
 *     import { startAuditCleanupJob } from './jobs/audit-log-cleanup.js';
 *     startAuditCleanupJob();
 *
 * Environment variables:
 *   AUDIT_CLEANUP_CRON      — cron expression, default "0 3 * * *" (3 AM daily)
 *   AUDIT_RETENTION_DAYS    — days before flagging, default 365
 *   AUDIT_GRACE_DAYS        — days between flagging and auto-delete, default 30
 *   CLEANUP_BATCH_SIZE      — delete batch size (shared with discount cleanup), default 1000
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
    flagged:       0,
    deleted:       0,
    safetyReset:   0,
    purgeReceiptId: null,
    elapsedMs:     0,
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

  // Always write a sweep_run entry — even when flaggedCount is 0.
  // This proves the job ran and found nothing, which is itself audit-worthy.
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
// PASS 2 — Auto-delete records whose grace period has elapsed
// ─────────────────────────────────────────────────────────────────────────────

async function pass2AutoDelete(results) {
  const now = new Date();

  // Find all matured records — collect metadata BEFORE deletion
  const matureCursor = await DiscountAuditLog.find(
    {
      status:           "pending_deletion",
      scheduledDeleteAt: { $lte: now },
    },
    {
      _id:          1,
      discountCode: 1,
      performedAt:  1,
    }
  ).lean();

  if (matureCursor.length === 0) {
    console.log(`[AuditCleanup] Pass 2: no matured records to delete`);
    return;
  }

  // ── Collect receipt metadata ─────────────────────────────────────────────
  const recordCount = matureCursor.length;
  const performedAts = matureCursor.map((r) => r.performedAt);
  const dateRangeFrom = new Date(Math.min(...performedAts));
  const dateRangeTo   = new Date(Math.max(...performedAts));
  const discountCodesAffected = [
    ...new Set(matureCursor.map((r) => r.discountCode)),
  ];
  const idsToDelete = matureCursor.map((r) => r._id);
  const batchReference = randomUUID();

  // ── Write AuditPurgeLog receipt FIRST ───────────────────────────────────
  // If the server crashes after this write but before deletion, the receipt
  // exists. The UI can detect a mismatch by comparing receipt.recordCount
  // against the sweep_auto_deleted meta.actualDeletedCount (which will be
  // absent or mismatched). The records will be reset in Pass 3 and
  // re-flagged next run — no silent data loss.
  const receipt = await AuditPurgeLog.createReceipt({
    batchReference,
    recordCount,
    dateRangeFrom,
    dateRangeTo,
    discountCodesAffected,
  });

  console.log(
    `[AuditCleanup] Pass 2: receipt written (batchReference: ${batchReference}). ` +
    `Deleting ${recordCount} record(s)…`
  );

  // ── Hard-delete in batches ───────────────────────────────────────────────
  let totalDeleted = 0;
  for (let i = 0; i < idsToDelete.length; i += BATCH_SIZE) {
    const batchIds = idsToDelete.slice(i, i + BATCH_SIZE);
    const { deletedCount } = await DiscountAuditLog.deleteMany({
      _id: { $in: batchIds },
    });
    totalDeleted += deletedCount;

    // Yield the event loop between batches so other queries aren't starved
    await new Promise((resolve) => setImmediate(resolve));
  }

  // ── Finalise receipt with actual deleted count ───────────────────────────
  // If totalDeleted !== recordCount a partial deletion occurred.
  // notes field will surface in the UI receipt.
  const countMismatch = totalDeleted !== recordCount;
  await AuditPurgeLog.finalise(
    batchReference,
    totalDeleted,
    countMismatch
      ? `Partial deletion detected: expected ${recordCount}, deleted ${totalDeleted}. ` +
        `Remaining records will be re-processed in next run.`
      : null
  );

  // ── Write sweep_auto_deleted system entry ────────────────────────────────
  // This is what the admin UI polls to show the receipt notification banner.
  // batchReference links back to the AuditPurgeLog receipt.
  await DiscountAuditLog.logSystemEvent("sweep_auto_deleted", {
    deletedCount:           totalDeleted,
    expectedCount:          recordCount,
    batchReference,
    purgeReceiptId:         receipt._id,
    dateRangeFrom:          dateRangeFrom.toISOString(),
    dateRangeTo:            dateRangeTo.toISOString(),
    discountCodesAffected,
    partialDeletionDetected: countMismatch,
  });

  results.deleted         = totalDeleted;
  results.purgeReceiptId  = receipt._id;

  console.log(
    `[AuditCleanup] Pass 2: deleted ${totalDeleted}/${recordCount} record(s). ` +
    (countMismatch ? "⚠ Partial deletion detected." : "Complete.")
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PASS 3 — Safety-net reset for records that survived Pass 2
// (server crash / downtime scenario)
// ─────────────────────────────────────────────────────────────────────────────

async function pass3SafetyReset(results) {
  // Records that are still pending_deletion after Pass 2 has run
  // should not exist — Pass 2 deletes everything with scheduledDeleteAt <= now.
  // If any remain it means Pass 2 was interrupted (partial deletion from
  // a previous crashed run). Reset them to active so they are cleanly
  // re-flagged and re-deleted in the next full run.
  //
  // Safety margin: only reset records whose window expired > 1 day ago.
  // Records flagged and deleted in the same run (scheduledDeleteAt <= now
  // but within the last hour) are handled by Pass 2 in the current run.
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

/**
 * Register the audit log cleanup job with node-cron.
 * Call once during app startup, after DB connection is established.
 *
 * Runs at 3 AM daily (offset from discount-cleanup.js which runs at 2 AM
 * to avoid concurrent DB pressure on the same server).
 *
 * @example
 * // In your server entry point (server.js / app.js / index.js):
 * import { startDiscountCleanupJob } from './jobs/discount-cleanup.js';
 * import { startAuditCleanupJob }    from './jobs/audit-log-cleanup.js';
 *
 * startDiscountCleanupJob();   // 2 AM daily
 * startAuditCleanupJob();      // 3 AM daily
 */
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
      // Never crash the server — log and continue.
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
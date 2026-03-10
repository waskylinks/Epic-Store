/**
 * discount-cleanup.js
 *
 * Scheduled job that:
 *   1. Bulk-marks active discounts past validUntil as "expired"
 *   2. Hard-deletes expired discounts older than HARD_DELETE_AFTER_DAYS
 *
 * Changelog:
 *   - deleteOldExpired() now delegates entirely to the Discount model
 *     static which includes the fraud protection exclusion filter:
 *     discounts where deletionEligibleAt > now are skipped regardless
 *     of their expired status, ensuring the cleanup job cannot be used
 *     as a backdoor to hard-delete a recently-used discount within its
 *     30-day post-use protection window.
 *
 * Setup (choose one):
 *
 *   A) node-cron (in-process, good for single-server deployments)
 *      ─ npm install node-cron
 *      ─ Import and call startDiscountCleanupJob() in server.js.
 *        Register BEFORE startAuditCleanupJob() so logs are ordered.
 *
 *   B) Standalone script (run via cron / Kubernetes CronJob / ECS scheduled task)
 *      ─ node discount-cleanup.js
 *      ─ Script connects, runs once, then exits cleanly.
 *
 * Environment variables:
 *   MONGODB_URI            — required for standalone mode
 *   CLEANUP_CRON           — cron expression, default "0 2 * * *" (2 AM daily)
 *   HARD_DELETE_AFTER_DAYS — days after expiry before hard-delete, default 90
 *   CLEANUP_BATCH_SIZE     — delete batch size, default 1000
 *
 * Related jobs:
 *   jobs/audit-log-cleanup.js — runs at 3 AM daily (1 hour after this job)
 *   Both are registered in server.js after connectDB().
 */

import mongoose from "mongoose";
import cron from "node-cron";
import Discount from "../models/discount-model.js";

const CRON_EXPRESSION  = process.env.CLEANUP_CRON             || "0 2 * * *";
const HARD_DELETE_DAYS = parseInt(process.env.HARD_DELETE_AFTER_DAYS) || 90;
const BATCH_SIZE       = parseInt(process.env.CLEANUP_BATCH_SIZE)     || 1000;

// ─────────────────────────────────────────────
// Core cleanup logic (used by both job modes)
// ─────────────────────────────────────────────

export async function runCleanup() {
  const start = Date.now();
  console.log(`[DiscountCleanup] Starting — ${new Date().toISOString()}`);

  try {
    // Step 1: flip active→expired for anything past validUntil.
    // bulkExpireStale uses a single updateMany against the
    // (validUntil, status) index — no fraud protection needed here
    // since expiring a discount does not delete any evidence.
    const expired = await Discount.bulkExpireStale();
    console.log(`[DiscountCleanup] Marked ${expired} discount(s) as expired`);

    // Step 2: hard-delete expired discounts older than HARD_DELETE_DAYS.
    //
    // FRAUD PROTECTION — handled inside deleteOldExpired():
    //   Discounts where deletionEligibleAt > now are automatically
    //   excluded from deletion, even if they are expired and old enough.
    //   This prevents the cleanup job from erasing evidence of a
    //   recently-used compensation code within its 30-day protection window.
    //
    // deleteOldExpired() batches deletes to avoid long write locks.
    const deleted = await Discount.deleteOldExpired(HARD_DELETE_DAYS, BATCH_SIZE);
    console.log(
      `[DiscountCleanup] Hard-deleted ${deleted} expired discount(s) ` +
      `older than ${HARD_DELETE_DAYS} days ` +
      `(discounts within fraud-protection window excluded automatically)`
    );

    const elapsed = Date.now() - start;
    console.log(
      `[DiscountCleanup] Done in ${elapsed}ms — expired: ${expired}, deleted: ${deleted}`
    );

    return { expired, deleted, elapsedMs: elapsed };
  } catch (err) {
    console.error("[DiscountCleanup] Error:", err);
    throw err;
  }
}

// ─────────────────────────────────────────────
// A) In-process cron job (node-cron)
// ─────────────────────────────────────────────

/**
 * Call once during app startup (server.js) to register the scheduled job.
 * Must be called after connectDB() — the job requires an active DB connection.
 *
 * @example
 * // server.js — step 6, after connectDB():
 * startDiscountCleanupJob();  // 2 AM daily
 * startAuditCleanupJob();     // 3 AM daily
 */
export function startDiscountCleanupJob() {
  if (!cron.validate(CRON_EXPRESSION)) {
    console.error(`[DiscountCleanup] Invalid cron expression: "${CRON_EXPRESSION}"`);
    return;
  }

  cron.schedule(CRON_EXPRESSION, async () => {
    try {
      await runCleanup();
    } catch (err) {
      // Don't crash the server — just log.
      console.error("[DiscountCleanup] Unhandled error in scheduled job:", err);
    }
  });

  console.log(`[DiscountCleanup] Job scheduled — cron: "${CRON_EXPRESSION}"`);
}

// ─────────────────────────────────────────────
// B) Standalone script entry point
// Run: node discount-cleanup.js
// ─────────────────────────────────────────────

async function runStandalone() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("[DiscountCleanup] MONGODB_URI is not set");
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
    console.log("[DiscountCleanup] Connected to MongoDB");

    await runCleanup();

    await mongoose.disconnect();
    console.log("[DiscountCleanup] Disconnected — exiting");
    process.exit(0);
  } catch (err) {
    console.error("[DiscountCleanup] Fatal error:", err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
}

// Only run standalone logic when executed directly (not imported as a module)
const isMain = process.argv[1] && process.argv[1].endsWith("discount-cleanup.js");
if (isMain) {
  runStandalone();
}
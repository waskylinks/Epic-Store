import mongoose from "mongoose";
import cron from "node-cron";
import Discount from "../models/discount-model.js";
import DiscountAnalytics from "../models/discount-analytics-model.js";

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
    const expired = await Discount.bulkExpireStale();
    console.log(`[DiscountCleanup] Marked ${expired} discount(s) as expired`);

    const { totalDeleted: deleted, deletedIds } = await Discount.deleteOldExpired(
      HARD_DELETE_DAYS,
      BATCH_SIZE
    );

    console.log(
      `[DiscountCleanup] Hard-deleted ${deleted} expired discount(s) ` +
      `older than ${HARD_DELETE_DAYS} days ` +
      `(discounts within fraud-protection window excluded automatically)`
    );

    let analyticsDeleted = 0;
    if (deletedIds.length > 0) {
      const analyticsResult = await DiscountAnalytics.deleteMany({
        discountId: { $in: deletedIds },
      });
      analyticsDeleted = analyticsResult.deletedCount;
      console.log(
        `[DiscountCleanup] Deleted ${analyticsDeleted} orphaned DiscountAnalytics document(s)`
      );
    }

    const elapsed = Date.now() - start;
    console.log(
      `[DiscountCleanup] Done in ${elapsed}ms — ` +
      `expired: ${expired}, deleted: ${deleted}, analyticsDeleted: ${analyticsDeleted}`
    );

    return { expired, deleted, analyticsDeleted, elapsedMs: elapsed };
  } catch (err) {
    console.error("[DiscountCleanup] Error:", err);
    throw err;
  }
}

// ─────────────────────────────────────────────
// A) In-process cron job (node-cron)
// ─────────────────────────────────────────────

export function startDiscountCleanupJob() {
  if (!cron.validate(CRON_EXPRESSION)) {
    console.error(`[DiscountCleanup] Invalid cron expression: "${CRON_EXPRESSION}"`);
    return;
  }

  cron.schedule(CRON_EXPRESSION, async () => {
    try {
      await runCleanup();
    } catch (err) {
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

const isMain = process.argv[1] && process.argv[1].endsWith("discount-cleanup.js");
if (isMain) {
  runStandalone();
}
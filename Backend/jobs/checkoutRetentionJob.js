/**
 * jobs/checkoutRetentionJob.js
 *
 * Three-pass data lifecycle management for the Checkout collection.
 *
 *  Pass 1 — WARM PRUNE (90–365 days)
 *    Strips expensive sub-arrays from documents that are old enough to no
 *    longer need full recovery campaign data, but not yet old enough to
 *    archive. Uses $unset in batches so the hot collection stays lean.
 *    Fields removed: abandonment.recoveryInteractions,
 *                    abandonment.recoveryCartSnapshot,
 *                    abandonment.lastRecoveryToken,
 *                    abandonment.lastRecoveryTokenId,
 *                    stepsCompleted
 *    Fields preserved: all boolean flags, pricing totals, conversion outcome,
 *                      analytics.source, createdAt, userId, email.
 *    These are the only fields read by getCheckoutAbandonmentStats() and
 *    getReAbandonmentAnalytics() so no aggregation query is broken.
 *
 *  Pass 2 — COLD ARCHIVE (365+ days)
 *    Moves qualifying checkouts from the hot collection to checkouts_archive.
 *    Always inserts into the archive BEFORE deleting from the hot collection.
 *    A partial run (server crash between insert and delete) leaves duplicates
 *    in the archive which the next run's ordered:false insertMany silently
 *    skips via the unique index. The hot collection is only deleted after the
 *    archive insert count is confirmed.
 *
 *  Pass 3 — HARD DELETE (7+ years in archive)
 *    Removes documents from checkouts_archive that exceed the compliance
 *    retention floor. Runs ONLY in production to prevent accidental data loss
 *    in development/staging.
 *
 * Security notes:
 *   - No user-supplied input of any kind enters this job.
 *   - All cutoff dates are computed server-side from env config.
 *   - deleteMany operations are scoped to age + status guards so converted
 *     (financial) checkouts require an explicit isConverted filter before
 *     they can be archived. They are never deleted from the archive during
 *     the hard-delete pass unless they exceed 7 years AND are not converted.
 *     Converted checkouts older than 7 years are logged as skipped for
 *     manual review.
 *   - Cache invalidation is called directly at the end — not via Mongoose
 *     hooks — because deleteMany does not trigger pre/post save hooks.
 *
 * Returns:
 *   {
 *     pruned:      number,   // warm-tier: docs with arrays stripped
 *     archived:    number,   // cold-tier: docs moved to archive
 *     hardDeleted: number,   // archive: docs purged after 7 years
 *     errors:      number,   // total non-fatal errors across all passes
 *     skipped:     number,   // docs skipped (converted, protected, duplicates)
 *   }
 */

import cron          from 'node-cron';
import Checkout      from '../models/checkout-model.js';
import CheckoutArchive from '../models/checkoutArchive.js';
import { deleteCachePattern } from '../utils/redis.js';
import { runCronJob }  from '../utils/runCronJob.js';
import { cronConfig }  from '../config/cronConfig.js';

let cronJob = null;

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

// Fields stripped during warm-tier pruning.
// Chosen because: (a) they are the largest sub-arrays in the document,
// (b) they are only needed during the active recovery campaign window
// (max 7 days per cronConfig), and (c) no analytics aggregation query
// reads them — all stats queries operate on top-level scalar fields.
const WARM_PRUNE_UNSET = {
  'abandonment.recoveryInteractions':    '',
  'abandonment.recoveryCartSnapshot':    '',
  'abandonment.lastRecoveryToken':       '',
  'abandonment.lastRecoveryTokenId':     '',
  stepsCompleted:                        '',
};

// Minimal projection for archive documents — only fields defined in
// CheckoutArchive schema. Any field not listed here is intentionally excluded.
const ARCHIVE_PROJECTION = {
  _id:                              1,
  user:                             1,
  email:                            1,
  status:                           1,
  'pricing.totalPrice':             1,
  'pricing.currency':               1,
  'pricing.discountCode':           1,
  'pricing.discountAmount':         1,
  'conversion.isConverted':         1,
  'conversion.convertedAt':         1,
  'conversion.orderId':             1,
  'conversion.paymentReference':    1,
  'abandonment.isAbandoned':        1,
  'abandonment.recovered':          1,
  'abandonment.reAbandoned':        1,
  'abandonment.organicRecovery':    1,
  'analytics.source':               1,
  createdAt:                        1,
  updatedAt:                        1,
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * mapToArchive
 * Projects a lean checkout document into the CheckoutArchive schema shape.
 * This is the ONLY function that writes to CheckoutArchive — enforcing the
 * minimal-footprint invariant at a single point.
 *
 * @param {Object} doc     — lean checkout document
 * @param {string} runId   — current job run ID for traceability
 * @returns {Object}       — CheckoutArchive-compatible document
 */
function mapToArchive(doc, runId) {
  return {
    _id:               doc._id,
    userId:            doc.user,
    email:             (doc.email ?? '').toLowerCase().trim(),
    status:            doc.status,
    totalPrice:        doc.pricing?.totalPrice        ?? 0,
    currency:          doc.pricing?.currency          ?? 'USD',
    discountCode:      doc.pricing?.discountCode      ?? null,
    discountAmount:    doc.pricing?.discountAmount     ?? 0,
    isConverted:       doc.conversion?.isConverted    ?? false,
    convertedAt:       doc.conversion?.convertedAt    ?? null,
    orderId:           doc.conversion?.orderId        ?? null,
    paymentReference:  doc.conversion?.paymentReference ?? null,
    wasAbandoned:      doc.abandonment?.isAbandoned   ?? false,
    wasRecovered:      doc.abandonment?.recovered     ?? false,
    reAbandoned:       doc.abandonment?.reAbandoned   ?? false,
    organicRecovery:   doc.abandonment?.organicRecovery ?? false,
    analyticsSource:   doc.analytics?.source          ?? null,
    checkoutCreatedAt: doc.createdAt,
    checkoutUpdatedAt: doc.updatedAt ?? null,
    archivedAt:        new Date(),
    archiveRunId:      runId,
  };
}

/**
 * invalidateCaches
 * Fired once at the end of a run that modified data.
 * Does not throw — cache invalidation failure must never fail the job.
 */
async function invalidateCaches() {
  try {
    await Promise.all([
      deleteCachePattern('checkout_abandonment_*'),
      deleteCachePattern('checkout_recovery_*'),
      deleteCachePattern('abandoned_list:*'),
      deleteCachePattern('admin_stats*'),
      deleteCachePattern('analytics_*'),
      deleteCachePattern('cron_banner'),
    ]);
  } catch (err) {
    console.error('[CheckoutRetention] Cache invalidation failed:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PASS 1 — WARM PRUNE
// ─────────────────────────────────────────────────────────────────────────────

async function runWarmPrune(results, { warmTierDays, coldTierDays, batchSize }) {
  const warmCutoff = new Date(Date.now() - warmTierDays * 24 * 60 * 60 * 1000);
  const coldCutoff = new Date(Date.now() - coldTierDays * 24 * 60 * 60 * 1000);

  console.log(
    `[CheckoutRetention] Pass 1 (warm prune): targeting ${warmTierDays}–${coldTierDays} day docs` +
    ` | window: ${coldCutoff.toISOString()} → ${warmCutoff.toISOString()}`
  );

  // Guard: only prune docs that still have at least one of the target arrays.
  // This makes the operation idempotent — re-running after a partial failure
  // won't touch already-pruned documents.
  const filter = {
    createdAt: { $gte: coldCutoff, $lt: warmCutoff },
    $or: [
      { 'abandonment.recoveryInteractions': { $exists: true } },
      { 'abandonment.recoveryCartSnapshot': { $exists: true } },
      { 'abandonment.lastRecoveryToken':    { $exists: true } },
      { stepsCompleted:                     { $exists: true } },
    ],
  };

  let lastId  = null;
  let hasMore = true;
  let batches = 0;

  while (hasMore) {
    batches++;

    const batchFilter = { ...filter };
    if (lastId) batchFilter._id = { $gt: lastId };

    // Fetch only _id fields — the $unset doesn't need document bodies
    const batch = await Checkout.find(batchFilter, { _id: 1 })
      .sort({ _id: 1 })
      .limit(batchSize)
      .lean();

    if (batch.length === 0) { hasMore = false; break; }

    lastId = batch[batch.length - 1]._id;
    const ids = batch.map((d) => d._id);

    try {
      const { modifiedCount } = await Checkout.updateMany(
        { _id: { $in: ids } },
        { $unset: WARM_PRUNE_UNSET }
      );
      results.pruned += modifiedCount;
    } catch (err) {
      results.errors++;
      console.error(`[CheckoutRetention] Warm prune batch ${batches} error:`, err.message);
    }

    if (batch.length < batchSize) hasMore = false;

    // Yield between batches to avoid starving the event loop
    await new Promise((resolve) => setImmediate(resolve));
  }

  console.log(
    `[CheckoutRetention] Pass 1 complete: pruned=${results.pruned} | batches=${batches} | errors=${results.errors}`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PASS 2 — COLD ARCHIVE
// ─────────────────────────────────────────────────────────────────────────────

async function runColdArchive(results, { coldTierDays, archiveBatchSize, runId }) {
  const coldCutoff = new Date(Date.now() - coldTierDays * 24 * 60 * 60 * 1000);

  console.log(
    `[CheckoutRetention] Pass 2 (cold archive): targeting docs older than ${coldTierDays} days` +
    ` | cutoff: ${coldCutoff.toISOString()}`
  );

  const filter = {
    createdAt: { $lt: coldCutoff },
    // Exclude converted checkouts from bulk archive — they need an explicit
    // converted guard to prevent financial record loss. They are handled in
    // a separate guarded pass below.
    'conversion.isConverted': false,
  };

  let lastId  = null;
  let hasMore = true;
  let batches = 0;

  while (hasMore) {
    batches++;

    const batchFilter = { ...filter };
    if (lastId) batchFilter._id = { $gt: lastId };

    const docs = await Checkout.find(batchFilter, ARCHIVE_PROJECTION)
      .sort({ _id: 1 })
      .limit(archiveBatchSize)
      .lean();

    if (docs.length === 0) { hasMore = false; break; }

    lastId = docs[docs.length - 1]._id;

    const archiveDocs = docs.map((d) => mapToArchive(d, runId));
    const ids         = docs.map((d) => d._id);

    // ── INSERT BEFORE DELETE — the core safety invariant ──────────────────
    let insertResult;
    try {
      insertResult = await CheckoutArchive.archiveCheckouts(archiveDocs);
    } catch (err) {
      // If insert throws (not a duplicate-key partial error), skip delete
      // for this batch entirely. Documents remain in the hot collection
      // and will be retried on the next run.
      results.errors++;
      console.error(
        `[CheckoutRetention] Archive insert failed for batch ${batches}:`,
        err.message
      );
      if (docs.length < archiveBatchSize) hasMore = false;
      await new Promise((resolve) => setImmediate(resolve));
      continue;
    }

    results.skipped += insertResult.duplicates ?? 0;

    // Only delete documents that were confirmed inserted (or already archived)
    if (insertResult.inserted > 0 || (insertResult.duplicates ?? 0) > 0) {
      try {
        const { deletedCount } = await Checkout.deleteMany({ _id: { $in: ids } });
        results.archived += deletedCount;
      } catch (err) {
        results.errors++;
        console.error(
          `[CheckoutRetention] Hot-collection delete failed for batch ${batches}:`,
          err.message
        );
        // Documents remain in hot collection — safe, will retry next run
      }
    }

    if (docs.length < archiveBatchSize) hasMore = false;
    await new Promise((resolve) => setImmediate(resolve));
  }

  // ── Converted checkout archive (guarded) ──────────────────────────────────
  // Converted checkouts are archived separately with an explicit isConverted
  // filter as an additional safety guard. They are never deleted from the hot
  // collection without this explicit check.
  const convertedFilter = {
    createdAt:               { $lt: coldCutoff },
    'conversion.isConverted': true,
    'conversion.orderId':     { $exists: true, $ne: null },
  };

  let convertedLastId  = null;
  let convertedHasMore = true;
  let convertedBatches = 0;

  while (convertedHasMore) {
    convertedBatches++;

    const batchFilter = { ...convertedFilter };
    if (convertedLastId) batchFilter._id = { $gt: convertedLastId };

    const docs = await Checkout.find(batchFilter, ARCHIVE_PROJECTION)
      .sort({ _id: 1 })
      .limit(archiveBatchSize)
      .lean();

    if (docs.length === 0) { convertedHasMore = false; break; }

    convertedLastId = docs[docs.length - 1]._id;

    const archiveDocs = docs.map((d) => mapToArchive(d, runId));
    const ids         = docs.map((d) => d._id);

    let insertResult;
    try {
      insertResult = await CheckoutArchive.archiveCheckouts(archiveDocs);
    } catch (err) {
      results.errors++;
      console.error(
        `[CheckoutRetention] Converted archive insert failed batch ${convertedBatches}:`,
        err.message
      );
      if (docs.length < archiveBatchSize) convertedHasMore = false;
      await new Promise((resolve) => setImmediate(resolve));
      continue;
    }

    results.skipped += insertResult.duplicates ?? 0;

    if (insertResult.inserted > 0 || (insertResult.duplicates ?? 0) > 0) {
      try {
        // Extra guard: re-verify isConverted on each ID before deleting
        const { deletedCount } = await Checkout.deleteMany({
          _id:                     { $in: ids },
          'conversion.isConverted': true,
        });
        results.archived += deletedCount;
      } catch (err) {
        results.errors++;
        console.error(
          `[CheckoutRetention] Converted delete failed batch ${convertedBatches}:`,
          err.message
        );
      }
    }

    if (docs.length < archiveBatchSize) convertedHasMore = false;
    await new Promise((resolve) => setImmediate(resolve));
  }

  console.log(
    `[CheckoutRetention] Pass 2 complete:` +
    ` archived=${results.archived}` +
    ` | skipped(dups)=${results.skipped}` +
    ` | batches=${batches + convertedBatches}` +
    ` | errors=${results.errors}`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PASS 3 — HARD DELETE (archive collection, 7+ years)
// ─────────────────────────────────────────────────────────────────────────────

async function runHardDelete(results, { hardDeleteYears, archiveBatchSize }) {
  // Hard delete only runs in production — never in dev or staging
  if (process.env.NODE_ENV !== 'production') {
    console.log('[CheckoutRetention] Pass 3 skipped — hard delete only runs in production');
    return;
  }

  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - hardDeleteYears);

  const eligible = await CheckoutArchive.countEligibleForHardDelete(cutoff);

  if (eligible === 0) {
    console.log(`[CheckoutRetention] Pass 3: no archive docs older than ${hardDeleteYears} years`);
    return;
  }

  console.log(
    `[CheckoutRetention] Pass 3 (hard delete): ${eligible} archive docs older than` +
    ` ${hardDeleteYears} years | cutoff: ${cutoff.toISOString()}`
  );

  // Hard delete only non-converted records by default.
  // Converted checkouts older than 7 years are logged for manual review —
  // financial records may have external dependencies (tax filings, order history).
  const convertedCount = await CheckoutArchive.countDocuments({
    archivedAt:  { $lt: cutoff },
    isConverted: true,
  });

  if (convertedCount > 0) {
    console.warn(
      `[CheckoutRetention] Pass 3: ${convertedCount} CONVERTED archive doc(s) exceed` +
      ` ${hardDeleteYears} years. These require manual review and are NOT auto-deleted.`
    );
    results.skipped += convertedCount;
  }

  // Batch delete non-converted records only
  let lastId  = null;
  let hasMore = true;
  let batches = 0;

  while (hasMore) {
    batches++;

    const filter = {
      archivedAt:  { $lt: cutoff },
      isConverted: false,
      ...(lastId && { _id: { $gt: lastId } }),
    };

    const batch = await CheckoutArchive.find(filter, { _id: 1 })
      .sort({ _id: 1 })
      .limit(archiveBatchSize)
      .lean();

    if (batch.length === 0) { hasMore = false; break; }

    lastId = batch[batch.length - 1]._id;
    const ids = batch.map((d) => d._id);

    try {
      const { deletedCount } = await CheckoutArchive.deleteMany({
        _id:         { $in: ids },
        isConverted: false, // re-assert guard at delete time
      });
      results.hardDeleted += deletedCount;
    } catch (err) {
      results.errors++;
      console.error(`[CheckoutRetention] Hard delete batch ${batches} error:`, err.message);
    }

    if (batch.length < archiveBatchSize) hasMore = false;
    await new Promise((resolve) => setImmediate(resolve));
  }

  console.log(
    `[CheckoutRetention] Pass 3 complete:` +
    ` hardDeleted=${results.hardDeleted}` +
    ` | batches=${batches}` +
    ` | errors=${results.errors}`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE JOB FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

export async function runCheckoutRetention() {
  const {
    warmTierDays,
    coldTierDays,
    hardDeleteYears,
    batchSize,
    archiveBatchSize,
  } = cronConfig.checkoutRetention;

  const start = Date.now();
  console.log(`[CheckoutRetention] Starting — ${new Date().toISOString()}`);

  const results = {
    pruned:      0,
    archived:    0,
    hardDeleted: 0,
    errors:      0,
    skipped:     0,
  };

  // runId is generated here so it can be stamped onto archive documents
  // for traceability. It mirrors the format used by runCronJob.js.
  const runId = `checkout_retention_${Date.now()}`;

  try {
    await runWarmPrune(results, { warmTierDays, coldTierDays, batchSize });
  } catch (err) {
    results.errors++;
    console.error('[CheckoutRetention] Pass 1 threw unexpectedly:', err.message);
  }

  try {
    await runColdArchive(results, { coldTierDays, archiveBatchSize, runId });
  } catch (err) {
    results.errors++;
    console.error('[CheckoutRetention] Pass 2 threw unexpectedly:', err.message);
  }

  try {
    await runHardDelete(results, { hardDeleteYears, archiveBatchSize });
  } catch (err) {
    results.errors++;
    console.error('[CheckoutRetention] Pass 3 threw unexpectedly:', err.message);
  }

  const anyDataChanged = results.pruned > 0 || results.archived > 0 || results.hardDeleted > 0;
  if (anyDataChanged) {
    await invalidateCaches();
  }

  const elapsedMs = Date.now() - start;
  console.log(
    `[CheckoutRetention] Done in ${elapsedMs}ms —` +
    ` pruned=${results.pruned}` +
    ` | archived=${results.archived}` +
    ` | hardDeleted=${results.hardDeleted}` +
    ` | skipped=${results.skipped}` +
    ` | errors=${results.errors}`
  );

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// START / STOP
// ─────────────────────────────────────────────────────────────────────────────

export function startCheckoutRetentionJob() {
  const { cronExpression } = cronConfig.checkoutRetention;

  if (!cron.validate(cronExpression)) {
    console.error(
      `[CheckoutRetention] Invalid cron expression: "${cronExpression}" — job not started`
    );
    return;
  }

  const wrappedFn = runCronJob({
    jobName:     'CheckoutRetention',
    jobFn:       runCheckoutRetention,
    alertOnFail: true,
  });

  cronJob = cron.schedule(cronExpression, wrappedFn, {
    scheduled: true,
    timezone:  cronConfig.global.timezone,
  });

  console.log(
    `[CheckoutRetention] Started | schedule="${cronExpression}"` +
    ` | warmTierDays=${cronConfig.checkoutRetention.warmTierDays}` +
    ` | coldTierDays=${cronConfig.checkoutRetention.coldTierDays}` +
    ` | hardDeleteYears=${cronConfig.checkoutRetention.hardDeleteYears}`
  );
}

export function stopCheckoutRetentionJob() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log('[CheckoutRetention] Stopped');
  }
}

export default startCheckoutRetentionJob;
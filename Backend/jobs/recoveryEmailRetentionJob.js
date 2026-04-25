/**
 * jobs/recoveryEmailRetentionJob.js
 *
 * Two-pass data lifecycle management for the RecoveryEmail collection.
 *
 *  Pass 1 — Orphan Resolution & Snapshot Prune
 *    Sub-pass A — Orphan resolution:
 *      Finds RecoveryEmail documents whose linked checkout no longer exists
 *      in either the hot `checkouts` collection or `checkouts_archive`.
 *      Transitions any non-terminal outcome (pending, sent, clicked, exhausted)
 *      directly to 'expired' via a targeted $set that respects the same
 *      priority ladder as _resolveOutcome — converted and organic records are
 *      never touched because they are explicitly excluded from the query filter.
 *
 *      Also catches a gap in markExpiredRecords(): RecoveryEmail records still
 *      in an active outcome (pending, sent, clicked) whose checkout still exists
 *      but where createdAt has exceeded maxAgeDays from cronConfig.recoveryEmail.
 *      markExpiredRecords() only promotes exhausted → expired; this sub-pass
 *      covers the path where the cron never sent enough emails to exhaust the
 *      record but the cart is now too old to ever send to.
 *
 *    Sub-pass B — Snapshot prune:
 *      Nulls out cartSnapshot on RecoveryEmail records that are already in a
 *      terminal outcome AND whose resolvedAt is older than cartSnapshotPruneDays.
 *      cartSnapshot contains the customer's name, email-adjacent item details,
 *      and pricing — stripping it after the campaign window closes reduces PII
 *      surface area while keeping the outcome and attempt metadata intact for
 *      analytics. Uses a single $unset updateMany — no document loading required.
 *      Idempotent: records without a cartSnapshot are skipped by the $exists guard.
 *
 *  Pass 2 — Hard Delete (production only)
 *    Deletes RecoveryEmail documents where resolvedAt is older than
 *    hardDeleteYears AND outcome is a non-financial terminal (expired,
 *    re_abandoned, failed). Converted and organic records are explicitly
 *    excluded and their count is logged as skipped for manual review —
 *    these have financial audit value and follow the same manual-review
 *    path as converted checkouts in checkoutRetentionJob. The isConverted
 *    guard is re-asserted inside the deleteMany filter (not just at query
 *    time) to prevent races.
 *
 * Coordination with checkoutRetentionJob:
 *   checkoutRetentionJob.js now calls resolveLinkedRecoveryEmails() inline
 *   after each cold-archive batch delete, so by the time this job's orphan
 *   pass runs the majority of stale active records are already resolved.
 *   This job's orphan pass is a safety net — it catches any that slipped
 *   through (e.g. partial runs, races, records created after a checkout was
 *   archived outside the retention job).
 *
 * Returns:
 *   {
 *     orphansResolved:   number,  // non-terminal outcomes transitioned to expired
 *     staleResolved:     number,  // active-but-too-old records transitioned to expired
 *     snapshotsPruned:   number,  // cartSnapshot fields nulled out
 *     hardDeleted:       number,  // documents purged after hardDeleteYears
 *     errors:            number,  // total non-fatal errors across all passes
 *     skipped:           number,  // converted/organic records skipped in hard delete
 *   }
 *
 * Security notes:
 *   - No user-supplied input enters this job.
 *   - All cutoff dates are computed server-side from env config.
 *   - Hard delete is scoped to non-financial terminal outcomes only.
 *   - Converted and organic records require manual review before deletion.
 *   - Cache invalidation is called directly — not via Mongoose hooks —
 *     because updateMany/deleteMany do not trigger pre/post save hooks.
 */

import cron          from 'node-cron';
import mongoose      from 'mongoose';
import RecoveryEmail from '../models/recovery-email-model.js';
import { deleteCachePattern } from '../utils/redis.js';
import { runCronJob }  from '../utils/runCronJob.js';
import { cronConfig }  from '../config/cronConfig.js';

let cronJob = null;

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

// Outcomes that can be safely transitioned to 'expired' during orphan resolution.
// Mirrors the ACTIVE_OUTCOMES set from recovery-email-model.js canSend() plus
// 'exhausted' (send-side terminal that is still resolvable).
// 'converted' and 'organic' are intentionally excluded — absolute terminals.
// 're_abandoned' and 'failed' are already terminal — no transition needed.
// 'expired' is already the target state — no transition needed.
const RESOLVABLE_OUTCOMES = ['pending', 'sent', 'clicked', 'exhausted'];

// Outcomes where hard delete is permitted.
// converted and organic are excluded — financial audit records.
const HARD_DELETE_OUTCOMES = ['expired', 're_abandoned', 'failed'];

// Fields to strip during snapshot prune.
const SNAPSHOT_UNSET = { cartSnapshot: '' };

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * invalidateCaches
 * Fired once at the end of a run that modified data.
 * Mirrors invalidateRecoveryCaches() from recoveryEmailService but is
 * defined here to avoid importing the service and creating circular deps.
 * Does not throw — cache invalidation failure must never fail the job.
 */
async function invalidateCaches() {
  try {
    await Promise.all([
      deleteCachePattern('recovery_analytics_*'),
      deleteCachePattern('recovery_send_list_*'),
      deleteCachePattern('abandoned_list:*'),
      deleteCachePattern('checkout_abandonment_*'),
      deleteCachePattern('admin_stats*'),
      deleteCachePattern('cron_banner'),
    ]);
  } catch (err) {
    console.error('[RecoveryEmailRetention] Cache invalidation failed:', err.message);
  }
}

/**
 * getCheckoutArchiveCollection
 * Returns the raw MongoDB collection for checkouts_archive without requiring
 * the CheckoutArchive Mongoose model to be imported (avoids coupling).
 * Falls back gracefully if the collection does not exist yet.
 */
function getCheckoutArchiveCollection() {
  try {
    return mongoose.connection.collection('checkouts_archive');
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PASS 1A — ORPHAN RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * runOrphanResolution
 *
 * Finds RecoveryEmail records in a resolvable outcome whose linked checkout
 * does not exist in either the hot collection or the archive, then transitions
 * them to 'expired'.
 *
 * Also resolves active-but-stale records: RecoveryEmail records still in a
 * resolvable outcome whose checkout DOES exist but whose createdAt has exceeded
 * maxAgeDays. These are carts that were never fully worked through the send
 * sequence before they aged out.
 *
 * Batching strategy: loads RecoveryEmail IDs in pages, then checks existence
 * in checkouts and checkouts_archive. The existence check uses countDocuments
 * on scoped ID sets rather than a $lookup to keep the query planner simple.
 */
async function runOrphanResolution(results, {
  batchSize,
  orphanResolutionDays,
  maxAgeDays,
}) {
  const orphanCutoff = new Date(Date.now() - orphanResolutionDays * 24 * 60 * 60 * 1000);
  const maxAgeCutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);
  const archiveCollection = getCheckoutArchiveCollection();

  console.log(
    `[RecoveryEmailRetention] Pass 1A (orphan resolution):` +
    ` orphanCutoff=${orphanCutoff.toISOString()}` +
    ` | maxAgeCutoff=${maxAgeCutoff.toISOString()}`
  );

  // ── Sub-pass: true orphans (checkout gone from both collections) ──────────

  let lastId  = null;
  let hasMore = true;
  let batches = 0;
  let orphansResolved = 0;

  while (hasMore) {
    batches++;

    const filter = {
      outcome:   { $in: RESOLVABLE_OUTCOMES },
      createdAt: { $lt: orphanCutoff },
      ...(lastId && { _id: { $gt: lastId } }),
    };

    // Fetch only the checkout reference — we just need to check existence
    const batch = await RecoveryEmail.find(filter, { _id: 1, checkout: 1 })
      .sort({ _id: 1 })
      .limit(batchSize)
      .lean();

    if (batch.length === 0) { hasMore = false; break; }

    lastId = batch[batch.length - 1]._id;

    const checkoutIds     = batch.map(r => r.checkout);
    const recoveryEmailIds = batch.map(r => r._id);

    // Check which checkout IDs still exist in the hot collection
    const { default: Checkout } = await import('../models/checkout-model.js');
    const existingHotIds = await Checkout.distinct('_id', {
      _id: { $in: checkoutIds },
    });
    const existingHotSet = new Set(existingHotIds.map(id => id.toString()));

    // Check which checkout IDs still exist in the archive
    let existingArchiveSet = new Set();
    if (archiveCollection) {
      const archiveDocs = await archiveCollection.find(
        { _id: { $in: checkoutIds } },
        { projection: { _id: 1 } }
      ).toArray();
      existingArchiveSet = new Set(archiveDocs.map(d => d._id.toString()));
    }

    // Identify RecoveryEmail records whose checkout exists in neither collection
    const orphanedRecoveryEmailIds = batch
      .filter(r => {
        const cid = r.checkout.toString();
        return !existingHotSet.has(cid) && !existingArchiveSet.has(cid);
      })
      .map(r => r._id);

    if (orphanedRecoveryEmailIds.length > 0) {
      try {
        const { modifiedCount } = await RecoveryEmail.updateMany(
          {
            _id:     { $in: orphanedRecoveryEmailIds },
            // Re-assert resolvable guard at write time — prevents race with
            // a concurrent conversion completing between query and update
            outcome: { $in: RESOLVABLE_OUTCOMES },
          },
          {
            $set: {
              outcome:    'expired',
              resolvedAt: new Date(),
            },
          }
        );
        orphansResolved += modifiedCount;
        results.orphansResolved += modifiedCount;

        console.log(
          `[RecoveryEmailRetention] Pass 1A batch ${batches}:` +
          ` ${modifiedCount} orphan(s) resolved to expired`
        );
      } catch (err) {
        results.errors++;
        console.error(
          `[RecoveryEmailRetention] Pass 1A batch ${batches} orphan update failed:`,
          err.message
        );
      }
    }

    if (batch.length < batchSize) hasMore = false;
    await new Promise(resolve => setImmediate(resolve));
  }

  // ── Sub-pass: active-but-stale records (checkout exists, campaign too old) ─

  // These are records where the checkout is still present but so much time
  // has passed that the recovery window is definitively closed. markExpiredRecords()
  // in recoveryEmailService only catches 'exhausted' → 'expired'. This catches
  // pending/sent/clicked records that aged past maxAgeDays without ever exhausting.
  try {
    const { modifiedCount } = await RecoveryEmail.updateMany(
      {
        outcome:   { $in: RESOLVABLE_OUTCOMES },
        createdAt: { $lt: maxAgeCutoff },
      },
      {
        $set: {
          outcome:    'expired',
          resolvedAt: new Date(),
        },
      }
    );

    results.staleResolved += modifiedCount;

    if (modifiedCount > 0) {
      console.log(
        `[RecoveryEmailRetention] Pass 1A stale sub-pass:` +
        ` ${modifiedCount} stale active record(s) resolved to expired`
      );
    }
  } catch (err) {
    results.errors++;
    console.error(
      '[RecoveryEmailRetention] Pass 1A stale sub-pass failed:',
      err.message
    );
  }

  console.log(
    `[RecoveryEmailRetention] Pass 1A complete:` +
    ` orphansResolved=${results.orphansResolved}` +
    ` | staleResolved=${results.staleResolved}` +
    ` | batches=${batches}` +
    ` | errors=${results.errors}`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PASS 1B — SNAPSHOT PRUNE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * runSnapshotPrune
 *
 * Nulls out the cartSnapshot field on RecoveryEmail records that are in a
 * terminal outcome and whose resolvedAt is older than cartSnapshotPruneDays.
 *
 * cartSnapshot contains customer name, item details, and pricing — stripping
 * it after the campaign is definitively over reduces PII surface area while
 * keeping the outcome, attempt counts, and click metadata intact for analytics.
 *
 * Uses a single updateMany with $unset — does not load documents into memory.
 * Idempotent: the $exists guard ensures already-pruned records are never counted
 * in modifiedCount and are skipped entirely by the query planner.
 *
 * All terminal outcomes are eligible — including converted and organic —
 * because retaining the cart snapshot after conversion serves no purpose
 * (the order document holds the canonical record of what was purchased).
 */
async function runSnapshotPrune(results, { cartSnapshotPruneDays }) {
  const pruneCutoff = new Date(
    Date.now() - cartSnapshotPruneDays * 24 * 60 * 60 * 1000
  );

  const TERMINAL_OUTCOMES = [
    'converted', 'organic', 're_abandoned',
    'exhausted', 'expired', 'failed',
  ];

  console.log(
    `[RecoveryEmailRetention] Pass 1B (snapshot prune):` +
    ` pruneCutoff=${pruneCutoff.toISOString()}`
  );

  try {
    const { modifiedCount } = await RecoveryEmail.updateMany(
      {
        outcome:              { $in: TERMINAL_OUTCOMES },
        resolvedAt:           { $lt: pruneCutoff },
        'cartSnapshot.snapshotAt': { $exists: true }, // skip already-pruned
      },
      { $unset: SNAPSHOT_UNSET }
    );

    results.snapshotsPruned += modifiedCount;

    console.log(
      `[RecoveryEmailRetention] Pass 1B complete: snapshotsPruned=${modifiedCount}`
    );
  } catch (err) {
    results.errors++;
    console.error('[RecoveryEmailRetention] Pass 1B failed:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PASS 2 — HARD DELETE (production only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * runHardDelete
 *
 * Permanently removes RecoveryEmail documents where:
 *   - resolvedAt is older than hardDeleteYears
 *   - outcome is a non-financial terminal (expired, re_abandoned, failed)
 *
 * Converted and organic records are counted as skipped and logged for
 * manual review. These records have financial audit relevance (they document
 * which cart was recovered and when) and must not be auto-deleted.
 *
 * The non-financial terminal filter is re-asserted inside deleteMany
 * (not just at query time) to prevent a race condition where a record is
 * converted between the find query and the delete.
 *
 * Production-only guard matches checkoutRetentionJob — prevents accidental
 * data loss in development or staging environments.
 */
async function runHardDelete(results, { hardDeleteYears, batchSize }) {
  if (process.env.NODE_ENV !== 'production') {
    console.log(
      '[RecoveryEmailRetention] Pass 2 skipped — hard delete only runs in production'
    );
    return;
  }

  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - hardDeleteYears);

  console.log(
    `[RecoveryEmailRetention] Pass 2 (hard delete):` +
    ` cutoff=${cutoff.toISOString()}` +
    ` | eligible outcomes=${HARD_DELETE_OUTCOMES.join(', ')}`
  );

  // Count and log converted/organic records that are being skipped
  const financialSkipCount = await RecoveryEmail.countDocuments({
    resolvedAt: { $lt: cutoff },
    outcome:    { $in: ['converted', 'organic'] },
  });

  if (financialSkipCount > 0) {
    console.warn(
      `[RecoveryEmailRetention] Pass 2: ${financialSkipCount} converted/organic` +
      ` record(s) exceed ${hardDeleteYears} years. These require manual review` +
      ` and are NOT auto-deleted.`
    );
    results.skipped += financialSkipCount;
  }

  // Count total eligible before batching so we can log a meaningful preview
  const eligible = await RecoveryEmail.countDocuments({
    resolvedAt: { $lt: cutoff },
    outcome:    { $in: HARD_DELETE_OUTCOMES },
  });

  if (eligible === 0) {
    console.log(
      `[RecoveryEmailRetention] Pass 2: no records older than ${hardDeleteYears} years`
    );
    return;
  }

  console.log(
    `[RecoveryEmailRetention] Pass 2: ${eligible} record(s) eligible for hard delete`
  );

  let lastId  = null;
  let hasMore = true;
  let batches = 0;

  while (hasMore) {
    batches++;

    const filter = {
      resolvedAt: { $lt: cutoff },
      outcome:    { $in: HARD_DELETE_OUTCOMES },
      ...(lastId && { _id: { $gt: lastId } }),
    };

    // Fetch IDs only — we re-apply the full filter in deleteMany
    const batch = await RecoveryEmail.find(filter, { _id: 1 })
      .sort({ _id: 1 })
      .limit(batchSize)
      .lean();

    if (batch.length === 0) { hasMore = false; break; }

    lastId = batch[batch.length - 1]._id;
    const ids = batch.map(d => d._id);

    try {
      const { deletedCount } = await RecoveryEmail.deleteMany({
        _id:       { $in: ids },
        // Re-assert outcome guard at delete time — prevents financial record deletion
        // if a record was converted between the find and the delete
        outcome:   { $in: HARD_DELETE_OUTCOMES },
        resolvedAt: { $lt: cutoff },
      });
      results.hardDeleted += deletedCount;
    } catch (err) {
      results.errors++;
      console.error(
        `[RecoveryEmailRetention] Pass 2 batch ${batches} error:`,
        err.message
      );
    }

    if (batch.length < batchSize) hasMore = false;
    await new Promise(resolve => setImmediate(resolve));
  }

  console.log(
    `[RecoveryEmailRetention] Pass 2 complete:` +
    ` hardDeleted=${results.hardDeleted}` +
    ` | batches=${batches}` +
    ` | errors=${results.errors}`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE JOB FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

export async function runRecoveryEmailRetention() {
  const {
    cartSnapshotPruneDays,
    orphanResolutionDays,
    hardDeleteYears,
    batchSize,
  } = cronConfig.recoveryEmailRetention;

  // maxAgeDays comes from the recoveryEmail config block — this is the same
  // value the cron uses to decide a cart is too old to contact. Records older
  // than this that are still in an active outcome are definitively stale.
  const maxAgeDays = cronConfig.recoveryEmail.maxAgeDays;

  const start = Date.now();
  console.log(`[RecoveryEmailRetention] Starting — ${new Date().toISOString()}`);

  const results = {
    orphansResolved: 0,
    staleResolved:   0,
    snapshotsPruned: 0,
    hardDeleted:     0,
    errors:          0,
    skipped:         0,
  };

  // Pass 1A — Orphan resolution & stale active resolution
  try {
    await runOrphanResolution(results, {
      batchSize,
      orphanResolutionDays,
      maxAgeDays,
    });
  } catch (err) {
    results.errors++;
    console.error(
      '[RecoveryEmailRetention] Pass 1A threw unexpectedly:',
      err.message
    );
  }

  // Pass 1B — Snapshot prune
  try {
    await runSnapshotPrune(results, { cartSnapshotPruneDays });
  } catch (err) {
    results.errors++;
    console.error(
      '[RecoveryEmailRetention] Pass 1B threw unexpectedly:',
      err.message
    );
  }

  // Pass 2 — Hard delete (production only)
  try {
    await runHardDelete(results, { hardDeleteYears, batchSize });
  } catch (err) {
    results.errors++;
    console.error(
      '[RecoveryEmailRetention] Pass 2 threw unexpectedly:',
      err.message
    );
  }

  const anyDataChanged = (
    results.orphansResolved > 0 ||
    results.staleResolved   > 0 ||
    results.snapshotsPruned > 0 ||
    results.hardDeleted     > 0
  );

  if (anyDataChanged) {
    await invalidateCaches();
  }

  const elapsedMs = Date.now() - start;

  console.log(
    `[RecoveryEmailRetention] Done in ${elapsedMs}ms —` +
    ` orphansResolved=${results.orphansResolved}` +
    ` | staleResolved=${results.staleResolved}` +
    ` | snapshotsPruned=${results.snapshotsPruned}` +
    ` | hardDeleted=${results.hardDeleted}` +
    ` | skipped=${results.skipped}` +
    ` | errors=${results.errors}`
  );

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// START / STOP
// ─────────────────────────────────────────────────────────────────────────────

export function startRecoveryEmailRetentionJob() {
  const { cronExpression } = cronConfig.recoveryEmailRetention;

  if (!cron.validate(cronExpression)) {
    console.error(
      `[RecoveryEmailRetention] Invalid cron expression: "${cronExpression}" — job not started`
    );
    return;
  }

  const wrappedFn = runCronJob({
    jobName:     'RecoveryEmailRetention',
    jobFn:       runRecoveryEmailRetention,
    alertOnFail: true,
  });

  cronJob = cron.schedule(cronExpression, wrappedFn, {
    scheduled: true,
    timezone:  cronConfig.global.timezone,
  });

  console.log(
    `[RecoveryEmailRetention] Started | schedule="${cronExpression}"` +
    ` | cartSnapshotPruneDays=${cronConfig.recoveryEmailRetention.cartSnapshotPruneDays}` +
    ` | orphanResolutionDays=${cronConfig.recoveryEmailRetention.orphanResolutionDays}` +
    ` | hardDeleteYears=${cronConfig.recoveryEmailRetention.hardDeleteYears}`
  );
}

export function stopRecoveryEmailRetentionJob() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log('[RecoveryEmailRetention] Stopped');
  }
}

export default startRecoveryEmailRetentionJob;
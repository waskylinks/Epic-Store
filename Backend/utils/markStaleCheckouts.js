import Checkout from '../models/checkout-model.js';
import { deleteCachePattern } from '../utils/redis.js';

/**
 * markStaleCheckouts
 *
 * Sweeps the database for pending checkouts that have been inactive beyond
 * the abandonment threshold and marks them as abandoned.
 *
 * Designed to be called:
 *   1. By the abandonmentSweep cron job (every 30 min in production)
 *   2. Inline at the top of getCheckoutAbandonmentStats and
 *      getAbandonedCheckoutsList before any aggregation runs — this
 *      ensures analytics always reflect the latest state regardless of
 *      when the cron last fired.
 *
 * @returns {Promise<{ marked: number, errors: number, batches: number }>}
 */
export const markStaleCheckouts = async () => {
  const THRESHOLD_HOURS = parseFloat(process.env.ABANDONMENT_THRESHOLD_HOURS) || 24;
  const BATCH_SIZE = 500;

  const cutoff = new Date(
    Date.now() - THRESHOLD_HOURS * 60 * 60 * 1000
  );

  let marked   = 0;
  let errors   = 0;
  let batches  = 0;
  let lastId   = null;
  let hasMore  = true;

  while (hasMore) {
    batches++;

    const query = {
      status:                   'pending',
      lastActivityAt:           { $lt: cutoff },
      'conversion.isConverted': false,
      ...(lastId && { _id: { $gt: lastId } })
    };

    const staleCheckouts = await Checkout.find(query)
      .select('_id status lastActivityAt abandonment conversion currentStep')
      .sort({ _id: 1 })
      .limit(BATCH_SIZE);

    if (staleCheckouts.length === 0) {
      hasMore = false;
      break;
    }

    lastId = staleCheckouts[staleCheckouts.length - 1]._id;

    for (const checkout of staleCheckouts) {
      try {
        if (
          checkout.status !== 'pending' ||
          checkout.conversion?.isConverted
        ) {
          continue;
        }

        checkout.markAsAbandoned();
        checkout._shouldInvalidateCache = false; // suppress per-document cache hook — bulk flush happens after loop
        await checkout.save();
        marked++;
      } catch (err) {
        errors++;
        console.error(
          `[markStaleCheckouts] Failed to mark checkout ${checkout._id} as abandoned:`,
          err.message
        );
      }
    }

    if (staleCheckouts.length < BATCH_SIZE) {
      hasMore = false;
    }

    if (batches >= 100) {
      console.warn('[markStaleCheckouts] Reached 100 batch limit — stopping sweep early.');
      break;
    }
  }

  if (marked > 0) {
    await Promise.all([
      deleteCachePattern('checkout_abandonment_*'),
      deleteCachePattern('checkout_recovery_*'),
      deleteCachePattern('abandoned_list:*'),
      deleteCachePattern('admin_stats*'),
      deleteCachePattern('analytics_*')
    ]).catch(err =>
      console.error('[markStaleCheckouts] Cache flush failed:', err.message)
    );
  }

  return { marked, errors, batches };
};

export default markStaleCheckouts;
import Checkout from '../models/checkout-model.js';

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
 * @returns {Promise<{ marked: number, errors: number }>}
 */
export const markStaleCheckouts = async () => {
  const THRESHOLD_HOURS = parseFloat(process.env.ABANDONMENT_THRESHOLD_HOURS) || 24;

  const cutoff = new Date(
    Date.now() - THRESHOLD_HOURS * 60 * 60 * 1000
  );

  // Fetch only the fields we need — lean() is intentionally NOT used here
  // because we need to call instance methods (markAsAbandoned + save).
  const staleCheckouts = await Checkout.find({
    status:                   'pending',
    lastActivityAt:           { $lt: cutoff },
    'conversion.isConverted': false,
  }).select('_id status lastActivityAt abandonment conversion currentStep');

  let marked = 0;
  let errors = 0;

  for (const checkout of staleCheckouts) {
    try {
      // Guard: skip if already abandoned or converted by the time we process
      // it (e.g. concurrent request handled it between the find and here).
      if (
        checkout.status !== 'pending' ||
        checkout.conversion?.isConverted
      ) {
        continue;
      }

      checkout.markAsAbandoned();
      await checkout.save();
      marked++;
    } catch (err) {
      // One bad document must never abort the entire sweep.
      errors++;
      console.error(
        `[markStaleCheckouts] Failed to mark checkout ${checkout._id} as abandoned:`,
        err.message
      );
    }
  }

  return { marked, errors };
};

export default markStaleCheckouts;
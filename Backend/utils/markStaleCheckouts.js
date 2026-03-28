import Checkout from '../models/checkout-model.js';
import { deleteCachePattern } from '../utils/redis.js';


export const markStaleCheckouts = async () => {
  const THRESHOLD_HOURS = parseFloat(process.env.ABANDONMENT_THRESHOLD_HOURS) || 24;

  const RECOVERY_TOKEN_TTL_SECONDS =
    parseInt(process.env.RECOVERY_TOKEN_TTL_SECONDS) || 72 * 60 * 60;

  const BATCH_SIZE = 500;

  const cutoff = new Date(
    Date.now() - THRESHOLD_HOURS * 60 * 60 * 1000
  );

  let marked      = 0;
  let errors      = 0;
  let batches     = 0;
  let reAbandoned = 0;
  let lastId      = null;
  let hasMore     = true;

  // ── PRIMARY PASS: mark stale pending checkouts as abandoned ───────────────
  while (hasMore) {
    batches++;

    const query = {
      status:                   'pending',
      lastActivityAt:           { $lt: cutoff },
      'conversion.isConverted': false,
      ...(lastId && { _id: { $gt: lastId } })
    };

    const staleCheckouts = await Checkout.find(query)
      .select(
        '_id status lastActivityAt abandonment conversion currentStep'
      )
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

        const isFailedRecovery =
          checkout.abandonment?.recoveryEmailSent === true &&
          !!checkout.abandonment?.recoveryLinkClickedAt;

        checkout.markAsAbandoned();

        checkout._shouldInvalidateCache = false;

        await checkout.save();
        marked++;

        if (isFailedRecovery) {
          reAbandoned++;

          console.log(
            `[markStaleCheckouts] Re-abandoned (failed recovery): checkout=${checkout._id}` +
            ` | failedRecoveries=${checkout.abandonment.failedRecoveries}`
          );
        }
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
      console.warn(
        '[markStaleCheckouts] Reached 100 batch limit — stopping sweep early.'
      );
      break;
    }
  }


  try {
    const tokenExpiryThreshold = new Date(
      Date.now() - RECOVERY_TOKEN_TTL_SECONDS * 1000
    );

    await Checkout.updateMany(
      {
        'abandonment.lastRecoveryTokenIssuedAt': { $lte: tokenExpiryThreshold },
        'abandonment.recoveryLinkClickedAt':     { $exists: false },
        'abandonment.lastRecoveryTokenExpiredAt': { $exists: false },
        'conversion.isConverted':                false
      },
      {
        $set: { 'abandonment.lastRecoveryTokenExpiredAt': new Date() }
      }
    );
  } catch (err) {
    // Non-fatal — secondary pass failure must not affect the primary result.
    console.error(
      '[markStaleCheckouts] Secondary pass (token expiry write) failed:',
      err.message
    );
  }

  // ── Bulk cache flush ──────────────────────────────────────────────────────
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

  return { marked, errors, batches, reAbandoned };
};

export default markStaleCheckouts;
import Checkout from '../models/checkout-model.js';
import { deleteCachePattern } from '../utils/redis.js';

/**
 * Mark abandoned checkouts (run every hour)
 * 
 * Features:
 * - Captures abandonedAtStep for funnel analytics
 * - Uses lastActivityAt for abandonedAt timestamp
 * - Invalidates caches after updates
 * - Batch processing for scalability
 * - Comprehensive logging and error handling
 */
export const markAbandonedCheckouts = async () => {
  const startTime = Date.now();
  
  try {
    const BATCH_SIZE = 500;
    const ABANDONMENT_THRESHOLD_HOURS = parseInt(process.env.ABANDONMENT_THRESHOLD_HOURS) || 24;
    const cutoffDate = new Date(Date.now() - ABANDONMENT_THRESHOLD_HOURS * 60 * 60 * 1000);
    
    console.log(`🔍 Starting abandonment detection (threshold: ${ABANDONMENT_THRESHOLD_HOURS}h, cutoff: ${cutoffDate.toISOString()})`);
    
    let totalModified = 0;
    let totalProcessed = 0;
    let hasMore = true;
    let batchCount = 0;

    while (hasMore) {
      batchCount++;
      
      const checkouts = await Checkout.find({
        status: 'pending',
        lastActivityAt: { $lt: cutoffDate },
        'abandonment.isAbandoned': false
      })
      .select('_id lastActivityAt currentStep')
      .limit(BATCH_SIZE)
      .lean();

      totalProcessed += checkouts.length;

      if (checkouts.length === 0) {
        hasMore = false;
        break;
      }

      const bulkOps = checkouts.map(checkout => ({
        updateOne: {
          filter: { _id: checkout._id },
          update: {
            $set: {
              status: 'abandoned',
              'abandonment.isAbandoned': true,
              'abandonment.abandonedAt': checkout.lastActivityAt,
              'abandonment.abandonedAtStep': checkout.currentStep || 'shipping_info'
            }
          }
        }
      }));

      const result = await Checkout.bulkWrite(bulkOps, { 
        ordered: false
      });
      
      totalModified += result.modifiedCount;

      console.log(`  Batch ${batchCount}: ${result.modifiedCount}/${checkouts.length} updated`);

      if (checkouts.length < BATCH_SIZE) {
        hasMore = false;
      }

      if (batchCount >= 100) {
        console.warn(`⚠️ Abandonment job exceeded 100 batches (${totalProcessed} processed), stopping`);
        break;
      }
    }

    if (totalModified > 0) {
      await Promise.all([
        deleteCachePattern('checkout_abandonment_*'),
        deleteCachePattern('checkout_recovery_*'),
        deleteCachePattern('abandoned_list:*'),
        deleteCachePattern('admin_stats*'),
        deleteCachePattern('analytics_*')
      ]).catch(err => {
        console.error('⚠️ Cache invalidation failed (non-critical):', err);
      });
      console.log('✅ Analytics caches invalidated');
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const rate = duration > 0 ? Math.round(totalModified / parseFloat(duration)) : 0;
    
    console.log(`✅ Abandonment detection complete: ${totalModified}/${totalProcessed} marked in ${duration}s (${rate}/sec)`);
    
    return { 
      success: true,
      modifiedCount: totalModified,
      processedCount: totalProcessed,
      batches: batchCount,
      durationSeconds: parseFloat(duration)
    };
    
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`❌ Abandonment detection failed after ${duration}s:`, error);
    
    return {
      success: false,
      error: error.message,
      modifiedCount: 0
    };
  }
};

/**
 * Manually trigger abandonment detection
 * @route POST /api/v1/admin/trigger-abandonment-check
 * @access Admin
 */
export const triggerAbandonmentCheck = async (req, res, next) => {
  try {
    const result = await markAbandonedCheckouts();
    
    res.status(200).json({
      success: true,
      message: 'Abandonment detection triggered',
      result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Abandonment detection failed',
      error: error.message
    });
  }
};

/*
SCHEDULER SETUP - Add to your main app/server file:

import cron from 'node-cron';
import { markAbandonedCheckouts } from './jobs/abandonment.job.js';

// Run every hour at :00
cron.schedule('0 * * * *', async () => {
  console.log('⏰ Running hourly abandonment check...');
  await markAbandonedCheckouts();
});

// Optional: Run on startup (after 5 minute delay)
setTimeout(async () => {
  console.log('🚀 Running initial abandonment check...');
  await markAbandonedCheckouts();
}, 5 * 60 * 1000);
*/
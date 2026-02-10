// ============================================
// PRODUCTION-READY ABANDONMENT DETECTION CRON
// Replace your existing markAbandonedCheckouts function with this
// ============================================

import Checkout from '../models/checkout-model.js';
import { deleteCachePattern } from '../utils/redis.js';

/**
 * Mark abandoned checkouts (run every hour)
 * 
 * CRITICAL FIXES:
 * 1. ✅ Captures abandonedAtStep (was missing - broke funnel analytics)
 * 2. ✅ Uses lastActivityAt for abandonedAt (was using current time)
 * 3. ✅ Invalidates caches after updates
 * 4. ✅ Batch processing for scalability
 * 5. ✅ Comprehensive logging and error handling
 */
export const markAbandonedCheckouts = async () => {
  const startTime = Date.now();
  
  try {
    // Configuration
    const BATCH_SIZE = 500; // Process 500 checkouts at a time
    const ABANDONMENT_THRESHOLD_HOURS = parseInt(process.env.ABANDONMENT_THRESHOLD_HOURS) || 24;
    const cutoffDate = new Date(Date.now() - ABANDONMENT_THRESHOLD_HOURS * 60 * 60 * 1000);
    
    console.log(`🔍 Starting abandonment detection (threshold: ${ABANDONMENT_THRESHOLD_HOURS}h, cutoff: ${cutoffDate.toISOString()})`);
    
    let totalModified = 0;
    let totalProcessed = 0;
    let hasMore = true;
    let batchCount = 0;

    while (hasMore) {
      batchCount++;
      
      // Find batch of pending checkouts that passed the threshold
      const checkouts = await Checkout.find({
        status: 'pending',
        lastActivityAt: { $lt: cutoffDate },
        'abandonment.isAbandoned': false // Don't re-process already abandoned
      })
      .select('_id lastActivityAt currentStep') // Only fetch fields we need
      .limit(BATCH_SIZE)
      .lean(); // Faster read-only queries

      totalProcessed += checkouts.length;

      if (checkouts.length === 0) {
        hasMore = false;
        break;
      }

      // Prepare bulk update operations
      const bulkOps = checkouts.map(checkout => ({
        updateOne: {
          filter: { _id: checkout._id },
          update: {
            $set: {
              status: 'abandoned',
              'abandonment.isAbandoned': true,
              
              // CRITICAL FIX #1: Use actual abandonment time, not current time
              'abandonment.abandonedAt': checkout.lastActivityAt,
              
              // CRITICAL FIX #2: Capture which step they abandoned at
              'abandonment.abandonedAtStep': checkout.currentStep || 'shipping_info'
            }
          }
        }
      }));

      // Execute bulk update
      const result = await Checkout.bulkWrite(bulkOps, { 
        ordered: false // Continue even if some updates fail
      });
      
      totalModified += result.modifiedCount;

      console.log(`  Batch ${batchCount}: ${result.modifiedCount}/${checkouts.length} updated`);

      // If we got fewer than BATCH_SIZE, we've processed all pending
      if (checkouts.length < BATCH_SIZE) {
        hasMore = false;
      }

      // Safety valve: Prevent infinite loops
      if (batchCount >= 100) {
        console.warn(`⚠️ Abandonment job exceeded 100 batches (${totalProcessed} processed), stopping`);
        break;
      }
    }

    // CRITICAL FIX #3: Invalidate analytics caches
    if (totalModified > 0) {
      await Promise.all([
        deleteCachePattern('checkout_abandonment_*'),
        deleteCachePattern('checkout_recovery_*'),
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

// ============================================
// OPTIONAL: Manual trigger endpoint for testing
// Add this to your routes if you want to test manually
// ============================================

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

// ============================================
// SCHEDULER SETUP
// Add this to your main app/server file
// ============================================

/*
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

// ============================================
// TESTING GUIDE
// ============================================

/*
HOW TO TEST:

1. Create test checkout in database:
   db.checkouts.insertOne({
     user: ObjectId("..."),
     email: "test@example.com",
     items: [{ product: ObjectId("..."), quantity: 1, price: 100 }],
     pricing: { totalPrice: 100 },
     status: "pending",
     currentStep: "payment_selection",
     lastActivityAt: new Date(Date.now() - 25 * 60 * 60 * 1000), // 25 hours ago
     createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
     abandonment: {
       isAbandoned: false
     }
   })

2. Run function manually:
   const result = await markAbandonedCheckouts();
   console.log(result);

3. Verify in database:
   db.checkouts.findOne({ email: "test@example.com" })
   
   Should have:
   - status: "abandoned"
   - abandonment.isAbandoned: true
   - abandonment.abandonedAt: <25 hours ago timestamp>
   - abandonment.abandonedAtStep: "payment_selection"

4. Check analytics endpoint:
   GET /api/v1/analytics/checkout/abandonment?timeframe=month
   
   Should show:
   - Increased abandoned count
   - "payment_selection" in abandonmentByStep array

5. Verify cache was invalidated:
   - Should not return cached data
   - Check logs for "Analytics caches invalidated" message
*/
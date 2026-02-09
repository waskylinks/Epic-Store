import Checkout from '../models/checkout-model.js';

/**
 * Mark abandoned checkouts (run every hour)
 */
export const markAbandonedCheckouts = async () => {
  try {
    const result = await Checkout.updateMany(
      {
        status: 'pending',
        lastActivityAt: { 
          $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) // 24 hours
        }
      },
      {
        $set: {
          status: 'abandoned',
          'abandonment.isAbandoned': true,
          'abandonment.abandonedAt': new Date()
        }
      }
    );
    
    console.log(`Marked ${result.modifiedCount} checkouts as abandoned`);
    return result;
  } catch (error) {
    console.error('Error marking abandoned checkouts:', error);
    throw error;
  }
};
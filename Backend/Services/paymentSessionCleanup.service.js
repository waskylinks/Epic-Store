import redis from '../utils/redis.js';

/**
 * Cleanup utility for payment sessions
 * Note: Redis automatically deletes sessions after TTL expires
 * This script is for manual cleanup or monitoring purposes
 */

const SESSION_PREFIX = 'payment_session:';

/**
 * Get all payment sessions (for monitoring/debugging)
 * @returns {Array} Array of all sessions with metadata
 */
export const getAllPaymentSessions = async () => {
  try {
    const keys = await redis.keys(`${SESSION_PREFIX}*`);
    const sessions = [];

    for (const key of keys) {
      const sessionData = await redis.get(key);
      if (sessionData) {
        const session = JSON.parse(sessionData);
        const ttl = await redis.ttl(key);
        
        sessions.push({
          reference: session.reference,
          userId: session.userId,
          gateway: session.gateway,
          amount: session.totalPrice,
          currency: session.currency,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
          ttlRemaining: ttl
        });
      }
    }

    return sessions;
  } catch (error) {
    console.error('❌ Failed to get all payment sessions:', error);
    return [];
  }
};

/**
 * Get payment sessions statistics
 * @returns {Object} Statistics about payment sessions
 */
export const getPaymentSessionStats = async () => {
  try {
    const sessions = await getAllPaymentSessions();
    
    const stats = {
      total: sessions.length,
      byGateway: {},
      byCurrency: {},
      totalValue: 0,
      oldestSession: null,
      newestSession: null
    };

    sessions.forEach(session => {
      // By gateway
      stats.byGateway[session.gateway] = (stats.byGateway[session.gateway] || 0) + 1;
      
      // By currency
      stats.byCurrency[session.currency] = (stats.byCurrency[session.currency] || 0) + 1;
      
      // Total value
      stats.totalValue += session.amount;
      
      // Oldest/Newest
      if (!stats.oldestSession || new Date(session.createdAt) < new Date(stats.oldestSession.createdAt)) {
        stats.oldestSession = session;
      }
      if (!stats.newestSession || new Date(session.createdAt) > new Date(stats.newestSession.createdAt)) {
        stats.newestSession = session;
      }
    });

    return stats;
  } catch (error) {
    console.error('❌ Failed to get payment session stats:', error);
    return null;
  }
};

/**
 * Manual cleanup of all expired sessions (Redis does this automatically)
 * This is mainly for monitoring purposes
 */
export const cleanupExpiredSessions = async () => {
  try {
    const keys = await redis.keys(`${SESSION_PREFIX}*`);
    let cleaned = 0;

    for (const key of keys) {
      const ttl = await redis.ttl(key);
      
      // If TTL is -2, key doesn't exist (already expired)
      // If TTL is -1, key exists but has no expiry (shouldn't happen)
      if (ttl === -2 || ttl === -1) {
        await redis.del(key);
        cleaned++;
      }
    }

    console.log(`✅ Cleaned up ${cleaned} expired payment sessions`);
    return cleaned;
  } catch (error) {
    console.error('❌ Failed to cleanup expired sessions:', error);
    return 0;
  }
};

/**
 * Force delete a specific payment session (for admin use)
 * @param {string} reference - Payment reference
 */
export const forceDeleteSession = async (reference) => {
  try {
    await redis.del(`${SESSION_PREFIX}${reference}`);
    console.log(`✅ Force deleted payment session: ${reference}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to force delete session:', error);
    return false;
  }
};

/**
 * Clear all payment sessions (DANGEROUS - use only for testing)
 */
export const clearAllPaymentSessions = async () => {
  try {
    const keys = await redis.keys(`${SESSION_PREFIX}*`);
    
    if (keys.length === 0) {
      console.log('ℹ️ No payment sessions to clear');
      return 0;
    }

    await redis.del(keys);
    console.log(`✅ Cleared ${keys.length} payment sessions`);
    return keys.length;
  } catch (error) {
    console.error('❌ Failed to clear all payment sessions:', error);
    return 0;
  }
};

// Export for cron jobs or scheduled cleanup
export default {
  getAllPaymentSessions,
  getPaymentSessionStats,
  cleanupExpiredSessions,
  forceDeleteSession,
  clearAllPaymentSessions
};
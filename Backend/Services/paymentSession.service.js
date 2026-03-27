import redis from '../utils/redis.js';
import crypto from 'crypto';



const SESSION_PREFIX = 'payment_session:';
const ALIAS_PREFIX = 'payment_alias:';
const SESSION_TTL = 1800; 

/**
 * Generate unique payment reference
 */
export const generatePaymentReference = () => {
  const timestamp = Date.now();
  const randomStr = crypto.randomBytes(6).toString('hex').toUpperCase();
  return `ORD-${timestamp}-${randomStr}`;
};

/**
 * Create payment session in Redis
 * @param {Object} sessionData - Payment session data
 * @returns {string} Reference ID
 */
export const createPaymentSession = async (sessionData) => {
  // Use provided reference if given, otherwise generate one
  const reference = sessionData.reference || generatePaymentReference();
  
  const session = {
    ...sessionData,
    reference,  // ensure reference is canonical in the session body
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_TTL * 1000).toISOString()
  };

  try {
    await redis.set(
      `${SESSION_PREFIX}${reference}`,  // ← key matches the reference
      JSON.stringify(session),
      { EX: SESSION_TTL }
    );
    
    console.log(`✅ Payment session created: ${reference} (expires in ${SESSION_TTL}s)`);
    return reference;
  } catch (error) {
    console.error('❌ Failed to create payment session:', error);
    throw new Error('Failed to create payment session');
  }
};

/**
 * ✅ NEW: Create an alias that points to an existing session
 * Used for Stripe to map payment_intent_id → order reference
 * @param {string} aliasKey - The alias key (e.g., payment_intent_id)
 * @param {string} targetReference - The actual session reference
 */
export const createSessionAlias = async (aliasKey, targetReference) => {
  try {
    await redis.set(
      `${ALIAS_PREFIX}${aliasKey}`,
      targetReference,
      { EX: SESSION_TTL }
    );
    
    console.log(`✅ Payment alias created: ${aliasKey} → ${targetReference}`);
  } catch (error) {
    console.error('❌ Failed to create payment alias:', error);
    throw new Error('Failed to create payment alias');
  }
};

/**
 * ✅ UPDATED: Get payment session from Redis
 * Automatically resolves aliases (e.g., Stripe payment_intent_id)
 * @param {string} reference - Payment reference or alias
 * @returns {Object|null} Session data or null if not found/expired
 */
export const getPaymentSession = async (reference) => {
  try {
    // First, try to get the session directly
    let sessionData = await redis.get(`${SESSION_PREFIX}${reference}`);
    
    if (sessionData) {
      return JSON.parse(sessionData);
    }

    // If not found, check if it's an alias
    const actualReference = await redis.get(`${ALIAS_PREFIX}${reference}`);
    
    if (actualReference) {
      console.log(`🔗 Alias resolved: ${reference} → ${actualReference}`);
      sessionData = await redis.get(`${SESSION_PREFIX}${actualReference}`);
      
      if (sessionData) {
        return JSON.parse(sessionData);
      }
    }

    console.warn(`⚠️ Payment session not found or expired: ${reference}`);
    return null;
  } catch (error) {
    console.error('❌ Failed to get payment session:', error);
    return null;
  }
};

/**
 * ✅ UPDATED: Delete payment session from Redis
 * Also deletes any aliases pointing to this session
 * @param {string} reference - Payment reference or alias
 */
export const deletePaymentSession = async (reference) => {
  try {
    // Delete the session
    await redis.del(`${SESSION_PREFIX}${reference}`);
    
    // Delete the alias (if it exists)
    await redis.del(`${ALIAS_PREFIX}${reference}`);
    
    console.log(`✅ Payment session deleted: ${reference}`);
  } catch (error) {
    console.error('❌ Failed to delete payment session:', error);
  }
};

/**
 * Extend payment session TTL (useful for long payment processes)
 * @param {string} reference - Payment reference
 * @param {number} additionalSeconds - Additional seconds to add to TTL
 */
export const extendPaymentSession = async (reference, additionalSeconds = 600) => {
  try {
    await redis.expire(`${SESSION_PREFIX}${reference}`, additionalSeconds);
    console.log(`✅ Payment session extended: ${reference} (+${additionalSeconds}s)`);
  } catch (error) {
    console.error('❌ Failed to extend payment session:', error);
  }
};

/**
 * Get all active payment sessions for a user (for debugging/admin)
 * @param {string} userId - User ID
 * @returns {Array} Array of active sessions
 */
export const getUserPaymentSessions = async (userId) => {
  try {
    const keys = await redis.keys(`${SESSION_PREFIX}*`);
    const sessions = [];

    for (const key of keys) {
      const sessionData = await redis.get(key);
      if (sessionData) {
        const session = JSON.parse(sessionData);
        if (session.userId === userId) {
          sessions.push(session);
        }
      }
    }

    return sessions;
  } catch (error) {
    console.error('❌ Failed to get user payment sessions:', error);
    return [];
  }
};
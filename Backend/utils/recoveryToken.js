import jwt from 'jsonwebtoken';

const SECRET          = process.env.RECOVERY_TOKEN_SECRET;
const EXPIRY = process.env.RECOVERY_TOKEN_EXPIRES || '72h';
const EXPIRY_SECONDS  = 72 * 60 * 60; // 259200s — used for cache/cookie TTL if needed

/**
 * Generate a signed recovery token for an abandoned checkout.
 *
 * Payload:
 *   checkoutId — the Checkout document _id (string)
 *   userId     — the owning User _id (string)
 *   email      — recipient email (for a quick sanity check on verify)
 *   type       — literal 'cart_recovery' so this token can never be
 *                confused with an auth token even if JWT_SECRET is shared
 *
 * @param {Object} params
 * @param {string} params.checkoutId
 * @param {string} params.userId
 * @param {string} params.email
 * @returns {string} signed JWT
 */
export const generateRecoveryToken = ({ checkoutId, userId, email }) => {
  if (!SECRET) throw new Error('RECOVERY_TOKEN_SECRET is not defined in environment');

  return jwt.sign(
    {
      checkoutId: checkoutId.toString(),
      userId:     userId.toString(),
      email,
      type:       'cart_recovery',
    },
    SECRET,
    { expiresIn: EXPIRY }
  );
};

/**
 * Verify and decode a recovery token.
 *
 * Returns the decoded payload on success.
 * Throws a structured error on failure so callers can respond appropriately.
 *
 * @param {string} token
 * @returns {{ checkoutId: string, userId: string, email: string, type: string, iat: number, exp: number }}
 * @throws {{ message: string, code: 'EXPIRED' | 'INVALID' }}
 */
export const verifyRecoveryToken = (token) => {
  if (!SECRET) throw new Error('RECOVERY_TOKEN_SECRET is not defined in environment');

  try {
    const decoded = jwt.verify(token, SECRET);

    // Guard: reject tokens that weren't issued for cart recovery
    // (prevents accidental reuse of auth tokens on this endpoint)
    if (decoded.type !== 'cart_recovery') {
      throw Object.assign(new Error('Token type mismatch'), { code: 'INVALID' });
    }

    return decoded;
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw Object.assign(
        new Error('Recovery link has expired. Links are valid for 72 hours.'),
        { code: 'EXPIRED' }
      );
    }

    if (err.code === 'INVALID') throw err;

    // JsonWebTokenError, NotBeforeError, or anything else
    throw Object.assign(
      new Error('Recovery link is invalid or has been tampered with.'),
      { code: 'INVALID' }
    );
  }
};

/**
 * How many seconds until a freshly-issued token expires.
 * Useful for setting cache TTL on the recovery page.
 */
export const RECOVERY_TOKEN_TTL_SECONDS = EXPIRY_SECONDS;

/**
 * Decode a recovery token WITHOUT verifying its signature or expiry.
 * Use only for best-effort audit writes (e.g. recording token expiry).
 * Never trust the payload for auth or access control.
 *
 * @param {string} token
 * @returns {Object|null} decoded payload, or null if token is malformed
 */
export const decodeRecoveryToken = (token) => jwt.decode(token);
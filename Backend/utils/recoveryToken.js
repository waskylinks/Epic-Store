import jwt from 'jsonwebtoken';

const SECRET         = process.env.RECOVERY_TOKEN_SECRET;
const DEFAULT_EXPIRY = process.env.RECOVERY_TOKEN_EXPIRES || '72h';
const DEFAULT_EXPIRY_SECONDS = 72 * 60 * 60;

/**
 * Generate a signed recovery token for an abandoned checkout.
 *
 * Payload:
 *   checkoutId — the Checkout document _id (string)
 *   userId     — the owning User _id (string)
 *   email      — recipient email address
 *   type       — literal 'cart_recovery' so this token can never be
 *                confused with an auth token even if JWT_SECRET is shared
 *   jti        — unique token ID for per-attempt attribution (injected by
 *                RecoveryEmail.initiateSend — never reuse across attempts)
 *
 * @param {Object} params
 * @param {string} params.checkoutId
 * @param {string} params.userId
 * @param {string} params.email
 *
 * @param {Object} [opts]
 * @param {string|number} [opts.expiresIn]  Override default TTL.
 *                                           String ('48h') or seconds (172800).
 *                                           Defaults to RECOVERY_TOKEN_EXPIRES env var.
 * @param {string}        [opts.jti]        Unique token ID (jti claim).
 *                                           Required for per-attempt attribution.
 *                                           Defaults to a random string if omitted.
 *
 * @returns {string} signed JWT
 */
export const generateRecoveryToken = (
  { checkoutId, userId, email },
  opts = {}
) => {
  if (!SECRET) {
    throw new Error('RECOVERY_TOKEN_SECRET is not defined in environment');
  }

  const expiresIn = opts.expiresIn ?? DEFAULT_EXPIRY;

  // Build a deterministic jti if none supplied so tokens are always
  // individually identifiable even in legacy call-sites that omit opts.
  const jti = opts.jti ||
    `${checkoutId}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  return jwt.sign(
    {
      checkoutId: checkoutId.toString(),
      userId:     userId.toString(),
      email,
      type:       'cart_recovery',
    },
    SECRET,
    {
      expiresIn,
      jwtid: jti, // sets the standard JWT 'jti' claim
    }
  );
};

/**
 * Verify and decode a recovery token.
 *
 * Returns the decoded payload (including jti) on success.
 * Throws a structured error on failure so callers can respond appropriately.
 *
 * @param {string} token
 * @returns {{
 *   checkoutId: string,
 *   userId:     string,
 *   email:      string,
 *   type:       string,
 *   jti:        string,
 *   iat:        number,
 *   exp:        number
 * }}
 * @throws {{ message: string, code: 'EXPIRED' | 'INVALID' }}
 */
export const verifyRecoveryToken = (token) => {
  if (!SECRET) {
    throw new Error('RECOVERY_TOKEN_SECRET is not defined in environment');
  }

  try {
    const decoded = jwt.verify(token, SECRET);

    if (decoded.type !== 'cart_recovery') {
      throw Object.assign(
        new Error('Token type mismatch'),
        { code: 'INVALID' }
      );
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

    throw Object.assign(
      new Error('Recovery link is invalid or has been tampered with.'),
      { code: 'INVALID' }
    );
  }
};

/**
 * Decode a recovery token WITHOUT verifying signature or expiry.
 * Use ONLY for best-effort audit writes (e.g. recording token expiry timestamps).
 * Never trust the payload for auth or access-control decisions.
 *
 * @param {string} token
 * @returns {Object|null} decoded payload, or null if token is malformed
 */
export const decodeRecoveryToken = (token) => jwt.decode(token);

/**
 * Default TTL in seconds — exposed so the model and service can cap
 * token lifetime against the checkout document's expiresAt field.
 */
export const RECOVERY_TOKEN_TTL_SECONDS = DEFAULT_EXPIRY_SECONDS;
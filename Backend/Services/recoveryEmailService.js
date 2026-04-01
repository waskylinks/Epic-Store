import Checkout from '../models/checkout-model.js';
import { buildRecoveryEmailHtml } from './emailTemplates/recoveryEmail.js';
import { sendEmail } from '../utils/sendEmail.js';

// ============================================
// CONSTANTS
// ============================================

const BULK_BATCH_DELAY_MS = 300;
const MAX_BULK_IDS        = 100;

// ============================================
// INTERNAL HELPERS
// ============================================

/**
 * Build the recovery URL from the token.
 * Throws early if FRONTEND_URL is not set so we never send an email
 * with a broken or missing recovery link.
 */
const buildRecoveryUrl = (token) => {
  const base = process.env.FRONTEND_URL;

  if (!base) {
    throw new Error(
      'FRONTEND_URL is not defined in environment. ' +
      'Cannot build recovery link — aborting send.'
    );
  }

  return `${base}/checkout/recover?token=${token}`;
};

/**
 * Validate that the checkout document is in a sendable state
 * before touching the token or the email provider.
 *
 * Returns { valid: false, reason } or { valid: true }.
 */
const validateCheckoutForSend = (checkout) => {
  if (!checkout) {
    return { valid: false, reason: 'Checkout not found' };
  }

  if (!checkout.user || typeof checkout.user !== 'object') {
    return {
      valid:  false,
      reason: 'The account associated with this checkout no longer exists',
    };
  }

  if (!checkout.email) {
    return { valid: false, reason: 'Checkout has no email address' };
  }

  if (checkout.conversion?.isConverted) {
    return { valid: false, reason: 'Checkout already converted' };
  }

  if (checkout.abandonment?.recovered) {
    return { valid: false, reason: 'Checkout already recovered' };
  }

  if (!checkout.items || checkout.items.length === 0) {
    return { valid: false, reason: 'Checkout has no items' };
  }

  return { valid: true };
};

/**
 * Ensure the checkout document has all fields the service and template need.
 * Accepts either a Mongoose document or a raw _id string/ObjectId.
 * If a document is passed and user is already populated, returns it as-is
 * to avoid an unnecessary DB round-trip (single-send controller path).
 */
const ensurePopulated = async (checkoutOrId) => {
  const isId =
    typeof checkoutOrId === 'string' ||
    checkoutOrId?.constructor?.name === 'ObjectId';

  if (isId) {
    return Checkout.findById(checkoutOrId)
      .populate('user',          'firstName lastName email')
      .populate('items.product', 'name images pricing status');
  }

  // Already a Mongoose document — check if user is populated
  const userIsPopulated =
    checkoutOrId.user &&
    typeof checkoutOrId.user === 'object' &&
    checkoutOrId.user.email;

  if (!userIsPopulated) {
    return Checkout.findById(checkoutOrId._id)
      .populate('user',          'firstName lastName email')
      .populate('items.product', 'name images pricing status');
  }

  return checkoutOrId;
};

/**
 * Normalise cart items for the email template.
 * Falls back through the populated product fields when the denormalised
 * fields on the cart item were not written at checkout creation time.
 */
const normaliseItems = (items = []) =>
  items.map((item) => ({
    name:     item.name     || item.product?.name                     || 'Product',
    price:    item.price    ?? item.product?.pricing?.sale
                            ?? item.product?.pricing?.regular         ?? 0,
    quantity: item.quantity ?? 1,
    image:    item.image    || item.product?.images?.[0]?.url         || null,
  }));

/**
 * clearPendingAck
 * Clears the pendingEmailAck lock and saves.
 * Called on both success and failure paths — the lock must always be
 * released or the checkout is permanently blocked from future sends.
 * Non-throwing: logs on failure rather than propagating.
 */
const clearPendingAck = async (checkout) => {
  try {
    checkout.acknowledgeEmailSent();
    await checkout.save();
  } catch (err) {
    console.error(
      `[recoveryEmailService] Failed to clear pendingEmailAck for checkout ${checkout._id}:`,
      err.message
    );
  }
};

// ============================================
// CORE SEND FUNCTION
// ============================================

/**
 * sendRecoveryEmail
 *
 * Sends a single recovery email for an abandoned checkout.
 * Owns the full sequence: validation → token generation → audit write
 * → provider call → lock release. Safe to call from the single-send
 * controller or the bulk loop — never throws without first cleaning up
 * pendingEmailAck.
 *
 * @param {Object|string} checkoutOrId  Mongoose document or Checkout _id string
 * @returns {Promise<SendResult>}
 *
 * @typedef {Object} SendResult
 * @property {true}          success
 * @property {number}        emailCount   — abandonment.recoveryEmailCount after send
 * @property {Date}          sentAt       — abandonment.recoveryEmailSentAt
 * @property {string}        recipient    — email address the send was directed to
 * @property {number}        attempt      — which email in the sequence (1, 2, or 3)
 * @property {string|null}   messageId    — provider message ID for debugging
 * @property {string[]|null} accepted     — addresses provider confirmed acceptance on
 */
export const sendRecoveryEmail = async (checkoutOrId) => {
  // ── 1. Ensure populated document ──────────────────────────────────────────
  let checkout;

  try {
    checkout = await ensurePopulated(checkoutOrId);
  } catch (err) {
    throw new Error(`Failed to load checkout: ${err.message}`);
  }

  // ── 2. Pre-send validation ────────────────────────────────────────────────
  const validation = validateCheckoutForSend(checkout);

  if (!validation.valid) {
    throw Object.assign(new Error(validation.reason), { code: 'SKIPPED' });
  }

  // ── 3. canSendRecoveryEmail — authoritative race-condition guard ───────────
  // The controller checks this before calling us, but time passes between
  // that check and this point — especially relevant in bulk sends where
  // multiple checkouts are processed sequentially in a loop.
  const { canSend, reason } = checkout.canSendRecoveryEmail();

  if (!canSend) {
    throw Object.assign(new Error(reason), { code: 'SKIPPED' });
  }

  // ── 4. Capture attempt number before incrementing ─────────────────────────
  // recoveryEmailCount is the count BEFORE this send. attemptNumber is
  // what the user will experience — "email 1 of 3", "email 2 of 3", etc.
  const attemptNumber = (checkout.abandonment?.recoveryEmailCount ?? 0) + 1;

  // ── 5. Generate token (writes to document, does not save yet) ─────────────
  // generateRecoveryToken() writes lastRecoveryToken, lastRecoveryTokenId,
  // and lastRecoveryTokenIssuedAt to the document.
  let token;

  try {
    token = checkout.generateRecoveryToken();
  } catch (err) {
    throw new Error(`Token generation failed: ${err.message}`);
  }

  // ── 6. Mark email as sent (sets pendingEmailAck: true, increments count) ──
  // markRecoveryEmailSent() throws if canSendRecoveryEmail() is false,
  // but we already checked above so this is safe.
  checkout.markRecoveryEmailSent();

  // ── 7. Persist token + send metadata BEFORE provider call ─────────────────
  // Intentional ordering: if the provider call fails, the audit trail
  // (token issued, send attempted, cooldown set) is already persisted.
  // pendingEmailAck: true now acts as a distributed lock — any concurrent
  // canSendRecoveryEmail() check will return false until we clear it.
  try {
    await checkout.save();
  } catch (err) {
    // Cannot acquire the lock — abort before touching the provider.
    throw new Error(`Failed to persist pre-send state: ${err.message}`);
  }

  // ── 8. Build recovery URL ─────────────────────────────────────────────────
  let recoveryUrl;

  try {
    recoveryUrl = buildRecoveryUrl(token);
  } catch (err) {
    await clearPendingAck(checkout);
    throw err;
  }

  // ── 9. Normalise items for template ───────────────────────────────────────
  const normalisedItems = normaliseItems(checkout.items);

  if (normalisedItems.length === 0) {
    await clearPendingAck(checkout);
    throw Object.assign(
      new Error('All items in this checkout are unavailable'),
      { code: 'SKIPPED' }
    );
  }

  // ── 10. Build email HTML ──────────────────────────────────────────────────
  let emailPayload;

  try {
    emailPayload = buildRecoveryEmailHtml(checkout, recoveryUrl, {
      normalisedItems,
      attemptNumber,
    });
    // Returns { subject, html, text }
  } catch (err) {
    await clearPendingAck(checkout);
    throw new Error(`Email template build failed: ${err.message}`);
  }

  // ── 11. Send via email provider ───────────────────────────────────────────
  let providerResult;

  try {
    providerResult = await sendEmail({
      email:   checkout.email,
      subject: emailPayload.subject,
      html:    emailPayload.html,
      text:    emailPayload.text || '',
    });
  } catch (err) {
    // Provider failed — clear the lock so this checkout can be retried.
    // recoveryEmailCount and recoveryEmailSentAt remain written (cooldown
    // stays active) — the admin sees the attempt was made and can retry
    // after the cooldown window.
    await clearPendingAck(checkout);
    throw new Error(`Email provider failed: ${err.message}`);
  }

  // ── 12. Acknowledge successful send (clears pendingEmailAck) ─────────────
  await clearPendingAck(checkout);

  if (process.env.NODE_ENV === 'development') {
    console.log(
      `[recoveryEmailService] Recovery email #${attemptNumber} sent`,
      `| Checkout: ${checkout._id}`,
      `| To: ${checkout.email}`,
      `| Accepted: ${providerResult.info?.accepted?.[0] ?? '—'}`,
      `| MessageId: ${providerResult.info?.messageId || '—'}`
    );
  }

  return {
    success:    true,
    emailCount: checkout.abandonment.recoveryEmailCount,
    sentAt:     checkout.abandonment.recoveryEmailSentAt,
    recipient:  checkout.email,
    attempt:    attemptNumber,
    messageId:  providerResult.info?.messageId  || null,
    accepted:   providerResult.info?.accepted   ?? null,
  };
};

// ============================================
// BULK SEND
// ============================================

/**
 * sendBulkRecoveryEmails
 *
 * Processes an array of checkout IDs, sending a recovery email for each.
 * Failures are fully isolated — one bad send never affects subsequent
 * checkouts. Always returns a result summary, never throws.
 *
 * @param {string[]} checkoutIds   Array of Checkout _id strings (max 100)
 * @returns {Promise<BulkSendResult>}
 *
 * @typedef {Object} BulkSendResult
 * @property {SendResult[]}                                        sent
 * @property {{ id: string, reason: string }[]}                   skipped
 * @property {{ id: string, error: string }[]}                    failed
 * @property {{ sent: number, skipped: number, failed: number }}  summary
 */
export const sendBulkRecoveryEmails = async (checkoutIds) => {
  if (!Array.isArray(checkoutIds) || checkoutIds.length === 0) {
    throw new Error('checkoutIds must be a non-empty array');
  }

  if (checkoutIds.length > MAX_BULK_IDS) {
    throw new Error(
      `Cannot process more than ${MAX_BULK_IDS} checkouts per bulk request. ` +
      `Received ${checkoutIds.length}.`
    );
  }

  // Deduplicate — guard against UI submitting the same ID twice
  const uniqueIds = [...new Set(checkoutIds.map((id) => id.toString()))];

  const results = { sent: [], skipped: [], failed: [] };

  for (const id of uniqueIds) {
    try {
      const result = await sendRecoveryEmail(id);
      results.sent.push({ id, ...result });

    } catch (err) {
      if (err.code === 'SKIPPED') {
        results.skipped.push({ id, reason: err.message });
      } else {
        results.failed.push({ id, error: err.message });
        console.error(
          `[recoveryEmailService] Bulk send failure for checkout ${id}:`,
          err.message
        );
      }
    }

    // Rate limit buffer — applied for every checkout including skipped ones.
    // Removing the delay for skips adds complexity for negligible gain.
    await new Promise((r) => setTimeout(r, BULK_BATCH_DELAY_MS));
  }

  return {
    ...results,
    summary: {
      sent:    results.sent.length,
      skipped: results.skipped.length,
      failed:  results.failed.length,
    },
  };
};

export default {
  sendRecoveryEmail,
  sendBulkRecoveryEmails,
};
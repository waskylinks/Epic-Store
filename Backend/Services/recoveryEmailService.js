import { sendEmail } from './sendEmail.js';
import { emailTemplates } from '../utils/emailTemplates.js';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

/**
 * Send a cart recovery email for an abandoned checkout.
 *
 * This service is the single orchestration point — it:
 *   1. Builds the tokenized recovery URL
 *   2. Renders the correct template variant based on attempt number
 *   3. Calls sendEmail with the right shape ({ email, subject, html, text })
 *
 * It does NOT mutate the checkout document — that is the controller's job.
 * The controller calls checkout.generateRecoveryToken(), then this service,
 * then checkout.markRecoveryEmailSent(), then checkout.save().
 * Keeping side-effects out of the service makes it independently testable.
 *
 * @param {Object} params
 * @param {import('../models/checkout-model.js').default} params.checkout
 *   The fully populated checkout document (user, items, pricing must be present)
 * @param {string} params.token
 *   The signed JWT produced by checkout.generateRecoveryToken()
 * @returns {Promise<{ success: boolean, messageId: string, recipient: string, attempt: number }>}
 */
export const sendRecoveryEmail = async ({ checkout, token }) => {
  // ── Derive recipient details ────────────────────────────────
  // checkout.user is populated by the controller before calling this service
  const user      = checkout.user || {};
  const firstName = user.firstName || 'there';
  const recipient = checkout.email; // always stored directly on checkout

  // ── Attempt number ──────────────────────────────────────────
  // recoveryEmailCount is the count BEFORE this send, so attempt = count + 1
  const attemptNumber = (checkout.abandonment?.recoveryEmailCount ?? 0) + 1;

  // ── Recovery URL ────────────────────────────────────────────
  // The public recovery route validates this token and restores the cart.
  // Route: GET /api/v1/checkout/recover/:token  (recovery-router.js)
  const recoveryUrl = `${FRONTEND_URL}/checkout/recover?token=${token}`;

  // ── Cart items ──────────────────────────────────────────────
  // Normalise items whether they are populated product docs or plain objects
  const items = (checkout.items || []).map((item) => ({
    name:     item.name     || item.product?.name || 'Product',
    price:    item.price    ?? item.product?.pricing?.sale ?? item.product?.pricing?.regular ?? 0,
    quantity: item.quantity ?? 1,
    image:    item.image    || item.product?.images?.[0]?.url || null,
  }));

  const totalPrice = checkout.pricing?.totalPrice ?? 0;
  const currency   = checkout.pricing?.currency === 'USD' ? '$' : checkout.pricing?.currency || '$';

  // ── Render template ─────────────────────────────────────────
  const { subject, html, text } = emailTemplates.cartRecoveryEmail({
    firstName,
    items,
    totalPrice,
    recoveryUrl,
    attemptNumber,
    currency,
  });

  // ── Send ────────────────────────────────────────────────────
  // sendEmail expects { email, subject, html, text }
  const result = await sendEmail({ email: recipient, subject, html, text });

  if (process.env.NODE_ENV === 'development') {
    console.log(
      `📧 Recovery email #${attemptNumber} sent to ${recipient}`,
      `| Checkout: ${checkout._id}`,
      `| MessageId: ${result.info?.messageId || '—'}`
    );
  }

  return {
    success:   true,
    messageId: result.info?.messageId || null,
    recipient,
    attempt:   attemptNumber,
  };
};
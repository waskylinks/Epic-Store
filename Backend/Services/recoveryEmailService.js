import { sendEmail } from '../utils/sendEmail.js';
import { emailTemplates } from '../utils/emailTemplates.js';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

export const sendRecoveryEmail = async ({ checkout, token }) => {
  // ── Recipient details ────────────────────────────────────────────────────

  const user      = checkout.user || {};
  const firstName = user.firstName || 'there';
  const recipient = checkout.email; // always stored directly on checkout

  const attemptNumber = (checkout.abandonment?.recoveryEmailCount ?? 0) + 1;

  // ── Recovery URL ──────────────────────────────────────────────────────────

  const recoveryUrl = `${FRONTEND_URL}/checkout/recover?token=${token}`;

  // ── Cart items ────────────────────────────────────────────────────────────

  const items = (checkout.items || []).map((item) => ({
    name:     item.name     || item.product?.name                          || 'Product',
    price:    item.price    ?? item.product?.pricing?.sale
                            ?? item.product?.pricing?.regular              ?? 0,
    quantity: item.quantity ?? 1,
    image:    item.image    || item.product?.images?.[0]?.url              || null,
  }));

  const totalPrice = checkout.pricing?.totalPrice ?? 0;
  const currency   =
    checkout.pricing?.currency === 'USD' ? '$' : checkout.pricing?.currency || '$';

  // ── Render template ───────────────────────────────────────────────────────

  const { subject, html, text } = emailTemplates.cartRecoveryEmail({
    firstName,
    items,
    totalPrice,
    recoveryUrl,
    attemptNumber,
    currency,
  });
  const result = await sendEmail({ email: recipient, subject, html, text });

  if (process.env.NODE_ENV === 'development') {
    console.log(
      ` Recovery email #${attemptNumber} sent to ${recipient}`,
      `| Checkout: ${checkout._id}`,
      `| Accepted: ${result.info?.accepted?.[0] ?? '—'}`,
      `| MessageId: ${result.info?.messageId || '—'}`
    );
  }

  return {
    success:   true,
    accepted:  result.info?.accepted ?? null,
    messageId: result.info?.messageId || null,
    recipient,
    attempt:   attemptNumber,
  };
};
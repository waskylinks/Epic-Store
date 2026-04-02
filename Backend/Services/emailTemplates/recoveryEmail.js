// ============================================
// RECOVERY EMAIL TEMPLATE
// services/emailTemplates/recoveryEmail.js
//
// Brand: Epic Store
// Accent: #ff3c3c (coral — matches navbar --nb-coral)
// Font stack: 'Plus Jakarta Sans', -apple-system, sans-serif
// ============================================

// ============================================
// SHARED HELPERS
// ============================================

const formatPrice = (amount, currency = 'USD') => {
  const symbol = currency === 'USD' ? '$'
               : currency === 'EUR' ? '€'
               : currency === 'GBP' ? '£'
               : currency === 'NGN' ? '₦'
               : '$';

  return `${symbol}${Number(amount).toFixed(2)}`;
};

const formatDate = (date) =>
  new Date(date).toLocaleDateString('en-US', {
    weekday: 'long',
    month:   'long',
    day:     'numeric',
  });

/**
 * Render a single cart item row.
 * Handles missing image gracefully with a coloured placeholder block.
 */
const renderItemRow = (item, currency) => {
  const price    = formatPrice(item.price * item.quantity, currency);
  const unitPrice = formatPrice(item.price, currency);
  const imgBlock = item.image
    ? `<img src="${item.image}" alt="${item.name}"
            width="64" height="64"
            style="width:64px;height:64px;object-fit:cover;border-radius:8px;
                   display:block;border:1px solid #e5e7eb;" />`
    : `<div style="width:64px;height:64px;border-radius:8px;background:#f3f4f6;
                   display:flex;align-items:center;justify-content:center;
                   font-size:20px;border:1px solid #e5e7eb;">&#128717;</div>`;

  return `
  <tr>
    <td style="padding:12px 0;border-bottom:1px solid #f3f4f6;vertical-align:top;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td width="80" style="vertical-align:top;padding-right:14px;">
            ${imgBlock}
          </td>
          <td style="vertical-align:top;">
            <p style="margin:0 0 4px;font-size:14px;font-weight:600;
                       color:#111827;line-height:1.4;">${item.name}</p>
            <p style="margin:0;font-size:12px;color:#6b7280;">
              ${unitPrice} &times; ${item.quantity}
            </p>
          </td>
          <td width="80" style="vertical-align:top;text-align:right;">
            <p style="margin:0;font-size:14px;font-weight:700;color:#111827;">
              ${price}
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
};

/**
 * Shared outer shell — header, footer, unsubscribe.
 * Content is injected into the middle card.
 */
const wrapInShell = ({ firstName, preheader, bodyHtml, unsubscribeUrl }) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>Epic Store</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
    body, table, td, p, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
    img { -ms-interpolation-mode:bicubic; border:0; outline:none; text-decoration:none; }
    body { margin:0; padding:0; background:#f3f4f6; }
    a { color:#ff3c3c; text-decoration:none; }
    @media only screen and (max-width:600px) {
      .email-wrapper { padding:16px 8px !important; }
      .email-card    { padding:28px 20px !important; border-radius:12px !important; }
      .cta-btn       { font-size:15px !important; padding:14px 24px !important; }
      .item-img      { width:52px !important; height:52px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;
             font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">

  <!-- Preheader (hidden preview text) -->
  <div style="display:none;font-size:1px;color:#f3f4f6;line-height:1px;
               max-height:0;max-width:0;opacity:0;overflow:hidden;">
    ${preheader}
  </div>

  <!-- Wrapper -->
  <table class="email-wrapper" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background:#f3f4f6;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"
               style="max-width:580px;">

          <!-- ── HEADER ──────────────────────────────────────────────── -->
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background:#ff3c3c;border-radius:10px;
                              padding:8px 18px;display:inline-block;">
                    <a href="${process.env.FRONTEND_URL || '#'}"
                       style="text-decoration:none;color:#fff;
                              font-size:20px;font-weight:700;
                              letter-spacing:-0.3px;white-space:nowrap;">
                      &#x1F6CD; Epic <span style="opacity:0.85;">Store</span>
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ── CARD ───────────────────────────────────────────────── -->
          <tr>
            <td class="email-card"
                style="background:#ffffff;border-radius:16px;
                       padding:40px 36px;
                       box-shadow:0 1px 3px rgba(0,0,0,0.08),0 1px 2px rgba(0,0,0,0.06);">

              ${bodyHtml}

            </td>
          </tr>

          <!-- ── FOOTER ─────────────────────────────────────────────── -->
          <tr>
            <td style="padding:28px 0 8px;text-align:center;">
              <p style="margin:0 0 8px;font-size:12px;color:#9ca3af;line-height:1.6;">
                You received this email because you left items in your
                <a href="${process.env.FRONTEND_URL || '#'}"
                   style="color:#ff3c3c;text-decoration:none;">Epic Store</a> cart.
              </p>
              <p style="margin:0 0 8px;font-size:12px;color:#9ca3af;">
                <a href="${unsubscribeUrl}"
                   style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a>
                &nbsp;&middot;&nbsp;
                <a href="${process.env.FRONTEND_URL || '#'}/contact-us"
                   style="color:#9ca3af;text-decoration:underline;">Contact us</a>
                &nbsp;&middot;&nbsp;
                <a href="${process.env.FRONTEND_URL || '#'}/privacy"
                   style="color:#9ca3af;text-decoration:underline;">Privacy policy</a>
              </p>
              <p style="margin:0;font-size:11px;color:#d1d5db;">
                &copy; ${new Date().getFullYear()} Epic Store. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;

// ============================================
// SHARED PARTIALS
// ============================================

/**
 * Cart summary table — used by all three variants.
 */
const renderCartSummary = (normalisedItems, pricing) => {
  const currency     = pricing?.currency || 'USD';
  const itemRows     = normalisedItems.map(item => renderItemRow(item, currency)).join('');
  const total        = formatPrice(pricing?.totalPrice || 0, currency);
  const shipping     = pricing?.shippingPrice === 0
                       ? '<span style="color:#16a34a;">Free</span>'
                       : formatPrice(pricing?.shippingPrice || 0, currency);
  const tax          = formatPrice(pricing?.taxPrice || 0, currency);
  const hasDiscount  = (pricing?.discountAmount || 0) > 0;
  const discountRow  = hasDiscount ? `
  <tr>
    <td style="padding:4px 0;font-size:13px;color:#16a34a;">
      Discount (${pricing.discountCode || 'code applied'})
    </td>
    <td style="padding:4px 0;font-size:13px;color:#16a34a;text-align:right;font-weight:600;">
      &minus;${formatPrice(pricing.discountAmount, currency)}
    </td>
  </tr>` : '';

  return `
  <!-- Cart items -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0"
         style="margin:20px 0 0;">
    <tbody>
      ${itemRows}
    </tbody>
  </table>

  <!-- Pricing summary -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0"
         style="margin:16px 0 0;border-top:2px solid #f3f4f6;padding-top:14px;">
    <tr>
      <td style="padding:4px 0;font-size:13px;color:#6b7280;">Subtotal</td>
      <td style="padding:4px 0;font-size:13px;color:#374151;text-align:right;">
        ${formatPrice(pricing?.itemPrice || 0, currency)}
      </td>
    </tr>
    ${discountRow}
    <tr>
      <td style="padding:4px 0;font-size:13px;color:#6b7280;">Tax (18%)</td>
      <td style="padding:4px 0;font-size:13px;color:#374151;text-align:right;">
        ${tax}
      </td>
    </tr>
    <tr>
      <td style="padding:4px 0;font-size:13px;color:#6b7280;">Shipping</td>
      <td style="padding:4px 0;font-size:13px;text-align:right;">${shipping}</td>
    </tr>
    <tr>
      <td style="padding:10px 0 0;font-size:15px;font-weight:700;color:#111827;
                 border-top:1px solid #e5e7eb;">Total</td>
      <td style="padding:10px 0 0;font-size:16px;font-weight:700;color:#ff3c3c;
                 text-align:right;border-top:1px solid #e5e7eb;">${total}</td>
    </tr>
  </table>`;
};

/**
 * The coral CTA button.
 */
const ctaButton = (href, label) => `
<table width="100%" cellpadding="0" cellspacing="0" border="0"
       style="margin:28px 0 0;">
  <tr>
    <td align="center">
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml"
                   xmlns:w="urn:schemas-microsoft-com:office:word"
                   href="${href}"
                   style="height:52px;v-text-anchor:middle;width:320px;"
                   arcsize="12%"
                   stroke="f"
                   fillcolor="#ff3c3c">
        <w:anchorlock/>
        <center style="color:#fff;font-family:'Plus Jakarta Sans',sans-serif;
                       font-size:16px;font-weight:700;">
          ${label}
        </center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-->
      <a class="cta-btn" href="${href}"
         style="display:inline-block;background:#ff3c3c;color:#fff;
                font-family:'Plus Jakarta Sans',-apple-system,sans-serif;
                font-size:16px;font-weight:700;text-decoration:none;
                padding:15px 40px;border-radius:10px;
                letter-spacing:0.2px;line-height:1;">
        ${label}
      </a>
      <!--<![endif]-->
    </td>
  </tr>
</table>`;

/**
 * Small security note below the CTA.
 */
const securityNote = `
<p style="margin:16px 0 0;font-size:12px;color:#9ca3af;text-align:center;line-height:1.5;">
  &#128274; Secure checkout &nbsp;&middot;&nbsp; Link expires in 72 hours
</p>`;

// ============================================
// VARIANT 1 — SOFT REMINDER (1 hour)
// Tone: warm, no pressure, just a nudge
// ============================================

const buildVariant1 = ({ firstName, normalisedItems, pricing, recoveryUrl }) => {
  const subject  = `Hey ${firstName}, you left something behind`;
  const preheader = `Your cart is saved — pick up right where you left off.`;

  const bodyHtml = `
    <!-- Heading -->
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#111827;
               line-height:1.3;letter-spacing:-0.4px;">
      You left something behind, ${firstName} &#128722;
    </h1>
    <p style="margin:0 0 4px;font-size:15px;color:#374151;line-height:1.6;">
      No rush — your cart is saved and ready whenever you are.
    </p>
    <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5;">
      Just a heads-up in case you got distracted.
    </p>

    <!-- Divider -->
    <div style="height:1px;background:#f3f4f6;margin:24px 0;"></div>

    <!-- Section label -->
    <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#9ca3af;
               letter-spacing:1px;text-transform:uppercase;">
      Your cart
    </p>

    ${renderCartSummary(normalisedItems, pricing)}
    ${ctaButton(recoveryUrl, 'Complete my purchase')}
    ${securityNote}

    <!-- Divider -->
    <div style="height:1px;background:#f3f4f6;margin:28px 0 20px;"></div>

    <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6;">
      Questions? Reply to this email or visit our
      <a href="${process.env.FRONTEND_URL || '#'}/contact-us"
         style="color:#ff3c3c;text-decoration:none;font-weight:600;">help centre</a>.
    </p>`;

  return { subject, preheader, bodyHtml };
};

// ============================================
// VARIANT 2 — SOCIAL PROOF + STOCK WARNING (24 hours)
// Tone: informative, light urgency via social proof
// ============================================

const buildVariant2 = ({ firstName, normalisedItems, pricing, recoveryUrl }) => {
  const subject   = `${firstName}, other shoppers are eyeing your cart`;
  const preheader = `Popular items don't last long — your cart is still waiting.`;

  // Flag items with low implied stock (we don't have live stock here,
  // so we show a generic warm nudge on the first item only)
  const firstItemName = normalisedItems[0]?.name || 'your item';

  const bodyHtml = `
    <!-- Heading -->
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#111827;
               line-height:1.3;letter-spacing:-0.4px;">
      Still thinking it over, ${firstName}?
    </h1>
    <p style="margin:0;font-size:15px;color:#374151;line-height:1.6;">
      Your cart is saved, but popular items can sell out quickly.
      Hundreds of customers are shopping right now.
    </p>

    <!-- Social proof pill -->
    <table cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 0;">
      <tr>
        <td style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;
                   padding:12px 16px;">
          <p style="margin:0;font-size:13px;color:#92400e;line-height:1.5;">
            &#128293;&nbsp;
            <strong>${firstItemName}</strong> has been added to wishlists
            by other customers this week.
          </p>
        </td>
      </tr>
    </table>

    <!-- Divider -->
    <div style="height:1px;background:#f3f4f6;margin:24px 0;"></div>

    <!-- Section label -->
    <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#9ca3af;
               letter-spacing:1px;text-transform:uppercase;">
      Your saved cart
    </p>

    ${renderCartSummary(normalisedItems, pricing)}
    ${ctaButton(recoveryUrl, 'Secure my cart now')}
    ${securityNote}

    <!-- Trust badges row -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0"
           style="margin:28px 0 0;border-top:1px solid #f3f4f6;padding-top:22px;">
      <tr>
        <td align="center" width="33%" style="padding:0 4px;text-align:center;">
          <p style="margin:0 0 4px;font-size:18px;">&#128274;</p>
          <p style="margin:0;font-size:11px;color:#6b7280;font-weight:600;">
            Secure checkout
          </p>
        </td>
        <td align="center" width="33%" style="padding:0 4px;text-align:center;">
          <p style="margin:0 0 4px;font-size:18px;">&#x1F69A;</p>
          <p style="margin:0;font-size:11px;color:#6b7280;font-weight:600;">
            Fast shipping
          </p>
        </td>
        <td align="center" width="33%" style="padding:0 4px;text-align:center;">
          <p style="margin:0 0 4px;font-size:18px;">&#x1F4B3;</p>
          <p style="margin:0;font-size:11px;color:#6b7280;font-weight:600;">
            Easy returns
          </p>
        </td>
      </tr>
    </table>`;

  return { subject, preheader, bodyHtml };
};

// ============================================
// VARIANT 3 — DISCOUNT + URGENCY (72 hours)
// Tone: direct, last chance, discount if available
// ============================================

const buildVariant3 = ({ firstName, normalisedItems, pricing, recoveryUrl }) => {
  const hasDiscount   = !!(pricing?.discountCode && pricing?.discountAmount > 0);
  const discountLabel = hasDiscount
    ? `${formatPrice(pricing.discountAmount, pricing?.currency)} off`
    : '10% off your next order';

  const subject   = hasDiscount
    ? `${firstName}, your discount is about to expire`
    : `Last chance, ${firstName} — your cart expires soon`;

  const preheader = hasDiscount
    ? `You have ${discountLabel} waiting in your cart. Don't leave it behind.`
    : `Your saved cart expires in 24 hours. Complete your order today.`;

  // Expiry badge — shown prominently at the top
  const expiryBadge = `
  <table cellpadding="0" cellspacing="0" border="0"
         style="margin:0 0 24px;width:100%;">
    <tr>
      <td style="background:#fff1f2;border:1px solid #fecdd3;border-radius:10px;
                 padding:14px 18px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td>
              <p style="margin:0 0 2px;font-size:13px;font-weight:700;color:#be123c;">
                &#9201;&nbsp; Your cart expires in 24 hours
              </p>
              <p style="margin:0;font-size:12px;color:#e11d48;line-height:1.4;">
                After that, your saved items and ${hasDiscount ? 'discount' : 'prices'} may no longer be available.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;

  // Discount block — only shown when a real discount code exists on pricing
  const discountBlock = hasDiscount ? `
  <table cellpadding="0" cellspacing="0" border="0"
         style="margin:20px 0 0;width:100%;">
    <tr>
      <td style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;
                 padding:16px 18px;text-align:center;">
        <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#15803d;
                   letter-spacing:1px;text-transform:uppercase;">Discount applied</p>
        <p style="margin:0 0 6px;font-size:22px;font-weight:700;color:#166534;">
          ${discountLabel}
        </p>
        <p style="margin:0;font-size:12px;color:#16a34a;">
          Code <strong>${pricing.discountCode}</strong> is already in your cart
        </p>
      </td>
    </tr>
  </table>` : '';

  const bodyHtml = `
    <!-- Heading -->
    <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#111827;
               line-height:1.3;letter-spacing:-0.4px;">
      Last chance to complete your order, ${firstName} &#9203;
    </h1>

    ${expiryBadge}

    <!-- Section label -->
    <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#9ca3af;
               letter-spacing:1px;text-transform:uppercase;">
      Your cart
    </p>

    ${renderCartSummary(normalisedItems, pricing)}
    ${discountBlock}
    ${ctaButton(recoveryUrl, hasDiscount ? `Claim my ${discountLabel}` : 'Complete my order')}
    ${securityNote}

    <!-- Divider -->
    <div style="height:1px;background:#f3f4f6;margin:28px 0 20px;"></div>

    <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6;">
      Need help with your order? Our support team is here.
      <a href="${process.env.FRONTEND_URL || '#'}/contact-us"
         style="color:#ff3c3c;text-decoration:none;font-weight:600;">
        Contact us
      </a>
    </p>`;

  return { subject, preheader, bodyHtml };
};

// ============================================
// PLAIN TEXT FALLBACK
// ============================================

const buildPlainText = ({ firstName, normalisedItems, pricing, recoveryUrl, attemptNumber }) => {
  const currency  = pricing?.currency || 'USD';
  const itemLines = normalisedItems
    .map(item => `- ${item.name} x${item.quantity}  ${formatPrice(item.price * item.quantity, currency)}`)
    .join('\n');

  const total = formatPrice(pricing?.totalPrice || 0, currency);

  const intros = [
    `Hey ${firstName},\n\nYou left some items in your Epic Store cart. Your cart is saved and ready whenever you are.\n`,
    `Hey ${firstName},\n\nStill thinking it over? Your cart is saved, but popular items can sell out. Don't miss out.\n`,
    `Hey ${firstName},\n\nLast chance — your saved cart expires soon. Complete your order before it's gone.\n`,
  ];

  return [
    intros[attemptNumber - 1] || intros[0],
    'YOUR CART',
    '----------',
    itemLines,
    '----------',
    `Total: ${total}`,
    '',
    `Complete your purchase: ${recoveryUrl}`,
    '',
    `Link expires in 72 hours.`,
    '',
    `Questions? Visit ${process.env.FRONTEND_URL || ''}/contact-us`,
    '',
    `Unsubscribe: ${process.env.FRONTEND_URL || ''}/unsubscribe?email=`,
    '',
    `© ${new Date().getFullYear()} Epic Store`,
  ].join('\n');
};

// ============================================
// MAIN EXPORT
// ============================================

/**
 * buildRecoveryEmailHtml
 *
 * Builds the email payload for a recovery send.
 * Called by recoveryEmailService with the populated checkout document
 * and pre-normalised items.
 *
 * @param {Object} checkout         Populated Mongoose checkout document
 * @param {string} recoveryUrl      Full recovery link with JWT token
 * @param {Object} opts
 * @param {Array}  opts.normalisedItems  Items already processed by normaliseItems()
 * @param {number} opts.attemptNumber    1 | 2 | 3
 *
 * @returns {{ subject: string, html: string, text: string }}
 * @throws {Error} if normalisedItems is empty (all products unpublished)
 */
export const buildRecoveryEmailHtml = (checkout, recoveryUrl, { normalisedItems, attemptNumber }) => {
  if (!normalisedItems || normalisedItems.length === 0) {
    throw new Error('Cannot build recovery email: cart has no displayable items');
  }

  const firstName      = checkout.user?.firstName?.trim() || 'there';
  const pricing        = checkout.pricing  || {};
  const unsubscribeUrl = `${process.env.FRONTEND_URL || ''}/unsubscribe?email=${encodeURIComponent(checkout.email)}`;

  const variantBuilders = {
    1: buildVariant1,
    2: buildVariant2,
    3: buildVariant3,
  };

  // Clamp — if recoveryEmailCount somehow exceeds 3, use variant 3
  const variant  = Math.min(Math.max(attemptNumber, 1), 3);
  const builder  = variantBuilders[variant];

  const { subject, preheader, bodyHtml } = builder({
    firstName,
    normalisedItems,
    pricing,
    recoveryUrl,
  });

  const html = wrapInShell({ firstName, preheader, bodyHtml, unsubscribeUrl });

  const text = buildPlainText({
    firstName,
    normalisedItems,
    pricing,
    recoveryUrl,
    attemptNumber: variant,
  });

  return { subject, html, text };
};

export default buildRecoveryEmailHtml;
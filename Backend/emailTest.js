/**
 * testRecoveryEmail.js
 * Run from your backend root: node testRecoveryEmail.js
 */

import dotenv from 'dotenv';
dotenv.config();

import nodemailer from 'nodemailer';
import { buildRecoveryEmailHtml } from './Services/emailTemplates/recoveryEmail.js';

// ── Mock checkout matching the shape your template expects ────────────────────
const mockCheckout = {
  _id: 'test-checkout-id',
  email: 'likitajoel@gmail.com',
  user: {
    firstName: 'Likita',
    lastName:  'Joel',
    email:     'likitajoel@gmail.com',
  },
  items: [
    {
      name:     'Air Jordan 1 Retro High OG',
      price:    189.99,
      quantity: 2,
      image:    null,
    },
    {
      name:     'Nike Dri-FIT T-Shirt',
      price:    45.00,
      quantity: 1,
      image:    null,
    },
    {
      name:     'Adidas Ultraboost 22',
      price:    179.99,
      quantity: 1,
      image:    null,
    },
  ],
  pricing: {
    itemPrice:      604.97,
    shippingPrice:  0,
    taxPrice:       108.89,
    totalPrice:     713.86,
    currency:       'USD',
    discountCode:   null,
    discountAmount: 0,
  },
};

const mockRecoveryUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/checkout/recover?token=test-token-abc123`;

// ── Test all 3 variants ───────────────────────────────────────────────────────
async function runTest() {
  console.log('\n================================================');
  console.log('  RECOVERY EMAIL TEST');
  console.log('================================================');
  console.log(`  SMTP service : ${process.env.SMTP_SERVICE || 'gmail'}`);
  console.log(`  From         : ${process.env.SMTP_MAIL}`);
  console.log(`  To           : likitajoel@gmail.com`);
  console.log(`  FRONTEND_URL : ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
  console.log('================================================\n');

  // ── Validate env before touching nodemailer ─────────────────────────────
  if (!process.env.SMTP_MAIL || !process.env.SMTP_PASSWORD) {
    console.error('❌  SMTP_MAIL or SMTP_PASSWORD is missing from .env — aborting.');
    process.exit(1);
  }

  // ── Create transporter ──────────────────────────────────────────────────
  const transporter = nodemailer.createTransport({
    service: process.env.SMTP_SERVICE || 'gmail',
    auth: {
      user: process.env.SMTP_MAIL,
      pass: process.env.SMTP_PASSWORD,
    },
  });

  // ── Verify SMTP connection first ────────────────────────────────────────
  console.log('🔌  Verifying SMTP connection...');
  try {
    await transporter.verify();
    console.log('✅  SMTP connection verified\n');
  } catch (err) {
    console.error('❌  SMTP connection failed:', err.message);
    console.error('\n    Common fixes:');
    console.error('    - Gmail: use an App Password, not your account password');
    console.error('      → https://myaccount.google.com/apppasswords');
    console.error('    - Gmail: ensure 2FA is enabled on the sending account');
    console.error('    - Check SMTP_SERVICE / SMTP_MAIL / SMTP_PASSWORD in .env\n');
    process.exit(1);
  }

  // ── Send all 3 variants ──────────────────────────────────────────────────
  const variants = [1, 2, 3];

  for (const attempt of variants) {
    console.log(`📧  Sending variant ${attempt}/3...`);

    try {
      const { subject, html, text } = buildRecoveryEmailHtml(
        mockCheckout,
        mockRecoveryUrl,
        {
          normalisedItems: mockCheckout.items,
          attemptNumber:   attempt,
        }
      );

      const info = await transporter.sendMail({
        from:    process.env.SMTP_MAIL,
        to:      'likitajoel@gmail.com',
        subject: `[TEST variant ${attempt}] ${subject}`,
        html,
        text,
      });

      console.log(`✅  Variant ${attempt} sent`);
      console.log(`    MessageId : ${info.messageId}`);
      console.log(`    Accepted  : ${info.accepted?.join(', ') || '—'}`);
      console.log(`    Response  : ${info.response}\n`);

    } catch (err) {
      console.error(`❌  Variant ${attempt} failed: ${err.message}\n`);
    }
  }

  console.log('================================================');
  console.log('  TEST COMPLETE — check likitajoel@gmail.com');
  console.log('================================================\n');
}

runTest().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
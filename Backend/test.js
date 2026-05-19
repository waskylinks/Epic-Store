/**
 * testMetaCapi.js
 *
 * One-shot test for Meta CAPI integration.
 * Run from your backend directory:
 *   node testMetaCapi.js
 *
 * What it tests:
 *   1. Config check — are all env vars present
 *   2. Sends a real Purchase test event to Meta
 *   3. Logs the full response including fbtrace_id
 *
 * Where to verify:
 *   Events Manager → Test Events tab → filter by TEST32895
 */

import 'dotenv/config';
import { sendMetaPurchase, checkMetaConfig } from './Services/analytics/metaCapiService.js';

// ─── 1. CONFIG CHECK ─────────────────────────────────────────────────────────

console.log('\n── Meta CAPI Config ──────────────────────────────');
const config = checkMetaConfig();
console.log(config);

if (!config.configured) {
  console.error('\n❌ Missing env vars:', config.missing);
  process.exit(1);
}

if (!config.testMode) {
  console.warn('\n⚠️  META_TEST_EVENT_CODE not set — this will hit real production data!');
  console.warn('   Set META_TEST_EVENT_CODE in .env before running this script in dev.\n');
}

// ─── 2. MOCK ORDER & USER ────────────────────────────────────────────────────

const mockUser = {
  _id:       { toString: () => '6641abc123def456789abcde' },
  email:     'testuser@epicstore.dev',
  firstName: 'Test',
  lastName:  'User',
};

const mockOrder = {
  _id:          { toString: () => '6641order000000000000001' },
  totalPrice:   59.99,
  paymentInfo: {
    reference: 'PAY-TEST-REF-001',
    currency:  'USD',
  },
  shippingInfo: {
    phoneNo: '+2348012345678',
    city:    'Abuja',
    state:   'FCT',
    country: 'NG',
    pinCode: '900001',
  },
  orderItems: [
    {
      product:  { toString: () => 'prod_abc123' },
      name:     'Test Product',
      price:    29.99,
      quantity: 2,
    },
  ],
  discounts: { codes: [] },
};

const mockContext = {
  eventId:        `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  eventSourceUrl: 'https://epicstore.dev/order/success',
  clientIp:       '105.112.0.1',
  userAgent:      'Mozilla/5.0 (Test Script)',
  fbp:            null,   // no real _fbp cookie in test
  fbc:            null,   // no real fbclid in test
  attribution: {
    confidenceLevel: 'LOW',
    fbclid:          null,
  },
};

// ─── 3. SEND ─────────────────────────────────────────────────────────────────

console.log('\n── Sending Purchase event ────────────────────────');
console.log('   Event ID :', mockContext.eventId);
console.log('   Pixel ID :', process.env.META_PIXEL_ID);
console.log('   Test code:', process.env.META_TEST_EVENT_CODE || '(none)');
console.log('');

try {
  const result = await sendMetaPurchase(mockOrder, mockUser, mockContext);

  console.log('✅ Success');
  console.log('   events_received :', result.eventsReceived);
  console.log('   fbtrace_id      :', result.fbtrace_id);
  console.log('   sentAt          :', result.sentAt);
  console.log('');
  console.log('👉 Now open Events Manager → Test Events tab');
  console.log('   Filter by event code:', process.env.META_TEST_EVENT_CODE);
  console.log('   You should see a "Purchase" event appear within ~30 seconds.');

} catch (err) {
  console.error('\n❌ CAPI call failed');
  console.error('   Message:', err.message);

  if (err.response) {
    console.error('   HTTP status :', err.response.status);
    console.error('   API response:', JSON.stringify(err.response.data, null, 2));
  }

  console.log('\nCommon causes:');
  console.log('  400 — wrong fbc format or invalid payload field');
  console.log('  401 — META_ACCESS_TOKEN is invalid or expired');
  console.log('  403 — token does not have permission for this pixel');
  console.log('  404 — META_PIXEL_ID does not exist or wrong dataset');
}
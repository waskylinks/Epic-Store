/**
 * backend/Services/analytics/tests/ga4Service.test.js
 *
 * Phase 4 — Test Suite for ga4Service.js
 *
 * Run with:
 *   npm run test:ga4service
 *
 * Tests validate:
 *   1. sendGA4Event — payload structure, client_id fallback, debug_mode
 *   2. sendGA4Purchase — order mapping, item array, dedup event_id
 *   3. sendGA4CheckoutStep — step → GA4 event name mapping
 *   4. sendGA4AddToCart — price resolution, value calculation
 *   5. sendGA4Login / sendGA4SignUp — method field
 *   6. sendGA4Refund — transaction_id, refund value
 *   7. checkGA4Config — env variable validation
 *   8. Error handling — missing config, network failure, timeout
 */

import { jest } from '@jest/globals';

// ─── MOCK AXIOS ───────────────────────────────────────────────────────────────
//
// jest.mock() is CJS-only; with NODE_OPTIONS=--experimental-vm-modules we must
// use jest.unstable_mockModule() so the mock is in place before the dynamic
// import of ga4Service.js resolves its own `import axios from 'axios'`.

const mockAxiosPost = jest.fn();

jest.unstable_mockModule('axios', () => ({
  default: { post: mockAxiosPost },
}));

// Dynamic import MUST come after unstable_mockModule so the mock is registered
// before the module under test is evaluated.
const {
  sendGA4Event,
  sendGA4Purchase,
  sendGA4CheckoutStep,
  sendGA4AddToCart,
  sendGA4Login,
  sendGA4SignUp,
  sendGA4Refund,
  checkGA4Config,
} = await import('../ga4Service.js');

// ─── SETUP ────────────────────────────────────────────────────────────────────

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();

  process.env.GA4_MEASUREMENT_ID = 'G-TEST123456';
  process.env.GA4_API_SECRET     = 'test_api_secret';
  process.env.GA4_ENDPOINT       = 'https://www.google-analytics.com/mp/collect';
  process.env.GA4_DEBUG_ENDPOINT = 'https://www.google-analytics.com/debug/mp/collect';
  process.env.NODE_ENV           = 'test'; // triggers debug endpoint

  mockAxiosPost.mockResolvedValue({
    status: 204,
    data:   { validationMessages: [] },
  });
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const buildMockOrder = (overrides = {}) => ({
  _id:        { toString: () => 'order_123' },
  orderItems: [
    {
      product:  { toString: () => 'product_abc' },
      name:     'Blue Sneakers',
      category: 'footwear',
      price:    99.99,
      quantity: 2,
    },
    {
      product:  { toString: () => 'product_def' },
      name:     'Red Cap',
      category: 'accessories',
      price:    24.99,
      quantity: 1,
    },
  ],
  totalPrice:    224.97,
  taxPrice:      36.00,
  shippingPrice: 0,
  paymentInfo: {
    reference: 'PAY_REF_123',
    currency:  'USD',
    method:    'card',
  },
  analytics: {
    isFirstPurchase: true,
    purchaseNumber:  1,
  },
  discounts: null,
  ...overrides,
});

const buildContext = (overrides = {}) => ({
  clientId:  '1234567890.9876543210',
  userId:    'user_123',
  sessionId: 'session_456',
  eventId:   'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  attribution: {
    source:          'google',
    confidenceLevel: 'HIGH',
    isReconstructed: false,
  },
  ...overrides,
});

// ─── sendGA4Event ─────────────────────────────────────────────────────────────

describe('sendGA4Event', () => {
  test('posts to the GA4 endpoint with correct URL params', async () => {
    await sendGA4Event('test_event', { value: 1 }, buildContext());

    expect(mockAxiosPost).toHaveBeenCalledTimes(1);
    const [url] = mockAxiosPost.mock.calls[0];
    expect(url).toContain('measurement_id=G-TEST123456');
    expect(url).toContain('api_secret=test_api_secret');
  });

  test('uses debug endpoint in non-production environment', async () => {
    process.env.NODE_ENV = 'test';
    await sendGA4Event('test_event', {}, buildContext());

    const [url] = mockAxiosPost.mock.calls[0];
    expect(url).toContain('debug/mp/collect');
  });

  test('uses production endpoint in production environment', async () => {
    process.env.NODE_ENV = 'production';
    await sendGA4Event('test_event', {}, buildContext());

    const [url] = mockAxiosPost.mock.calls[0];
    expect(url).toContain('/mp/collect');
    expect(url).not.toContain('debug');
    process.env.NODE_ENV = 'test';
  });

  test('includes client_id in payload', async () => {
    await sendGA4Event('test_event', {}, buildContext({ clientId: 'test_client_id' }));

    const payload = mockAxiosPost.mock.calls[0][1];
    expect(payload.client_id).toBe('test_client_id');
  });

  test('falls back to sessionId when clientId is null', async () => {
    await sendGA4Event('test_event', {}, buildContext({ clientId: null, sessionId: 'sess_123' }));

    const payload = mockAxiosPost.mock.calls[0][1];
    expect(payload.client_id).toBe('sess_123');
  });

  test('includes user_id when provided', async () => {
    await sendGA4Event('test_event', {}, buildContext({ userId: 'user_456' }));

    const payload = mockAxiosPost.mock.calls[0][1];
    expect(payload.user_id).toBe('user_456');
  });

  test('omits user_id when not provided', async () => {
    await sendGA4Event('test_event', {}, buildContext({ userId: null }));

    const payload = mockAxiosPost.mock.calls[0][1];
    expect(payload.user_id).toBeUndefined();
  });

  test('includes event_id in event params for deduplication', async () => {
    const eventId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    await sendGA4Event('test_event', {}, buildContext({ eventId }));

    const payload = mockAxiosPost.mock.calls[0][1];
    expect(payload.events[0].params.event_id).toBe(eventId);
  });

  test('adds debug_mode in non-production', async () => {
    process.env.NODE_ENV = 'test';
    await sendGA4Event('test_event', {}, buildContext());

    const payload = mockAxiosPost.mock.calls[0][1];
    expect(payload.events[0].params.debug_mode).toBe(1);
  });

  test('does NOT add debug_mode in production', async () => {
    process.env.NODE_ENV = 'production';
    await sendGA4Event('test_event', {}, buildContext());

    const payload = mockAxiosPost.mock.calls[0][1];
    expect(payload.events[0].params.debug_mode).toBeUndefined();
    process.env.NODE_ENV = 'test';
  });

  test('includes engagement_time_msec in event params', async () => {
    await sendGA4Event('test_event', {}, buildContext());

    const payload = mockAxiosPost.mock.calls[0][1];
    expect(payload.events[0].params.engagement_time_msec).toBe(1);
  });

  test('sets axios timeout to 5000ms', async () => {
    await sendGA4Event('test_event', {}, buildContext());

    const options = mockAxiosPost.mock.calls[0][2];
    expect(options.timeout).toBe(5000);
  });

  test('returns success result with required fields', async () => {
    const result = await sendGA4Event('test_event', {}, buildContext());

    expect(result.success).toBe(true);
    expect(result.eventName).toBe('test_event');
    expect(result.sentAt).toBeTruthy();
    expect(new Date(result.sentAt).getTime()).toBeGreaterThan(0);
  });

  test('throws when GA4_MEASUREMENT_ID is missing', async () => {
    delete process.env.GA4_MEASUREMENT_ID;

    await expect(
      sendGA4Event('test_event', {}, buildContext())
    ).rejects.toThrow('GA4_MEASUREMENT_ID');

    process.env.GA4_MEASUREMENT_ID = 'G-TEST123456';
  });

  test('throws when GA4_API_SECRET is missing', async () => {
    delete process.env.GA4_API_SECRET;

    await expect(
      sendGA4Event('test_event', {}, buildContext())
    ).rejects.toThrow('GA4_API_SECRET');

    process.env.GA4_API_SECRET = 'test_api_secret';
  });

  test('throws on network failure', async () => {
    mockAxiosPost.mockRejectedValue(new Error('Network Error'));

    await expect(
      sendGA4Event('test_event', {}, buildContext())
    ).rejects.toThrow('Network Error');
  });

  test('throws on axios timeout', async () => {
    mockAxiosPost.mockRejectedValue(new Error('timeout of 5000ms exceeded'));

    await expect(
      sendGA4Event('test_event', {}, buildContext())
    ).rejects.toThrow('timeout');
  });
});

// ─── sendGA4Purchase ──────────────────────────────────────────────────────────

describe('sendGA4Purchase', () => {
  test('sends a "purchase" event', async () => {
    await sendGA4Purchase(buildMockOrder(), buildContext());

    const payload = mockAxiosPost.mock.calls[0][1];
    expect(payload.events[0].name).toBe('purchase');
  });

  test('sets transaction_id from paymentInfo.reference', async () => {
    await sendGA4Purchase(buildMockOrder(), buildContext());

    const params = mockAxiosPost.mock.calls[0][1].events[0].params;
    expect(params.transaction_id).toBe('PAY_REF_123');
  });

  test('sets correct revenue value', async () => {
    await sendGA4Purchase(buildMockOrder(), buildContext());

    const params = mockAxiosPost.mock.calls[0][1].events[0].params;
    expect(params.value).toBe(224.97);
  });

  test('sets currency from paymentInfo', async () => {
    await sendGA4Purchase(buildMockOrder(), buildContext());

    const params = mockAxiosPost.mock.calls[0][1].events[0].params;
    expect(params.currency).toBe('USD');
  });

  test('maps all order items to GA4 items array', async () => {
    await sendGA4Purchase(buildMockOrder(), buildContext());

    const params = mockAxiosPost.mock.calls[0][1].events[0].params;
    expect(params.items).toHaveLength(2);
    expect(params.items[0].item_id).toBe('product_abc');
    expect(params.items[0].item_name).toBe('Blue Sneakers');
    expect(params.items[0].price).toBe(99.99);
    expect(params.items[0].quantity).toBe(2);
    expect(params.items[1].item_id).toBe('product_def');
  });

  test('includes item_category on each item', async () => {
    await sendGA4Purchase(buildMockOrder(), buildContext());

    const items = mockAxiosPost.mock.calls[0][1].events[0].params.items;
    expect(items[0].item_category).toBe('footwear');
    expect(items[1].item_category).toBe('accessories');
  });

  test('includes coupon when discount code applied', async () => {
    const order = buildMockOrder({
      discounts: { codes: [{ code: 'SUMMER20' }] },
    });
    await sendGA4Purchase(order, buildContext());

    const params = mockAxiosPost.mock.calls[0][1].events[0].params;
    expect(params.coupon).toBe('SUMMER20');
  });

  test('omits coupon when no discount applied', async () => {
    await sendGA4Purchase(buildMockOrder({ discounts: null }), buildContext());

    const params = mockAxiosPost.mock.calls[0][1].events[0].params;
    expect(params.coupon).toBeUndefined();
  });

  test('includes attribution_confidence custom dimension', async () => {
    const ctx = buildContext({ attribution: { confidenceLevel: 'HIGH', isReconstructed: false, source: 'google' } });
    await sendGA4Purchase(buildMockOrder(), ctx);

    const params = mockAxiosPost.mock.calls[0][1].events[0].params;
    expect(params.attribution_confidence).toBe('HIGH');
    expect(params.attribution_reconstructed).toBe(false);
  });

  test('uses event_id from context for deduplication', async () => {
    const eventId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    await sendGA4Purchase(buildMockOrder(), buildContext({ eventId }));

    const params = mockAxiosPost.mock.calls[0][1].events[0].params;
    expect(params.event_id).toBe(eventId);
  });

  test('handles order with empty orderItems gracefully', async () => {
    const order = buildMockOrder({ orderItems: [] });
    await expect(sendGA4Purchase(order, buildContext())).resolves.not.toThrow();

    const params = mockAxiosPost.mock.calls[0][1].events[0].params;
    expect(params.items).toHaveLength(0);
  });
});

// ─── sendGA4CheckoutStep ──────────────────────────────────────────────────────

describe('sendGA4CheckoutStep', () => {
  const mockCheckout = {
    _id:   { toString: () => 'checkout_123' },
    items: [{ product: { toString: () => 'p1' }, price: 50, quantity: 1 }],
    pricing: { currency: 'USD', totalPrice: 50 },
    discount: null,
  };

  test('maps shipping_info step to begin_checkout event', async () => {
    await sendGA4CheckoutStep('shipping_info', mockCheckout, buildContext());

    const payload = mockAxiosPost.mock.calls[0][1];
    expect(payload.events[0].name).toBe('begin_checkout');
  });

  test('maps payment_selection step to add_payment_info event', async () => {
    await sendGA4CheckoutStep('payment_selection', mockCheckout, buildContext());

    const payload = mockAxiosPost.mock.calls[0][1];
    expect(payload.events[0].name).toBe('add_payment_info');
  });

  test('uses checkout_step for unmapped steps', async () => {
    await sendGA4CheckoutStep('order_review', mockCheckout, buildContext());

    const payload = mockAxiosPost.mock.calls[0][1];
    expect(payload.events[0].name).toBe('checkout_step');
  });

  test('includes checkout_step param for custom step tracking', async () => {
    await sendGA4CheckoutStep('order_review', mockCheckout, buildContext());

    const params = mockAxiosPost.mock.calls[0][1].events[0].params;
    expect(params.checkout_step).toBe('order_review');
  });

  test('includes currency and value from checkout pricing', async () => {
    await sendGA4CheckoutStep('shipping_info', mockCheckout, buildContext());

    const params = mockAxiosPost.mock.calls[0][1].events[0].params;
    expect(params.currency).toBe('USD');
    expect(params.value).toBe(50);
  });
});

// ─── sendGA4AddToCart ─────────────────────────────────────────────────────────

describe('sendGA4AddToCart', () => {
  const mockProduct = {
    _id:      { toString: () => 'product_123' },
    name:     'Test Product',
    category: 'test-category',
    pricing:  { sale: 79.99, regular: 99.99 },
  };

  test('sends add_to_cart event', async () => {
    await sendGA4AddToCart(mockProduct, 2, buildContext());

    const payload = mockAxiosPost.mock.calls[0][1];
    expect(payload.events[0].name).toBe('add_to_cart');
  });

  test('uses sale price when available', async () => {
    await sendGA4AddToCart(mockProduct, 1, buildContext());

    const params = mockAxiosPost.mock.calls[0][1].events[0].params;
    expect(params.items[0].price).toBe(79.99);
  });

  test('calculates correct value (price × quantity)', async () => {
    await sendGA4AddToCart(mockProduct, 3, buildContext());

    const params = mockAxiosPost.mock.calls[0][1].events[0].params;
    expect(params.value).toBeCloseTo(79.99 * 3, 2);
  });

  test('falls back to regular price when no sale price', async () => {
    const product = { ...mockProduct, pricing: { regular: 99.99 } };
    await sendGA4AddToCart(product, 1, buildContext());

    const params = mockAxiosPost.mock.calls[0][1].events[0].params;
    expect(params.items[0].price).toBe(99.99);
  });
});

// ─── sendGA4Login / sendGA4SignUp ─────────────────────────────────────────────

describe('sendGA4Login', () => {
  test('sends login event with method', async () => {
    await sendGA4Login('google', buildContext());

    const payload = mockAxiosPost.mock.calls[0][1];
    expect(payload.events[0].name).toBe('login');
    expect(payload.events[0].params.method).toBe('google');
  });

  test('defaults method to email', async () => {
    await sendGA4Login(undefined, buildContext());

    const params = mockAxiosPost.mock.calls[0][1].events[0].params;
    expect(params.method).toBe('email');
  });
});

describe('sendGA4SignUp', () => {
  test('sends sign_up event with method', async () => {
    await sendGA4SignUp('facebook', buildContext());

    const payload = mockAxiosPost.mock.calls[0][1];
    expect(payload.events[0].name).toBe('sign_up');
    expect(payload.events[0].params.method).toBe('facebook');
  });
});

// ─── sendGA4Refund ────────────────────────────────────────────────────────────

describe('sendGA4Refund', () => {
  test('sends refund event', async () => {
    await sendGA4Refund(buildMockOrder(), 99.99, buildContext());

    const payload = mockAxiosPost.mock.calls[0][1];
    expect(payload.events[0].name).toBe('refund');
  });

  test('sets correct refund value', async () => {
    await sendGA4Refund(buildMockOrder(), 49.99, buildContext());

    const params = mockAxiosPost.mock.calls[0][1].events[0].params;
    expect(params.value).toBe(49.99);
  });

  test('sets transaction_id matching original order', async () => {
    await sendGA4Refund(buildMockOrder(), 99.99, buildContext());

    const params = mockAxiosPost.mock.calls[0][1].events[0].params;
    expect(params.transaction_id).toBe('PAY_REF_123');
  });
});

// ─── checkGA4Config ───────────────────────────────────────────────────────────

describe('checkGA4Config', () => {
  test('returns configured: true when all env vars are set', () => {
    const result = checkGA4Config();
    expect(result.configured).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  test('returns configured: false when GA4_MEASUREMENT_ID is missing', () => {
    delete process.env.GA4_MEASUREMENT_ID;
    const result = checkGA4Config();
    expect(result.configured).toBe(false);
    expect(result.missing).toContain('GA4_MEASUREMENT_ID');
    process.env.GA4_MEASUREMENT_ID = 'G-TEST123456';
  });

  test('returns configured: false when GA4_API_SECRET is missing', () => {
    delete process.env.GA4_API_SECRET;
    const result = checkGA4Config();
    expect(result.configured).toBe(false);
    expect(result.missing).toContain('GA4_API_SECRET');
    process.env.GA4_API_SECRET = 'test_api_secret';
  });

  test('includes endpoint URL in result', () => {
    const result = checkGA4Config();
    expect(result.endpoint).toBeTruthy();
    expect(result.endpoint).toContain('google-analytics.com');
  });

  test('sets debug: true in non-production', () => {
    process.env.NODE_ENV = 'test';
    const result = checkGA4Config();
    expect(result.debug).toBe(true);
  });

  test('sets debug: false in production', () => {
    process.env.NODE_ENV = 'production';
    const result = checkGA4Config();
    expect(result.debug).toBe(false);
    process.env.NODE_ENV = 'test';
  });
});
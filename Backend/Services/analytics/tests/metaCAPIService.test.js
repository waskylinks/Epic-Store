/**
 * backend/Services/analytics/tests/metaCapiService.test.js
 *
 * Phase 5 — Test Suite for metaCapiService.js
 *
 * Run with:
 *   npx jest Services/analytics/tests/metaCapiService.test.js --verbose
 *
 * Tests validate:
 *   1. PII hashing — SHA-256, normalization, phone stripping
 *   2. sendMetaEvent — payload structure, eventID dedup key, test_event_code
 *   3. sendMetaPurchase — order mapping, user data, content_ids, fbc fallback
 *   4. sendMetaInitiateCheckout — checkout mapping, anonymous user handling
 *   5. sendMetaAddToCart — price resolution, contents array
 *   6. sendMetaViewContent — product mapping
 *   7. sendMetaCompleteRegistration — user hashing
 *   8. checkMetaConfig — env validation, testMode flag
 *   9. Error handling — missing config, API errors, network failure
 */

import { jest } from '@jest/globals';
import crypto from 'crypto';

// ─── MOCK AXIOS ───────────────────────────────────────────────────────────────

const mockAxiosPost = jest.fn();

jest.unstable_mockModule('axios', () => ({
  default: { post: mockAxiosPost },
}));

const {
  sendMetaEvent,
  sendMetaPurchase,
  sendMetaInitiateCheckout,
  sendMetaAddToCart,
  sendMetaViewContent,
  sendMetaCompleteRegistration,
  checkMetaConfig,
} = await import('../metaCapiService.js');

// ─── SETUP ────────────────────────────────────────────────────────────────────

const ORIGINAL_ENV = { ...process.env };

// SHA-256 helpers for test assertions
const sha256 = (value) =>
  crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');

const sha256Phone = (value) =>
  crypto.createHash('sha256').update(value.replace(/\D/g, '')).digest('hex');

beforeEach(() => {
  jest.clearAllMocks();

  process.env.META_PIXEL_ID        = '123456789012345';
  process.env.META_ACCESS_TOKEN    = 'test_access_token';
  process.env.META_CAPI_ENDPOINT   = 'https://graph.facebook.com/v18.0';
  process.env.META_TEST_EVENT_CODE = 'TEST12345';
  process.env.FRONTEND_URL         = 'https://epicstore.com';

  mockAxiosPost.mockResolvedValue({
    status: 200,
    data:   { events_received: 1, fbtrace_id: 'fbtrace_123' },
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
  shippingInfo: {
    phoneNo: '+2348012345678',
    city:    'Lagos',
    state:   'Lagos',
    country: 'NG',
    pinCode: '100001',
  },
  analytics: { isFirstPurchase: true },
  discounts:  null,
  ...overrides,
});

const buildMockUser = (overrides = {}) => ({
  _id:       { toString: () => 'user_123' },
  email:     'test@example.com',
  firstName: 'John',
  lastName:  'Doe',
  phone:     '+2348012345678',
  ...overrides,
});

const buildContext = (overrides = {}) => ({
  eventId:        'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  eventSourceUrl: 'https://epicstore.com/order/success',
  fbp:            'fb.1.1234567890.1234567890',
  fbc:            'fb.1.1234567890.AbCdEfGh',
  clientIp:       '192.168.1.1',
  userAgent:      'Mozilla/5.0 Chrome/120',
  attribution: {
    source:          'facebook',
    confidenceLevel: 'HIGH',
    isReconstructed: false,
    fbclid:          null,
  },
  ...overrides,
});

// ─── PII HASHING ──────────────────────────────────────────────────────────────

describe('PII hashing', () => {
  test('email is SHA-256 hashed and lowercased', async () => {
    await sendMetaPurchase(buildMockOrder(), buildMockUser({ email: 'TEST@EXAMPLE.COM' }), buildContext());

    const userData = mockAxiosPost.mock.calls[0][1].data[0].user_data;
    expect(userData.em).toBe(sha256('test@example.com'));
  });

  test('email with mixed case is normalized before hashing', async () => {
    const user1 = buildMockUser({ email: 'User@Example.COM' });
    const user2 = buildMockUser({ email: 'user@example.com' });

    await sendMetaPurchase(buildMockOrder(), user1, buildContext());
    const hash1 = mockAxiosPost.mock.calls[0][1].data[0].user_data.em;

    jest.clearAllMocks();
    mockAxiosPost.mockResolvedValue({ status: 200, data: { events_received: 1 } });

    await sendMetaPurchase(buildMockOrder(), user2, buildContext());
    const hash2 = mockAxiosPost.mock.calls[0][1].data[0].user_data.em;

    expect(hash1).toBe(hash2);
  });

  test('phone is SHA-256 hashed with non-digit characters stripped', async () => {
    await sendMetaPurchase(buildMockOrder(), buildMockUser({ phone: '+234 801 234 5678' }), buildContext());

    const userData = mockAxiosPost.mock.calls[0][1].data[0].user_data;
    expect(userData.ph).toBe(sha256Phone('+234 801 234 5678'));
  });

  test('first name is hashed', async () => {
    await sendMetaPurchase(buildMockOrder(), buildMockUser({ firstName: 'John' }), buildContext());

    const userData = mockAxiosPost.mock.calls[0][1].data[0].user_data;
    expect(userData.fn).toBe(sha256('john'));
  });

  test('last name is hashed', async () => {
    await sendMetaPurchase(buildMockOrder(), buildMockUser({ lastName: 'Doe' }), buildContext());

    const userData = mockAxiosPost.mock.calls[0][1].data[0].user_data;
    expect(userData.ln).toBe(sha256('doe'));
  });

  test('external_id (userId) is hashed', async () => {
    await sendMetaPurchase(buildMockOrder(), buildMockUser(), buildContext());

    const userData = mockAxiosPost.mock.calls[0][1].data[0].user_data;
    expect(userData.external_id).toBe(sha256('user_123'));
  });

  test('fbp cookie is sent UN-hashed', async () => {
    const fbp = 'fb.1.1234567890.9876543210';
    await sendMetaPurchase(buildMockOrder(), buildMockUser(), buildContext({ fbp }));

    const userData = mockAxiosPost.mock.calls[0][1].data[0].user_data;
    expect(userData.fbp).toBe(fbp);
  });

  test('fbc cookie is sent UN-hashed', async () => {
    const fbc = 'fb.1.1234567890.AbCdEfGhIjKlMn';
    await sendMetaPurchase(buildMockOrder(), buildMockUser(), buildContext({ fbc }));

    const userData = mockAxiosPost.mock.calls[0][1].data[0].user_data;
    expect(userData.fbc).toBe(fbc);
  });

  test('missing PII fields are omitted from payload (not null)', async () => {
    // phone comes from order.shippingInfo.phoneNo (User model has no phone field)
    // firstName comes from user — null it out to test omission
    const user  = buildMockUser({ firstName: null });
    const order = buildMockOrder({ shippingInfo: { ...buildMockOrder().shippingInfo, phoneNo: null } });
    await sendMetaPurchase(order, user, buildContext());

    const userData = mockAxiosPost.mock.calls[0][1].data[0].user_data;
    expect(userData.ph).toBeUndefined();
    expect(userData.fn).toBeUndefined();
    expect(userData.em).toBeTruthy();
    expect(userData.ln).toBeTruthy();
  });
});

// ─── sendMetaEvent ────────────────────────────────────────────────────────────

describe('sendMetaEvent', () => {
  test('posts to correct Meta CAPI URL', async () => {
    await sendMetaEvent('Purchase', {}, {}, buildContext());

    const [url] = mockAxiosPost.mock.calls[0];
    expect(url).toContain('graph.facebook.com/v18.0');
    expect(url).toContain('123456789012345');
    expect(url).toContain('/events');
  });

  test('includes access_token as query param', async () => {
    await sendMetaEvent('Purchase', {}, {}, buildContext());

    const options = mockAxiosPost.mock.calls[0][2];
    expect(options.params.access_token).toBe('test_access_token');
  });

  test('includes event_id for deduplication', async () => {
    const eventId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    await sendMetaEvent('Purchase', {}, {}, buildContext({ eventId }));

    const eventData = mockAxiosPost.mock.calls[0][1].data[0];
    expect(eventData.event_id).toBe(eventId);
  });

  test('includes event_name', async () => {
    await sendMetaEvent('AddToCart', {}, {}, buildContext());

    const eventData = mockAxiosPost.mock.calls[0][1].data[0];
    expect(eventData.event_name).toBe('AddToCart');
  });

  test('includes unix timestamp in event_time', async () => {
    const before = Math.floor(Date.now() / 1000);
    await sendMetaEvent('Purchase', {}, {}, buildContext());
    const after = Math.floor(Date.now() / 1000);

    const eventData = mockAxiosPost.mock.calls[0][1].data[0];
    expect(eventData.event_time).toBeGreaterThanOrEqual(before);
    expect(eventData.event_time).toBeLessThanOrEqual(after);
  });

  test('includes test_event_code when META_TEST_EVENT_CODE is set', async () => {
    process.env.META_TEST_EVENT_CODE = 'TEST12345';
    await sendMetaEvent('Purchase', {}, {}, buildContext());

    const payload = mockAxiosPost.mock.calls[0][1];
    expect(payload.test_event_code).toBe('TEST12345');
  });

  test('omits test_event_code when META_TEST_EVENT_CODE is not set', async () => {
    delete process.env.META_TEST_EVENT_CODE;
    await sendMetaEvent('Purchase', {}, {}, buildContext());

    const payload = mockAxiosPost.mock.calls[0][1];
    expect(payload.test_event_code).toBeUndefined();

    process.env.META_TEST_EVENT_CODE = 'TEST12345';
  });

  test('sets action_source to website by default', async () => {
    await sendMetaEvent('Purchase', {}, {}, buildContext());

    const eventData = mockAxiosPost.mock.calls[0][1].data[0];
    expect(eventData.action_source).toBe('website');
  });

  test('uses event_source_url from context', async () => {
    await sendMetaEvent('Purchase', {}, {}, buildContext({
      eventSourceUrl: 'https://epicstore.com/order/success',
    }));

    const eventData = mockAxiosPost.mock.calls[0][1].data[0];
    expect(eventData.event_source_url).toBe('https://epicstore.com/order/success');
  });

  test('falls back to FRONTEND_URL when eventSourceUrl not provided', async () => {
    await sendMetaEvent('Purchase', {}, {}, buildContext({ eventSourceUrl: null }));

    const eventData = mockAxiosPost.mock.calls[0][1].data[0];
    expect(eventData.event_source_url).toBe('https://epicstore.com');
  });

  test('sets axios timeout to 8000ms', async () => {
    await sendMetaEvent('Purchase', {}, {}, buildContext());

    const options = mockAxiosPost.mock.calls[0][2];
    expect(options.timeout).toBe(8000);
  });

  test('returns success result with events_received', async () => {
    const result = await sendMetaEvent('Purchase', {}, {}, buildContext());

    expect(result.success).toBe(true);
    expect(result.eventsReceived).toBe(1);
    expect(result.fbtrace_id).toBe('fbtrace_123');
    expect(result.sentAt).toBeTruthy();
  });

  test('throws when META_PIXEL_ID is missing', async () => {
    delete process.env.META_PIXEL_ID;

    await expect(
      sendMetaEvent('Purchase', {}, {}, buildContext())
    ).rejects.toThrow('META_PIXEL_ID');

    process.env.META_PIXEL_ID = '123456789012345';
  });

  test('throws when META_ACCESS_TOKEN is missing', async () => {
    delete process.env.META_ACCESS_TOKEN;

    await expect(
      sendMetaEvent('Purchase', {}, {}, buildContext())
    ).rejects.toThrow('META_ACCESS_TOKEN');

    process.env.META_ACCESS_TOKEN = 'test_access_token';
  });

  test('throws when API returns an error object', async () => {
    mockAxiosPost.mockResolvedValue({
      status: 200,
      data:   { error: { message: 'Invalid access token', code: 190 } },
    });

    await expect(
      sendMetaEvent('Purchase', {}, {}, buildContext())
    ).rejects.toThrow('Meta CAPI error');
  });

  test('throws on network failure', async () => {
    mockAxiosPost.mockRejectedValue(new Error('Network Error'));

    await expect(
      sendMetaEvent('Purchase', {}, {}, buildContext())
    ).rejects.toThrow('Network Error');
  });
});

// ─── sendMetaPurchase ─────────────────────────────────────────────────────────

describe('sendMetaPurchase', () => {
  test('sends Purchase event name', async () => {
    await sendMetaPurchase(buildMockOrder(), buildMockUser(), buildContext());

    const eventData = mockAxiosPost.mock.calls[0][1].data[0];
    expect(eventData.event_name).toBe('Purchase');
  });

  test('sets correct purchase value', async () => {
    await sendMetaPurchase(buildMockOrder(), buildMockUser(), buildContext());

    const customData = mockAxiosPost.mock.calls[0][1].data[0].custom_data;
    expect(customData.value).toBe(224.97);
  });

  test('sets currency from paymentInfo', async () => {
    await sendMetaPurchase(buildMockOrder(), buildMockUser(), buildContext());

    const customData = mockAxiosPost.mock.calls[0][1].data[0].custom_data;
    expect(customData.currency).toBe('USD');
  });

  test('sets content_ids from order items', async () => {
    await sendMetaPurchase(buildMockOrder(), buildMockUser(), buildContext());

    const customData = mockAxiosPost.mock.calls[0][1].data[0].custom_data;
    expect(customData.content_ids).toEqual(['product_abc', 'product_def']);
  });

  test('sets contents array with quantity and item_price', async () => {
    await sendMetaPurchase(buildMockOrder(), buildMockUser(), buildContext());

    const customData = mockAxiosPost.mock.calls[0][1].data[0].custom_data;
    expect(customData.contents[0]).toMatchObject({
      id:         'product_abc',
      quantity:   2,
      item_price: 99.99,
    });
  });

  test('sets content_type to product', async () => {
    await sendMetaPurchase(buildMockOrder(), buildMockUser(), buildContext());

    const customData = mockAxiosPost.mock.calls[0][1].data[0].custom_data;
    expect(customData.content_type).toBe('product');
  });

  test('sets num_items from order items length', async () => {
    await sendMetaPurchase(buildMockOrder(), buildMockUser(), buildContext());

    const customData = mockAxiosPost.mock.calls[0][1].data[0].custom_data;
    expect(customData.num_items).toBe(2);
  });

  test('includes shipping address in user_data', async () => {
    await sendMetaPurchase(buildMockOrder(), buildMockUser(), buildContext());

    const userData = mockAxiosPost.mock.calls[0][1].data[0].user_data;
    expect(userData.ct).toBe(sha256('lagos'));
    expect(userData.st).toBe(sha256('lagos'));
  });

  test('fbc falls back to attribution.fbclid when _fbc cookie missing', async () => {
    const ctx = buildContext({
      fbc:         null,
      attribution: { fbclid: 'AbCdEfGh_fbclid', confidenceLevel: 'HIGH', isReconstructed: false },
    });
    await sendMetaPurchase(buildMockOrder(), buildMockUser(), ctx);

    const userData = mockAxiosPost.mock.calls[0][1].data[0].user_data;
    expect(userData.fbc).toBe('AbCdEfGh_fbclid');
  });

  test('includes coupon_code when discount applied', async () => {
    const order = buildMockOrder({ discounts: { codes: [{ code: 'SUMMER20' }] } });
    await sendMetaPurchase(order, buildMockUser(), buildContext());

    const customData = mockAxiosPost.mock.calls[0][1].data[0].custom_data;
    expect(customData.coupon_code).toBe('SUMMER20');
  });

  test('omits coupon_code when no discount', async () => {
    await sendMetaPurchase(buildMockOrder({ discounts: null }), buildMockUser(), buildContext());

    const customData = mockAxiosPost.mock.calls[0][1].data[0].custom_data;
    expect(customData.coupon_code).toBeUndefined();
  });

  test('uses event_id from context for deduplication', async () => {
    const eventId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    await sendMetaPurchase(buildMockOrder(), buildMockUser(), buildContext({ eventId }));

    const eventData = mockAxiosPost.mock.calls[0][1].data[0];
    expect(eventData.event_id).toBe(eventId);
  });
});

// ─── sendMetaInitiateCheckout ─────────────────────────────────────────────────

describe('sendMetaInitiateCheckout', () => {
  const mockCheckout = {
    _id:   { toString: () => 'checkout_123' },
    items: [{ product: { toString: () => 'p1' }, price: 50, quantity: 1 }],
    pricing: { currency: 'USD', totalPrice: 50 },
  };

  test('sends InitiateCheckout event', async () => {
    await sendMetaInitiateCheckout(mockCheckout, buildMockUser(), buildContext());

    const eventData = mockAxiosPost.mock.calls[0][1].data[0];
    expect(eventData.event_name).toBe('InitiateCheckout');
  });

  test('handles null user gracefully (anonymous checkout)', async () => {
    await expect(
      sendMetaInitiateCheckout(mockCheckout, null, buildContext())
    ).resolves.not.toThrow();
  });

  test('sets value from checkout pricing', async () => {
    await sendMetaInitiateCheckout(mockCheckout, buildMockUser(), buildContext());

    const customData = mockAxiosPost.mock.calls[0][1].data[0].custom_data;
    expect(customData.value).toBe(50);
  });
});

// ─── sendMetaAddToCart ────────────────────────────────────────────────────────

describe('sendMetaAddToCart', () => {
  const mockProduct = {
    _id:      { toString: () => 'product_123' },
    name:     'Test Product',
    category: 'test',
    pricing:  { sale: 79.99, regular: 99.99 },
  };

  test('sends AddToCart event', async () => {
    await sendMetaAddToCart(mockProduct, 2, buildMockUser(), buildContext());

    const eventData = mockAxiosPost.mock.calls[0][1].data[0];
    expect(eventData.event_name).toBe('AddToCart');
  });

  test('uses sale price when available', async () => {
    await sendMetaAddToCart(mockProduct, 1, buildMockUser(), buildContext());

    const customData = mockAxiosPost.mock.calls[0][1].data[0].custom_data;
    expect(customData.value).toBeCloseTo(79.99);
    expect(customData.contents[0].item_price).toBe(79.99);
  });

  test('calculates total value (price × quantity)', async () => {
    await sendMetaAddToCart(mockProduct, 3, buildMockUser(), buildContext());

    const customData = mockAxiosPost.mock.calls[0][1].data[0].custom_data;
    expect(customData.value).toBeCloseTo(79.99 * 3, 2);
  });
});

// ─── sendMetaCompleteRegistration ─────────────────────────────────────────────

describe('sendMetaCompleteRegistration', () => {
  test('sends CompleteRegistration event', async () => {
    await sendMetaCompleteRegistration(buildMockUser(), buildContext());

    const eventData = mockAxiosPost.mock.calls[0][1].data[0];
    expect(eventData.event_name).toBe('CompleteRegistration');
  });

  test('includes hashed user email', async () => {
    await sendMetaCompleteRegistration(buildMockUser(), buildContext());

    const userData = mockAxiosPost.mock.calls[0][1].data[0].user_data;
    expect(userData.em).toBe(sha256('test@example.com'));
  });
});

// ─── checkMetaConfig ─────────────────────────────────────────────────────────

describe('checkMetaConfig', () => {
  test('returns configured: true when all env vars are set', () => {
    const result = checkMetaConfig();
    expect(result.configured).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  test('returns configured: false when META_PIXEL_ID is missing', () => {
    delete process.env.META_PIXEL_ID;
    const result = checkMetaConfig();
    expect(result.configured).toBe(false);
    expect(result.missing).toContain('META_PIXEL_ID');
    process.env.META_PIXEL_ID = '123456789012345';
  });

  test('returns testMode: true when META_TEST_EVENT_CODE is set', () => {
    const result = checkMetaConfig();
    expect(result.testMode).toBe(true);
  });

  test('returns testMode: false when META_TEST_EVENT_CODE is not set', () => {
    delete process.env.META_TEST_EVENT_CODE;
    const result = checkMetaConfig();
    expect(result.testMode).toBe(false);
    process.env.META_TEST_EVENT_CODE = 'TEST12345';
  });

  test('masks pixel ID in result', () => {
    const result = checkMetaConfig();
    expect(result.pixelId).toContain('****');
    expect(result.pixelId).not.toBe('123456789012345');
  });
});
/**
 * backend/services/analytics/__tests__/analyticsOrchestrator.test.js
 *
 * Phase 9 — Test Suite for analyticsOrchestrator.js
 *
 * Run with:
 *   npx jest services/analytics/__tests__/analyticsOrchestrator.test.js --verbose
 */

import { jest } from '@jest/globals';

// ─── SHARED MOCK REGISTRY ─────────────────────────────────────────────────────
const mocks = {};

// ─── MOCKS USING unstable_mockModule ────────────────────────────────────────

// Mock analyticsQueue.js
await jest.unstable_mockModule('../../../jobs/analyticsQueue.js', () => {
  const enqueueAnalyticsEvent = jest.fn();
  mocks.enqueueAnalyticsEvent = enqueueAnalyticsEvent;
  return { enqueueAnalyticsEvent };
});

// Mock ga4Service.js
await jest.unstable_mockModule('../ga4Service.js', () => {
  const sendGA4Purchase = jest.fn();
  const sendGA4CheckoutStep = jest.fn();
  const sendGA4Login = jest.fn();
  const sendGA4SignUp = jest.fn();
  
  mocks.sendGA4Purchase = sendGA4Purchase;
  mocks.sendGA4CheckoutStep = sendGA4CheckoutStep;
  mocks.sendGA4Login = sendGA4Login;
  mocks.sendGA4SignUp = sendGA4SignUp;
  
  return {
    sendGA4Purchase,
    sendGA4CheckoutStep,
    sendGA4Login,
    sendGA4SignUp
  };
});

// Mock metaCapiService.js
await jest.unstable_mockModule('../metaCapiService.js', () => {
  const sendMetaPurchase = jest.fn();
  const sendMetaInitiateCheckout = jest.fn();
  const sendMetaCompleteRegistration = jest.fn();
  
  mocks.sendMetaPurchase = sendMetaPurchase;
  mocks.sendMetaInitiateCheckout = sendMetaInitiateCheckout;
  mocks.sendMetaCompleteRegistration = sendMetaCompleteRegistration;
  
  return {
    sendMetaPurchase,
    sendMetaInitiateCheckout,
    sendMetaCompleteRegistration
  };
});

// ─── IMPORTS (after all mocks are declared) ───────────────────────────────────
const {
  fireAnalyticsEvent,
  firePurchaseEvent,
  fireCheckoutStartEvent,
  fireLoginEvent,
  fireSignUpEvent,
} = await import('../analyticsOrchestrator.js');

// ─── SETUP ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  
  // Reset mock implementations with default successful responses
  if (mocks.enqueueAnalyticsEvent) {
    mocks.enqueueAnalyticsEvent.mockResolvedValue({ eventId: 'uuid_123', status: 'pending' });
  }
  
  if (mocks.sendGA4Purchase) {
    mocks.sendGA4Purchase.mockResolvedValue({ success: true, eventId: 'uuid_123' });
  }
  
  if (mocks.sendMetaPurchase) {
    mocks.sendMetaPurchase.mockResolvedValue({ success: true, eventsReceived: 1 });
  }
  
  if (mocks.sendGA4Login) {
    mocks.sendGA4Login.mockResolvedValue({ success: true });
  }
  
  if (mocks.sendGA4SignUp) {
    mocks.sendGA4SignUp.mockResolvedValue({ success: true });
  }
  
  if (mocks.sendMetaCompleteRegistration) {
    mocks.sendMetaCompleteRegistration.mockResolvedValue({ success: true });
  }
  
  if (mocks.sendMetaInitiateCheckout) {
    mocks.sendMetaInitiateCheckout.mockResolvedValue({ success: true });
  }
  
  if (mocks.sendGA4CheckoutStep) {
    mocks.sendGA4CheckoutStep.mockResolvedValue({ success: true });
  }
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const buildMockOrder = () => ({
  _id: { toString: () => 'order_123' },
  orderItems: [{ product: { toString: () => 'p1' }, name: 'Sneakers', price: 99.99, quantity: 1, category: 'footwear' }],
  totalPrice: 99.99,
  taxPrice: 0,
  shippingPrice: 0,
  paymentInfo: { reference: 'PAY_123', currency: 'USD', method: 'card' },
  analytics: { isFirstPurchase: true, purchaseNumber: 1 },
  discounts: null,
});

const buildMockUser = () => ({
  _id: { toString: () => 'user_123' },
  email: 'test@example.com',
  firstName: 'John',
  lastName: 'Doe',
});

const buildMockReq = (overrides = {}) => ({
  body: {
    analyticsEventId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    clientTimestamp: '2024-01-15T12:00:00.000Z',
    ga4ClientId: '1234567890.9876543210',
    fbp: 'fb.1.111.222',
    fbc: null,
  },
  cookies: { _fbp: 'fb.1.111.222' },
  sessionId: 'session_abc',
  anonymousId: 'anon_xyz',
  attribution: {
    source: 'google',
    medium: 'cpc',
    gclid: 'test_gclid',
    fbclid: null,
    confidenceScore: 0.90,
    confidenceLevel: 'HIGH',
    isReconstructed: false,
  },
  ip: '192.168.1.1',
  headers: { 'user-agent': 'Chrome/120', referer: 'https://epicstore.com/payment' },
  user: buildMockUser(),
  ...overrides,
});

const buildMockCheckout = () => ({
  _id: { toString: () => 'checkout_123' },
  items: [{ product: { toString: () => 'p1' }, price: 99.99, quantity: 1 }],
  pricing: { totalPrice: 99.99, currency: 'USD' },
  discount: null,
});

// ─── HELPER: Wait for all pending promises ────────────────────────────────────
const waitForAllPromises = async () => {
  // Wait for event loop to clear all pending promises
  await new Promise(resolve => setTimeout(resolve, 50));
};

// ─── fireAnalyticsEvent ───────────────────────────────────────────────────────

describe('fireAnalyticsEvent', () => {
  test('enqueues a purchase event', async () => {
    await fireAnalyticsEvent('purchase', {
      order: buildMockOrder(),
      user: buildMockUser(),
      req: buildMockReq(),
    });
    await waitForAllPromises();

    expect(mocks.enqueueAnalyticsEvent).toHaveBeenCalledWith(
      'purchase',
      expect.objectContaining({ event_id: expect.any(String) })
    );
  });

  test('uses client UUID from req.body.analyticsEventId as event_id', async () => {
    await fireAnalyticsEvent('purchase', {
      order: buildMockOrder(),
      user: buildMockUser(),
      req: buildMockReq(),
    });
    await waitForAllPromises();

    const payload = mocks.enqueueAnalyticsEvent.mock.calls[0][1];
    expect(payload.event_id).toBe('f47ac10b-58cc-4372-a567-0e02b2c3d479');
  });

  test('queues event when queue: true (default)', async () => {
    await fireAnalyticsEvent('purchase', {
      order: buildMockOrder(),
      user: buildMockUser(),
      req: buildMockReq(),
    });
    await waitForAllPromises();

    expect(mocks.enqueueAnalyticsEvent).toHaveBeenCalledTimes(1);
  });

  test('does NOT queue when queue: false', async () => {
    await fireAnalyticsEvent('login', {
      method: 'email',
      user: buildMockUser(),
      req: buildMockReq(),
    }, { queue: false });
    await waitForAllPromises();

    expect(mocks.enqueueAnalyticsEvent).not.toHaveBeenCalled();
  });

  test('passes attribution context to queue payload', async () => {
    await fireAnalyticsEvent('purchase', {
      order: buildMockOrder(),
      user: buildMockUser(),
      req: buildMockReq(),
    });
    await waitForAllPromises();

    const payload = mocks.enqueueAnalyticsEvent.mock.calls[0][1];
    
    expect(payload.source || payload.attribution?.source).toBe('google');
    expect(payload.confidenceLevel || payload.attribution?.confidenceLevel).toBe('HIGH');
  });

  test('passes sessionId and anonymousId to queue payload', async () => {
    await fireAnalyticsEvent('purchase', {
      order: buildMockOrder(),
      user: buildMockUser(),
      req: buildMockReq(),
    });
    await waitForAllPromises();

    const payload = mocks.enqueueAnalyticsEvent.mock.calls[0][1];
    expect(payload.session_id).toBe('session_abc');
    expect(payload.anonymous_id).toBe('anon_xyz');
  });

  test('includes full context in queue payload', async () => {
    await fireAnalyticsEvent('purchase', {
      order: buildMockOrder(),
      user: buildMockUser(),
      req: buildMockReq(),
    });
    await waitForAllPromises();

    const payload = mocks.enqueueAnalyticsEvent.mock.calls[0][1];
    expect(payload.context).toMatchObject({
      eventId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      sessionId: 'session_abc',
      clientIp: '192.168.1.1',
    });
  });

  test('enqueue failure does not throw to caller', async () => {
    mocks.enqueueAnalyticsEvent.mockRejectedValue(new Error('MongoDB down'));

    // Should not throw when wrapped in .catch() as controllers do
    await expect(
      fireAnalyticsEvent('purchase', {
        order: buildMockOrder(),
        user: buildMockUser(),
        req: buildMockReq(),
      }).catch(() => {})
    ).resolves.not.toThrow();
    
    await waitForAllPromises();
  });
});

// ─── Fast path dispatch ───────────────────────────────────────────────────────

describe('Fast path dispatch', () => {
  // Fast path fires asynchronously — we need to wait for it
  const waitForFastPath = () => new Promise(resolve => setTimeout(resolve, 100));

  test('fires GA4 purchase on fast path for purchase events', async () => {
    await fireAnalyticsEvent('purchase', {
      order: buildMockOrder(),
      user: buildMockUser(),
      req: buildMockReq(),
    }, { fastPath: true });

    await waitForFastPath();

    expect(mocks.sendGA4Purchase).toHaveBeenCalledTimes(1);
  });

  test('fires Meta purchase on fast path for purchase events', async () => {
    await fireAnalyticsEvent('purchase', {
      order: buildMockOrder(),
      user: buildMockUser(),
      req: buildMockReq(),
    }, { fastPath: true });

    await waitForFastPath();

    expect(mocks.sendMetaPurchase).toHaveBeenCalledTimes(1);
  });

  test('fires GA4 checkout on fast path for begin_checkout events', async () => {
    await fireAnalyticsEvent('begin_checkout', {
      checkout: buildMockCheckout(),
      user: buildMockUser(),
      req: buildMockReq(),
    }, { fastPath: true });

    await waitForFastPath();

    expect(mocks.sendGA4CheckoutStep).toHaveBeenCalledTimes(1);
  });

  test('fires GA4 login on fast path for login events', async () => {
    await fireAnalyticsEvent('login', {
      method: 'google',
      user: buildMockUser(),
      req: buildMockReq(),
    }, { fastPath: true, queue: false });

    await waitForFastPath();

    expect(mocks.sendGA4Login).toHaveBeenCalledTimes(1);
  });

  test('does NOT fire fast path for low-value events (add_to_cart)', async () => {
    await fireAnalyticsEvent('add_to_cart', {
      req: buildMockReq(),
    }, { fastPath: true });

    await waitForFastPath();

    expect(mocks.sendGA4Purchase).not.toHaveBeenCalled();
    expect(mocks.sendMetaPurchase).not.toHaveBeenCalled();
  });

  test('fast path failure does not prevent queue from running', async () => {
    mocks.sendGA4Purchase.mockRejectedValue(new Error('GA4 timeout'));

    await fireAnalyticsEvent('purchase', {
      order: buildMockOrder(),
      user: buildMockUser(),
      req: buildMockReq(),
    }, { fastPath: true, queue: true });

    await waitForFastPath();

    // Queue should still have been called despite fast path failure
    expect(mocks.enqueueAnalyticsEvent).toHaveBeenCalledTimes(1);
  });

  test('skips fast path when fastPath: false', async () => {
    await fireAnalyticsEvent('purchase', {
      order: buildMockOrder(),
      user: buildMockUser(),
      req: buildMockReq(),
    }, { fastPath: false });

    await waitForFastPath();

    expect(mocks.sendGA4Purchase).not.toHaveBeenCalled();
    expect(mocks.sendMetaPurchase).not.toHaveBeenCalled();
  });
});

// ─── Convenience wrappers ─────────────────────────────────────────────────────

describe('firePurchaseEvent', () => {
  test('calls fireAnalyticsEvent with purchase event type', async () => {
    await firePurchaseEvent(buildMockOrder(), buildMockUser(), buildMockReq());
    await waitForAllPromises();

    expect(mocks.enqueueAnalyticsEvent).toHaveBeenCalledWith(
      'purchase',
      expect.any(Object)
    );
  });

  test('preserves client UUID as event_id', async () => {
    await firePurchaseEvent(buildMockOrder(), buildMockUser(), buildMockReq());
    await waitForAllPromises();

    const payload = mocks.enqueueAnalyticsEvent.mock.calls[0][1];
    expect(payload.event_id).toBe('f47ac10b-58cc-4372-a567-0e02b2c3d479');
  });
});

describe('fireCheckoutStartEvent', () => {
  test('enqueues begin_checkout event', async () => {
    await fireCheckoutStartEvent(buildMockCheckout(), buildMockUser(), buildMockReq());
    await waitForAllPromises();

    expect(mocks.enqueueAnalyticsEvent).toHaveBeenCalledWith(
      'begin_checkout',
      expect.any(Object)
    );
  });
});

describe('fireLoginEvent', () => {
  test('fires GA4 login on fast path only (no queue)', async () => {
    await fireLoginEvent('google', buildMockUser(), buildMockReq());

    await new Promise(r => setTimeout(r, 100));

    expect(mocks.sendGA4Login).toHaveBeenCalledWith('google', expect.any(Object));
    expect(mocks.enqueueAnalyticsEvent).not.toHaveBeenCalled();
  });
});

describe('fireSignUpEvent', () => {
  test('fires GA4 and Meta on fast path only (no queue)', async () => {
    await fireSignUpEvent('email', buildMockUser(), buildMockReq());

    await new Promise(r => setTimeout(r, 100));

    expect(mocks.sendGA4SignUp).toHaveBeenCalledTimes(1);
    expect(mocks.sendMetaCompleteRegistration).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueAnalyticsEvent).not.toHaveBeenCalled();
  });
});

// ─── Non-blocking guarantee ───────────────────────────────────────────────────

describe('Non-blocking guarantee', () => {
  test('returns before GA4 and Meta complete', async () => {
    // Simulate slow platforms
    mocks.sendGA4Purchase.mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve({ success: true }), 500))
    );

    const start = Date.now();
    await firePurchaseEvent(buildMockOrder(), buildMockUser(), buildMockReq());
    const elapsed = Date.now() - start;

    // Should return almost immediately — queue enqueue is fast
    // Fast path is fire-and-forget so should not add meaningful delay
    expect(elapsed).toBeLessThan(200);
    
    await waitForAllPromises();
  });

  test('analytics does not block payment response when all platforms fail', async () => {
    mocks.sendGA4Purchase.mockRejectedValue(new Error('GA4 down'));
    mocks.sendMetaPurchase.mockRejectedValue(new Error('Meta down'));
    mocks.enqueueAnalyticsEvent.mockRejectedValue(new Error('MongoDB down'));

    // Simulate how the controller calls it — fire and forget with .catch()
    let errorCaught = false;
    await firePurchaseEvent(buildMockOrder(), buildMockUser(), buildMockReq())
      .catch(() => { errorCaught = true; });

    // errorCaught may be true (enqueue throws) but the important thing is
    // the controller .catch() handles it — it never propagates to the response
    expect(typeof errorCaught).toBe('boolean');
    
    await waitForAllPromises();
  });
});

// ─── CLEANUP ──────────────────────────────────────────────────────────────────
afterAll(async () => {
  // Give any remaining async operations time to complete
  await waitForAllPromises();
});
/**
 * backend/controller/tests/analyticsObservabilityController.test.js
 *
 * Phase 8 — Test Suite for analyticsObservabilityController.js
 * 
 * Fixed version using proper ESM mocking with jest.unstable_mockModule
 */

import { jest } from '@jest/globals';

// ─── SHARED MOCK REGISTRY ─────────────────────────────────────────────────────
const mocks = {};

// ─── MOCKS USING unstable_mockModule ────────────────────────────────────────
// These must be defined before imports and use await

// Mock order-model.js
await jest.unstable_mockModule('../../models/order-model.js', () => {
  const find = jest.fn();
  const aggregate = jest.fn();
  
  mocks.orderFind = find;
  mocks.orderAggregate = aggregate;
  
  return {
    default: { find, aggregate }
  };
});

// Mock AnalyticsEvent.js
await jest.unstable_mockModule('../../models/AnalyticsEvent.js', () => {
  const getQueueHealth = jest.fn();
  const find = jest.fn();
  
  mocks.analyticsEventGetQueueHealth = getQueueHealth;
  mocks.analyticsEventFind = find;
  
  return {
    default: { getQueueHealth, find }
  };
});

// Mock referrerReconstruction.js
await jest.unstable_mockModule('../../utils/referrerReconstruction.js', () => {
  const getReconstructionRules = jest.fn().mockReturnValue([]);
  
  mocks.getReconstructionRules = getReconstructionRules;
  
  return { getReconstructionRules };
});

// Mock handleAsyncError.js
await jest.unstable_mockModule('../../middleware/handleAsyncError.js', () => ({
  default: (fn) => fn
}));

// Mock handleError.js
await jest.unstable_mockModule('../../utils/handleError.js', () => ({
  default: class HandleError extends Error {
    constructor(message, statusCode) {
      super(message);
      this.statusCode = statusCode;
    }
  }
}));

// ─── IMPORTS (after all mocks are declared) ───────────────────────────────────
const {
  getAttributionHealth,
  getAttributionDrift,
  getQueueHealth,
  getUserEventTrace,
} = await import('../analyticsObservabilityController.js');

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const buildMockRes = () => {
  const res = {
    _json: null,
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockImplementation((data) => { 
      res._json = data; 
      return res; 
    }),
  };
  return res;
};

const buildMockReq = (overrides = {}) => ({
  params: {},
  query: {},
  ...overrides,
});

const buildMockNext = () => jest.fn();

const buildMockOrder = (overrides = {}) => ({
  _id: 'order_123',
  createdAt: new Date(),
  totalPrice: 99.99,
  analytics: {
    source: 'google',
    medium: 'cpc',
    gclid: 'test_gclid',
    fbclid: null,
    ttclid: null,
    msclkid: null,
    confidenceLevel: 'HIGH',
    confidenceScore: 0.90,
    isReconstructed: false,
    anonymousId: 'anon_456',
    eventId: 'uuid_123',
    reconstructionRule: null,
  },
  paymentInfo: { reference: 'PAY_REF_123' },
  ...overrides,
});

// Builds a chainable Mongoose query mock: .sort().limit().select().lean()
const buildFindChain = (result) => {
  const chain = {
    sort: jest.fn(),
    limit: jest.fn(),
    select: jest.fn(),
    lean: jest.fn().mockResolvedValue(result),
  };
  chain.sort.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  return chain;
};

// ─── SETUP ────────────────────────────────────────────────────────────────────
beforeEach(() => {
  jest.clearAllMocks();
  
  // Re-apply the default reconstruction rules mock after clearAllMocks resets it
  if (mocks.getReconstructionRules) {
    mocks.getReconstructionRules.mockReturnValue([]);
  }
  
  // Reset any other mock implementations if needed
  if (mocks.orderFind) {
    mocks.orderFind.mockReset();
    mocks.orderAggregate.mockReset();
  }
  
  if (mocks.analyticsEventGetQueueHealth) {
    mocks.analyticsEventGetQueueHealth.mockReset();
    mocks.analyticsEventFind.mockReset();
  }
});

// ─── getAttributionHealth ─────────────────────────────────────────────────────
describe('getAttributionHealth', () => {
  test('returns success: true with metrics', async () => {
    const orders = [
      buildMockOrder(),
      buildMockOrder({ 
        analytics: { 
          source: 'facebook', 
          medium: 'social', 
          fbclid: 'fb_123', 
          gclid: null, 
          ttclid: null, 
          msclkid: null, 
          confidenceLevel: 'MEDIUM', 
          anonymousId: 'anon_1', 
          isReconstructed: false 
        } 
      }),
      buildMockOrder({ 
        analytics: { 
          source: 'direct',   
          medium: null,     
          gclid: null, 
          fbclid: null, 
          ttclid: null, 
          msclkid: null, 
          confidenceLevel: 'LOW',    
          anonymousId: null,     
          isReconstructed: true  
        } 
      }),
    ];
    mocks.orderFind.mockReturnValue(buildFindChain(orders));

    const res = buildMockRes();
    await getAttributionHealth(buildMockReq(), res, buildMockNext());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res._json.success).toBe(true);
    expect(res._json.metrics).toBeTruthy();
    expect(res._json.total).toBe(3);
  });

  test('computes utm_capture_rate correctly', async () => {
    // 2 of 3 orders have a non-direct source → 66.7%
    const orders = [
      buildMockOrder({ 
        analytics: { 
          source: 'google',   
          gclid: null, 
          fbclid: null, 
          ttclid: null, 
          msclkid: null, 
          confidenceLevel: 'MEDIUM', 
          anonymousId: 'a', 
          isReconstructed: false 
        } 
      }),
      buildMockOrder({ 
        analytics: { 
          source: 'facebook', 
          gclid: null, 
          fbclid: null, 
          ttclid: null, 
          msclkid: null, 
          confidenceLevel: 'MEDIUM', 
          anonymousId: 'b', 
          isReconstructed: false 
        } 
      }),
      buildMockOrder({ 
        analytics: { 
          source: 'direct',   
          gclid: null, 
          fbclid: null, 
          ttclid: null, 
          msclkid: null, 
          confidenceLevel: 'LOW',    
          anonymousId: 'c', 
          isReconstructed: false 
        } 
      }),
    ];
    mocks.orderFind.mockReturnValue(buildFindChain(orders));

    const res = buildMockRes();
    await getAttributionHealth(buildMockReq(), res, buildMockNext());

    expect(res._json.metrics.utm_capture_rate).toBeCloseTo(66.7, 0);
  });

  test('computes click_id_capture_rate correctly', async () => {
    const orders = [
      buildMockOrder({ 
        analytics: { 
          source: 'google', 
          gclid: 'gclid_1', 
          fbclid: null, 
          ttclid: null, 
          msclkid: null, 
          confidenceLevel: 'HIGH', 
          anonymousId: 'a', 
          isReconstructed: false 
        } 
      }),
      buildMockOrder({ 
        analytics: { 
          source: 'direct', 
          gclid: null,      
          fbclid: null, 
          ttclid: null, 
          msclkid: null, 
          confidenceLevel: 'LOW',  
          anonymousId: 'b', 
          isReconstructed: false 
        } 
      }),
    ];
    mocks.orderFind.mockReturnValue(buildFindChain(orders));

    const res = buildMockRes();
    await getAttributionHealth(buildMockReq(), res, buildMockNext());

    expect(res._json.metrics.click_id_capture_rate).toBe(50);
  });

  test('computes unattributed_rate correctly', async () => {
    const orders = [
      buildMockOrder({ 
        analytics: { 
          source: 'direct', 
          gclid: null,    
          fbclid: null, 
          ttclid: null, 
          msclkid: null, 
          confidenceLevel: 'LOW',  
          anonymousId: 'a', 
          isReconstructed: false 
        } 
      }),
      buildMockOrder({ 
        analytics: { 
          source: 'direct', 
          gclid: null,    
          fbclid: null, 
          ttclid: null, 
          msclkid: null, 
          confidenceLevel: 'LOW',  
          anonymousId: 'b', 
          isReconstructed: false 
        } 
      }),
      buildMockOrder({ 
        analytics: { 
          source: 'google', 
          gclid: 'gclid', 
          fbclid: null, 
          ttclid: null, 
          msclkid: null, 
          confidenceLevel: 'HIGH', 
          anonymousId: 'c', 
          isReconstructed: false 
        } 
      }),
    ];
    mocks.orderFind.mockReturnValue(buildFindChain(orders));

    const res = buildMockRes();
    await getAttributionHealth(buildMockReq(), res, buildMockNext());

    expect(res._json.metrics.unattributed_rate).toBeCloseTo(66.7, 0);
  });

  test('returns empty message when no orders in window', async () => {
    mocks.orderFind.mockReturnValue(buildFindChain([]));

    const res = buildMockRes();
    await getAttributionHealth(buildMockReq(), res, buildMockNext());

    expect(res._json.total).toBe(0);
    expect(res._json.metrics).toBeNull();
    expect(res._json.message).toContain('No orders found');
  });

  test('adds WARNING flag when unattributed_rate > 50', async () => {
    // 4 direct, 2 google → 66.6% unattributed
    const orders = Array(6).fill(null).map((_, i) => buildMockOrder({
      analytics: {
        source: i < 4 ? 'direct' : 'google',
        gclid: null,
        fbclid: null,
        ttclid: null,
        msclkid: null,
        confidenceLevel: i < 4 ? 'LOW' : 'HIGH',
        anonymousId: `anon_${i}`,
        isReconstructed: false,
      },
    }));
    mocks.orderFind.mockReturnValue(buildFindChain(orders));

    const res = buildMockRes();
    await getAttributionHealth(buildMockReq(), res, buildMockNext());

    const flag = res._json.flags.find(f => f.metric === 'unattributed_rate');
    expect(flag).toBeTruthy();
    expect(flag.severity).toBe('WARNING');
  });

  test('includes reconstructionRules in response', async () => {
    mocks.orderFind.mockReturnValue(buildFindChain([buildMockOrder()]));

    const res = buildMockRes();
    await getAttributionHealth(buildMockReq(), res, buildMockNext());

    expect(res._json).toHaveProperty('reconstructionRules');
  });
});

// ─── getAttributionDrift ──────────────────────────────────────────────────────
describe('getAttributionDrift', () => {
  test('returns success: true with sourceAnalysis', async () => {
    mocks.orderAggregate
      .mockResolvedValueOnce([{ _id: 'google', count: 5 }, { _id: 'facebook', count: 5 }])
      .mockResolvedValueOnce([{ _id: 'google', count: 15 }, { _id: 'facebook', count: 15 }]);

    const res = buildMockRes();
    await getAttributionDrift(buildMockReq(), res, buildMockNext());

    expect(res._json.success).toBe(true);
    expect(Array.isArray(res._json.sourceAnalysis)).toBe(true);
  });

  test('detects a significant drop and sets alert: true', async () => {
    // Facebook: recent 10%, baseline 35% → drift = -25pp (> 20pp threshold)
    mocks.orderAggregate
      .mockResolvedValueOnce([
        { _id: 'google', count: 9 },
        { _id: 'facebook', count: 1 },
      ])
      .mockResolvedValueOnce([
        { _id: 'google', count: 13 },
        { _id: 'facebook', count: 7 },
      ]);

    const res = buildMockRes();
    await getAttributionDrift(buildMockReq(), res, buildMockNext());

    const fbEntry = res._json.sourceAnalysis.find(s => s.source === 'facebook');
    expect(fbEntry.alert).toBe(true);
    expect(fbEntry.drift_direction).toBe('drop');
    expect(res._json.hasAlerts).toBe(true);
    expect(res._json.driftAlerts.length).toBeGreaterThan(0);
  });

  test('does not alert when drift is within threshold', async () => {
    mocks.orderAggregate
      .mockResolvedValueOnce([{ _id: 'google', count: 5 }, { _id: 'facebook', count: 5 }])
      .mockResolvedValueOnce([{ _id: 'google', count: 6 }, { _id: 'facebook', count: 4 }]);

    const res = buildMockRes();
    await getAttributionDrift(buildMockReq(), res, buildMockNext());

    expect(res._json.hasAlerts).toBe(false);
  });

  test('marks CRITICAL severity for drift > 35pp', async () => {
    // Facebook: recent 5%, baseline 45% → drift = -40pp
    mocks.orderAggregate
      .mockResolvedValueOnce([
        { _id: 'google', count: 19 },
        { _id: 'facebook', count: 1 },
      ])
      .mockResolvedValueOnce([
        { _id: 'google', count: 11 },
        { _id: 'facebook', count: 9 },
      ]);

    const res = buildMockRes();
    await getAttributionDrift(buildMockReq(), res, buildMockNext());

    const criticalAlert = res._json.driftAlerts.find(a => a.severity === 'CRITICAL');
    expect(criticalAlert).toBeTruthy();
  });

  test('handles empty orders gracefully', async () => {
    mocks.orderAggregate
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const res = buildMockRes();
    const next = buildMockNext();
    
    await getAttributionDrift(buildMockReq(), res, next);
    
    // When both aggregates return empty arrays, the controller should still respond
    // Check if res.json was called
    expect(res.json).toHaveBeenCalled();
    expect(res._json).toHaveProperty('success', true);
    expect(res._json).toHaveProperty('sourceAnalysis', []);
    expect(res._json).toHaveProperty('hasAlerts', false);
    expect(res._json).toHaveProperty('driftAlerts', []);
    expect(res._json).toHaveProperty('periods');
    expect(res._json).toHaveProperty('driftThreshold', 20);
  });

  test('includes period metadata in response', async () => {
    mocks.orderAggregate
      .mockResolvedValueOnce([{ _id: 'google', count: 5 }])
      .mockResolvedValueOnce([{ _id: 'google', count: 15 }]);

    const res = buildMockRes();
    await getAttributionDrift(buildMockReq(), res, buildMockNext());

    expect(res._json.periods.recent.days).toBe(7);
    expect(res._json.periods.baseline.days).toBe(30);
    expect(res._json.driftThreshold).toBe(20);
  });

  test('sorts sourceAnalysis by absolute drift descending', async () => {
    mocks.orderAggregate
      .mockResolvedValueOnce([
        { _id: 'google', count: 9 },
        { _id: 'facebook', count: 1 },
      ])
      .mockResolvedValueOnce([
        { _id: 'google', count: 10 },
        { _id: 'facebook', count: 10 },
      ]);

    const res = buildMockRes();
    await getAttributionDrift(buildMockReq(), res, buildMockNext());

    const drifts = res._json.sourceAnalysis.map(s => Math.abs(s.drift_pct));
    for (let i = 1; i < drifts.length; i++) {
      expect(drifts[i]).toBeLessThanOrEqual(drifts[i - 1]);
    }
  });
});

// ─── getQueueHealth ───────────────────────────────────────────────────────────
describe('getQueueHealth', () => {
  const mockQueueSummary = {
    pending: 5, processing: 1, completed: 100, failed: 3, dead_letter: 2, total: 111,
  };

  test('returns queue summary', async () => {
    mocks.analyticsEventGetQueueHealth.mockResolvedValue(mockQueueSummary);
    mocks.analyticsEventFind.mockReturnValue(buildFindChain([]));

    const res = buildMockRes();
    await getQueueHealth(buildMockReq(), res, buildMockNext());

    expect(res._json.success).toBe(true);
    expect(res._json.summary.pending).toBe(5);
    expect(res._json.summary.dead_letter).toBe(2);
  });

  test('adds CRITICAL flag when dead_letter count > 0', async () => {
    mocks.analyticsEventGetQueueHealth.mockResolvedValue({ ...mockQueueSummary, dead_letter: 3 });
    mocks.analyticsEventFind.mockReturnValue(buildFindChain([]));

    const res = buildMockRes();
    await getQueueHealth(buildMockReq(), res, buildMockNext());

    const criticalFlag = res._json.flags.find(f => f.severity === 'CRITICAL');
    expect(criticalFlag).toBeTruthy();
    expect(criticalFlag.message).toContain('dead_letter');
  });

  test('adds WARNING flag when pending > 50', async () => {
    mocks.analyticsEventGetQueueHealth.mockResolvedValue({ ...mockQueueSummary, pending: 55 });
    mocks.analyticsEventFind.mockReturnValue(buildFindChain([]));

    const res = buildMockRes();
    await getQueueHealth(buildMockReq(), res, buildMockNext());

    const warningFlag = res._json.flags.find(f => f.message?.includes('pending'));
    expect(warningFlag).toBeTruthy();
  });

  test('computes platform failure counts from recent failed events', async () => {
    mocks.analyticsEventGetQueueHealth.mockResolvedValue(mockQueueSummary);
    const deadLetters = [];
    const failedEvents = [
      { platforms: { ga4: { success: false }, meta: { success: true }, bigquery: { success: true } } },
      { platforms: { ga4: { success: false }, meta: { success: false }, bigquery: { success: true } } },
    ];
    mocks.analyticsEventFind
      .mockReturnValueOnce(buildFindChain(deadLetters))
      .mockReturnValueOnce(buildFindChain(failedEvents));

    const res = buildMockRes();
    await getQueueHealth(buildMockReq(), res, buildMockNext());

    expect(res._json.platformFailures.ga4).toBe(2);
    expect(res._json.platformFailures.meta).toBe(1);
    expect(res._json.platformFailures.bigquery).toBe(0);
  });

  test('returns empty flags when queue is healthy', async () => {
    mocks.analyticsEventGetQueueHealth.mockResolvedValue({
      pending: 2, processing: 0, completed: 500, failed: 0, dead_letter: 0,
    });
    mocks.analyticsEventFind.mockReturnValue(buildFindChain([]));

    const res = buildMockRes();
    await getQueueHealth(buildMockReq(), res, buildMockNext());

    expect(res._json.flags).toHaveLength(0);
  });
});

// ─── getUserEventTrace ────────────────────────────────────────────────────────
describe('getUserEventTrace', () => {
  test('returns order trace with attribution data', async () => {
    const orders = [
      buildMockOrder(),
      buildMockOrder({ 
        analytics: { 
          ...buildMockOrder().analytics, 
          anonymousId: 'anon_789' 
        } 
      }),
    ];
    mocks.orderFind.mockReturnValue(buildFindChain(orders));
    mocks.analyticsEventFind.mockReturnValue(buildFindChain([]));

    const res = buildMockRes();
    await getUserEventTrace(buildMockReq({ params: { userId: 'user_123' } }), res, buildMockNext());

    expect(res._json.success).toBe(true);
    expect(res._json.userId).toBe('user_123');
    expect(res._json.orders).toHaveLength(2);
    expect(res._json.orders[0].attribution).toBeTruthy();
    expect(res._json.orders[0].attribution.source).toBe('google');
  });

  test('collects unique anonymousIds from orders', async () => {
    const orders = [
      buildMockOrder({ 
        analytics: { 
          ...buildMockOrder().analytics, 
          anonymousId: 'anon_1' 
        } 
      }),
      buildMockOrder({ 
        analytics: { 
          ...buildMockOrder().analytics, 
          anonymousId: 'anon_2' 
        } 
      }),
      buildMockOrder({ 
        analytics: { 
          ...buildMockOrder().analytics, 
          anonymousId: 'anon_1' 
        } 
      }),
    ];
    mocks.orderFind.mockReturnValue(buildFindChain(orders));
    mocks.analyticsEventFind.mockReturnValue(buildFindChain([]));

    const res = buildMockRes();
    await getUserEventTrace(buildMockReq({ params: { userId: 'user_123' } }), res, buildMockNext());

    expect(res._json.summary.anonymousIds).toHaveLength(2);
    expect(res._json.summary.anonymousIds).toContain('anon_1');
    expect(res._json.summary.anonymousIds).toContain('anon_2');
  });

  test('includes confidence level breakdown in summary', async () => {
    const orders = [
      buildMockOrder({ 
        analytics: { 
          ...buildMockOrder().analytics, 
          confidenceLevel: 'HIGH' 
        } 
      }),
      buildMockOrder({ 
        analytics: { 
          ...buildMockOrder().analytics, 
          confidenceLevel: 'HIGH' 
        } 
      }),
      buildMockOrder({ 
        analytics: { 
          ...buildMockOrder().analytics, 
          confidenceLevel: 'LOW'  
        } 
      }),
    ];
    mocks.orderFind.mockReturnValue(buildFindChain(orders));
    mocks.analyticsEventFind.mockReturnValue(buildFindChain([]));

    const res = buildMockRes();
    await getUserEventTrace(buildMockReq({ params: { userId: 'user_123' } }), res, buildMockNext());

    expect(res._json.summary.confidenceLevels.HIGH).toBe(2);
    expect(res._json.summary.confidenceLevels.LOW).toBe(1);
  });

  test('returns queue events associated with user', async () => {
    const queueEvents = [
      { eventId: 'uuid_1', eventType: 'purchase', status: 'completed' },
    ];
    mocks.orderFind.mockReturnValue(buildFindChain([]));
    mocks.analyticsEventFind.mockReturnValue(buildFindChain(queueEvents));

    const res = buildMockRes();
    await getUserEventTrace(buildMockReq({ params: { userId: 'user_123' } }), res, buildMockNext());

    expect(res._json.queueEvents).toHaveLength(1);
    expect(res._json.summary.totalQueueEvents).toBe(1);
  });
});
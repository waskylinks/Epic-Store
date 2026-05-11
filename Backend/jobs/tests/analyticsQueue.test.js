/**
 * backend/jobs/__tests__/analyticsQueue.test.js
 *
 * Phase 6 — Test Suite for analyticsQueue.js
 *
 * Run with:
 *   npx jest jobs/__tests__/analyticsQueue.test.js --verbose
 *
 * Tests validate:
 *   1. enqueueAnalyticsEvent — creates document, idempotency, missing eventId
 *   2. getNextRetryDelay — exponential backoff calculation
 *   3. processAnalyticsQueue — successful sweep, partial failure, dead-letter
 *   4. retryDeadLetterEvents — resets dead_letter to pending
 *   5. purgeCompletedEvents — deletes old completed events
 *   6. Platform dispatch — correct service called per eventType
 *   7. Promise.allSettled — one platform failure does not block others
 */

import { jest } from '@jest/globals';

// ─── MOCKS ────────────────────────────────────────────────────────────────────

const mockFindOne           = jest.fn();
const mockCreate            = jest.fn();
const mockFindEligible      = jest.fn();
const mockFindByIdAndUpdate = jest.fn();
const mockUpdateMany        = jest.fn();
const mockDeleteMany        = jest.fn();
const mockAggregate         = jest.fn();

jest.mock('../../models/AnalyticsEvent.js', () => ({
  default: {
    findOne:           mockFindOne,
    create:            mockCreate,
    findEligible:      mockFindEligible,
    findByIdAndUpdate: mockFindByIdAndUpdate,
    updateMany:        mockUpdateMany,
    deleteMany:        mockDeleteMany,
    aggregate:         mockAggregate,
  },
}));

const mockSendGA4Purchase      = jest.fn();
const mockSendGA4CheckoutStep  = jest.fn();
const mockSendGA4Login         = jest.fn();
const mockSendGA4SignUp        = jest.fn();
const mockSendGA4Refund        = jest.fn();

jest.mock('../../Services/analytics/ga4Service.js', () => ({
  sendGA4Purchase:     mockSendGA4Purchase,
  sendGA4CheckoutStep: mockSendGA4CheckoutStep,
  sendGA4Login:        mockSendGA4Login,
  sendGA4SignUp:       mockSendGA4SignUp,
  sendGA4Refund:       mockSendGA4Refund,
}));

const mockSendMetaPurchase              = jest.fn();
const mockSendMetaInitiateCheckout      = jest.fn();
const mockSendMetaCompleteRegistration  = jest.fn();

jest.mock('../../Services/analytics/metaCapiService.js', () => ({
  sendMetaPurchase:             mockSendMetaPurchase,
  sendMetaInitiateCheckout:     mockSendMetaInitiateCheckout,
  sendMetaCompleteRegistration: mockSendMetaCompleteRegistration,
}));

const mockStreamEventToBigQuery = jest.fn();

jest.mock('../../Services/analytics/bigQueryService.js', () => ({
  streamEventToBigQuery: mockStreamEventToBigQuery,
}));

const mockSendCronAlert = jest.fn();

jest.mock('../../utils/cronAlert.js', () => ({
  sendCronAlert: mockSendCronAlert,
}));

import {
  enqueueAnalyticsEvent,
  processAnalyticsQueue,
  getNextRetryDelay,
  retryDeadLetterEvents,
  purgeCompletedEvents,
} from '../analyticsQueue.js';

// ─── SETUP ────────────────────────────────────────────────────────────────────

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();

  process.env.ANALYTICS_QUEUE_RETRY_MAX    = '3';
  process.env.ANALYTICS_QUEUE_BACKOFF_BASE = '1000';
  process.env.ANALYTICS_QUEUE_CONCURRENCY  = '5';

  // Default: all platforms succeed
  mockSendGA4Purchase.mockResolvedValue({ success: true });
  mockSendMetaPurchase.mockResolvedValue({ success: true, eventsReceived: 1 });
  mockStreamEventToBigQuery.mockResolvedValue({ success: true });
  mockSendCronAlert.mockResolvedValue(true);
  mockFindByIdAndUpdate.mockResolvedValue({});
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const buildMockEvent = (overrides = {}) => ({
  _id:        'doc_123',
  eventId:    'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  eventType:  'purchase',
  status:     'pending',
  attempts:   0,
  maxAttempts: 3,
  payload: {
    event_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    order:    { _id: { toString: () => 'order_123' }, orderItems: [], totalPrice: 99.99, paymentInfo: { currency: 'USD' } },
    user:     { _id: { toString: () => 'user_123' }, email: 'test@example.com' },
    context:  { eventId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', clientId: 'ga4_client', sessionId: 'sess_123' },
  },
  ...overrides,
});

// ─── getNextRetryDelay ────────────────────────────────────────────────────────

describe('getNextRetryDelay', () => {
  test('attempt 0 → 2000ms (BASE × 2^1)', () => {
    expect(getNextRetryDelay(0)).toBe(2000);
  });

  test('attempt 1 → 4000ms (BASE × 2^2)', () => {
    expect(getNextRetryDelay(1)).toBe(4000);
  });

  test('attempt 2 → 8000ms (BASE × 2^3)', () => {
    expect(getNextRetryDelay(2)).toBe(8000);
  });

  test('delay increases exponentially with each attempt', () => {
    const d0 = getNextRetryDelay(0);
    const d1 = getNextRetryDelay(1);
    const d2 = getNextRetryDelay(2);
    expect(d1).toBe(d0 * 2);
    expect(d2).toBe(d1 * 2);
  });
});

// ─── enqueueAnalyticsEvent ────────────────────────────────────────────────────

describe('enqueueAnalyticsEvent', () => {
  test('creates a new AnalyticsEvent document', async () => {
    mockFindOne.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ eventId: 'uuid_123', status: 'pending' });

    await enqueueAnalyticsEvent('purchase', { event_id: 'uuid_123', order: {}, context: {} });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId:    'uuid_123',
        eventType:  'purchase',
        status:     'pending',
        attempts:   0,
        priority:   10, // purchase = highest priority
      })
    );
  });

  test('is idempotent — returns existing document if eventId already exists', async () => {
    const existing = { eventId: 'uuid_123', status: 'completed' };
    mockFindOne.mockResolvedValue(existing);

    const result = await enqueueAnalyticsEvent('purchase', { event_id: 'uuid_123' });

    expect(result).toBe(existing);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('throws when eventId is missing from payload', async () => {
    await expect(
      enqueueAnalyticsEvent('purchase', { order: {} })
    ).rejects.toThrow('eventId is required');
  });

  test('sets priority 10 for purchase events', async () => {
    mockFindOne.mockResolvedValue(null);
    mockCreate.mockResolvedValue({});

    await enqueueAnalyticsEvent('purchase', { event_id: 'uuid_123' });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 10 })
    );
  });

  test('sets priority 1 for view_item events', async () => {
    mockFindOne.mockResolvedValue(null);
    mockCreate.mockResolvedValue({});

    await enqueueAnalyticsEvent('view_item', { event_id: 'uuid_123' });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 1 })
    );
  });

  test('sets nextRetryAt to now (immediately eligible)', async () => {
    mockFindOne.mockResolvedValue(null);
    mockCreate.mockResolvedValue({});

    const before = Date.now();
    await enqueueAnalyticsEvent('purchase', { event_id: 'uuid_123' });
    const after = Date.now();

    const createCall = mockCreate.mock.calls[0][0];
    const nextRetryAt = createCall.nextRetryAt.getTime();
    expect(nextRetryAt).toBeGreaterThanOrEqual(before);
    expect(nextRetryAt).toBeLessThanOrEqual(after);
  });
});

// ─── processAnalyticsQueue — successful sweep ─────────────────────────────────

describe('processAnalyticsQueue — successful sweep', () => {
  test('returns summary with processed and succeeded counts', async () => {
    mockFindEligible.mockResolvedValue([buildMockEvent()]);

    const summary = await processAnalyticsQueue();

    expect(summary.processed).toBe(1);
    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.deadLettered).toBe(0);
  });

  test('marks event as processing before dispatch', async () => {
    mockFindEligible.mockResolvedValue([buildMockEvent()]);

    await processAnalyticsQueue();

    expect(mockFindByIdAndUpdate).toHaveBeenCalledWith(
      'doc_123',
      { $set: { status: 'processing' } }
    );
  });

  test('marks event as completed when all platforms succeed', async () => {
    mockFindEligible.mockResolvedValue([buildMockEvent()]);

    await processAnalyticsQueue();

    const completedCall = mockFindByIdAndUpdate.mock.calls.find(
      call => call[1]?.$set?.status === 'completed'
    );
    expect(completedCall).toBeTruthy();
    expect(completedCall[1].$set.completedAt).toBeInstanceOf(Date);
  });

  test('returns empty summary when no eligible events', async () => {
    mockFindEligible.mockResolvedValue([]);

    const summary = await processAnalyticsQueue();

    expect(summary.processed).toBe(0);
    expect(summary.succeeded).toBe(0);
  });

  test('calls sendGA4Purchase for purchase events', async () => {
    mockFindEligible.mockResolvedValue([buildMockEvent({ eventType: 'purchase' })]);

    await processAnalyticsQueue();

    expect(mockSendGA4Purchase).toHaveBeenCalledTimes(1);
  });

  test('calls sendMetaPurchase for purchase events', async () => {
    mockFindEligible.mockResolvedValue([buildMockEvent({ eventType: 'purchase' })]);

    await processAnalyticsQueue();

    expect(mockSendMetaPurchase).toHaveBeenCalledTimes(1);
  });

  test('calls streamEventToBigQuery for ALL event types', async () => {
    mockFindEligible.mockResolvedValue([buildMockEvent({ eventType: 'view_item' })]);

    await processAnalyticsQueue();

    expect(mockStreamEventToBigQuery).toHaveBeenCalledTimes(1);
  });

  test('processes multiple events in one sweep', async () => {
    mockFindEligible.mockResolvedValue([
      buildMockEvent({ _id: 'doc_1', eventId: 'uuid_1' }),
      buildMockEvent({ _id: 'doc_2', eventId: 'uuid_2' }),
      buildMockEvent({ _id: 'doc_3', eventId: 'uuid_3' }),
    ]);

    const summary = await processAnalyticsQueue();

    expect(summary.processed).toBe(3);
    expect(summary.succeeded).toBe(3);
    expect(mockSendGA4Purchase).toHaveBeenCalledTimes(3);
  });
});

// ─── processAnalyticsQueue — partial failure ──────────────────────────────────

describe('processAnalyticsQueue — partial failure', () => {
  test('marks as failed when GA4 fails but attempts < maxAttempts', async () => {
    mockSendGA4Purchase.mockRejectedValue(new Error('GA4 timeout'));
    mockFindEligible.mockResolvedValue([buildMockEvent({ attempts: 0, maxAttempts: 3 })]);

    const summary = await processAnalyticsQueue();

    expect(summary.failed).toBe(1);
    expect(summary.succeeded).toBe(0);

    const failedCall = mockFindByIdAndUpdate.mock.calls.find(
      call => call[1]?.$set?.status === 'failed'
    );
    expect(failedCall).toBeTruthy();
  });

  test('schedules retry with exponential backoff after failure', async () => {
    mockSendGA4Purchase.mockRejectedValue(new Error('GA4 timeout'));
    mockFindEligible.mockResolvedValue([buildMockEvent({ attempts: 0 })]);

    await processAnalyticsQueue();

    const failedCall = mockFindByIdAndUpdate.mock.calls.find(
      call => call[1]?.$set?.status === 'failed'
    );

    const nextRetryAt = failedCall[1].$set.nextRetryAt;
    const expectedDelay = getNextRetryDelay(0); // 2000ms for attempt 0
    const expectedTime = Date.now() + expectedDelay;

    // Allow 1 second tolerance for test execution time
    expect(Math.abs(nextRetryAt.getTime() - expectedTime)).toBeLessThan(1000);
  });

  test('Meta failure does not prevent BigQuery from receiving event', async () => {
    mockSendMetaPurchase.mockRejectedValue(new Error('Meta CAPI error'));
    mockFindEligible.mockResolvedValue([buildMockEvent({ attempts: 0 })]);

    await processAnalyticsQueue();

    // BigQuery should still have been called
    expect(mockStreamEventToBigQuery).toHaveBeenCalledTimes(1);
  });

  test('records per-platform results when partial failure occurs', async () => {
    mockSendGA4Purchase.mockRejectedValue(new Error('GA4 error'));
    mockSendMetaPurchase.mockResolvedValue({ success: true });
    mockStreamEventToBigQuery.mockResolvedValue({ success: true });
    mockFindEligible.mockResolvedValue([buildMockEvent({ attempts: 0 })]);

    await processAnalyticsQueue();

    const updateCall = mockFindByIdAndUpdate.mock.calls.find(
      call => call[1]?.$set?.status === 'failed'
    );

    const platforms = updateCall[1].$set.platforms;
    expect(platforms.ga4.success).toBe(false);
    expect(platforms.meta.success).toBe(true);
    expect(platforms.bigquery.success).toBe(true);
  });
});

// ─── processAnalyticsQueue — dead-letter ──────────────────────────────────────

describe('processAnalyticsQueue — dead-letter', () => {
  test('moves to dead_letter when attempts reach maxAttempts', async () => {
    mockSendGA4Purchase.mockRejectedValue(new Error('GA4 timeout'));
    // attempts: 2, maxAttempts: 3 → after this failure, newAttempts = 3 = maxAttempts
    mockFindEligible.mockResolvedValue([buildMockEvent({ attempts: 2, maxAttempts: 3 })]);

    const summary = await processAnalyticsQueue();

    expect(summary.deadLettered).toBe(1);

    const deadLetterCall = mockFindByIdAndUpdate.mock.calls.find(
      call => call[1]?.$set?.status === 'dead_letter'
    );
    expect(deadLetterCall).toBeTruthy();
  });

  test('sends Cron alert when event moves to dead_letter', async () => {
    mockSendGA4Purchase.mockRejectedValue(new Error('GA4 timeout'));
    mockFindEligible.mockResolvedValue([buildMockEvent({ attempts: 2, maxAttempts: 3 })]);

    await processAnalyticsQueue();

    expect(mockSendCronAlert).toHaveBeenCalledTimes(1);
    expect(mockSendCronAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        jobName: 'AnalyticsQueue',
        status:  'dead_letter',
      })
    );
  });

  test('Cron alert failure does not crash the queue', async () => {
    mockSendGA4Purchase.mockRejectedValue(new Error('GA4 timeout'));
    mockSendCronAlert.mockRejectedValue(new Error('Cron alert unavailable'));
    mockFindEligible.mockResolvedValue([buildMockEvent({ attempts: 2, maxAttempts: 3 })]);

    await expect(processAnalyticsQueue()).resolves.not.toThrow();
  });

  test('does not retry dead_letter events automatically', async () => {
    // dead_letter events are filtered out by findEligible (status not in pending/failed)
    mockFindEligible.mockResolvedValue([]); // Simulates no eligible events

    const summary = await processAnalyticsQueue();

    expect(summary.processed).toBe(0);
    expect(mockSendGA4Purchase).not.toHaveBeenCalled();
  });
});

// ─── retryDeadLetterEvents ────────────────────────────────────────────────────

describe('retryDeadLetterEvents', () => {
  test('resets all dead_letter events to pending', async () => {
    mockUpdateMany.mockResolvedValue({ modifiedCount: 3 });

    const count = await retryDeadLetterEvents();

    expect(count).toBe(3);
    expect(mockUpdateMany).toHaveBeenCalledWith(
      { status: 'dead_letter' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status:   'pending',
          attempts: 0,
        }),
      })
    );
  });

  test('filters by eventType when provided', async () => {
    mockUpdateMany.mockResolvedValue({ modifiedCount: 1 });

    await retryDeadLetterEvents('purchase');

    expect(mockUpdateMany).toHaveBeenCalledWith(
      { status: 'dead_letter', eventType: 'purchase' },
      expect.any(Object)
    );
  });

  test('sets nextRetryAt to now (immediately eligible)', async () => {
    mockUpdateMany.mockResolvedValue({ modifiedCount: 1 });

    const before = Date.now();
    await retryDeadLetterEvents();
    const after = Date.now();

    const updateCall = mockUpdateMany.mock.calls[0][1];
    const nextRetryAt = updateCall.$set.nextRetryAt.getTime();
    expect(nextRetryAt).toBeGreaterThanOrEqual(before);
    expect(nextRetryAt).toBeLessThanOrEqual(after);
  });
});

// ─── purgeCompletedEvents ─────────────────────────────────────────────────────

describe('purgeCompletedEvents', () => {
  test('deletes completed events older than given days', async () => {
    mockDeleteMany.mockResolvedValue({ deletedCount: 15 });

    const count = await purgeCompletedEvents(30);

    expect(count).toBe(15);
    expect(mockDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        completedAt: expect.objectContaining({ $lt: expect.any(Date) }),
      })
    );
  });

  test('defaults to 30 days when no argument provided', async () => {
    mockDeleteMany.mockResolvedValue({ deletedCount: 0 });

    await purgeCompletedEvents();

    const filter = mockDeleteMany.mock.calls[0][0];
    const cutoff = filter.completedAt.$lt;
    const expectedCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoff.getTime() - expectedCutoff)).toBeLessThan(1000);
  });

  test('does not delete dead_letter events', async () => {
    mockDeleteMany.mockResolvedValue({ deletedCount: 0 });

    await purgeCompletedEvents();

    const filter = mockDeleteMany.mock.calls[0][0];
    expect(filter.status).toBe('completed'); // Only completed, not dead_letter
  });
});
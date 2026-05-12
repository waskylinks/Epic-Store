/**
 * backend/services/analytics/__tests__/bigQueryService.test.js
 *
 * Phase 7 — Test Suite for bigQueryService.js
 *
 * Run with:
 *   npx jest services/analytics/__tests__/bigQueryService.test.js --verbose
 *
 * Tests validate:
 *   1. streamEventToBigQuery — routes events to correct tables
 *   2. Row transformation — correct field mapping for each table
 *   3. Table routing — purchase → attribution_snapshots, checkout → funnel_states
 *   4. insertId deduplication — event_id used as insertId
 *   5. initializeBigQuerySchema — creates tables, idempotent on existing
 *   6. checkBigQueryConfig — env validation, dataset connectivity
 *   7. Error handling — missing config, insert failures
 *   8. toTimestamp — date normalization, null handling
 */

import { jest } from '@jest/globals';

// ─── MOCK @google-cloud/bigquery ──────────────────────────────────────────────
// Must use unstable_mockModule for ESM — jest.mock() hoisting does not work
// with native ES modules. Imports of the service are deferred below so they
// receive the mocked BigQuery binding.

const mockTableInsert        = jest.fn();
const mockTableExists        = jest.fn();
const mockDatasetCreateTable = jest.fn();
const mockDatasetExists      = jest.fn();
const mockDatasetTable       = jest.fn();

jest.unstable_mockModule('@google-cloud/bigquery', () => ({
  BigQuery: jest.fn().mockImplementation(() => ({
    dataset: jest.fn().mockReturnValue({
      table:       mockDatasetTable,
      exists:      mockDatasetExists,
      createTable: mockDatasetCreateTable,
    }),
  })),
}));

// Deferred imports — must come AFTER jest.unstable_mockModule()
const {
  streamEventToBigQuery,
  initializeBigQuerySchema,
  checkBigQueryConfig,
  resetBigQueryClient,
  TABLE_SCHEMAS,
} = await import('../bigQueryService.js');

// ─── SETUP ────────────────────────────────────────────────────────────────────

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();

  // resetBigQueryClient() forces the lazy singleton to re-instantiate so it
  // picks up the mock constructor on the next call rather than caching the
  // real BigQuery instance created before the mock was wired.
  resetBigQueryClient();

  // mockDatasetTable return value must be re-set after clearAllMocks() wipes it
  mockDatasetTable.mockReturnValue({
    exists: mockTableExists,
    insert: mockTableInsert,
  });

  process.env.BIGQUERY_PROJECT_ID            = 'epicstore-test';
  process.env.BIGQUERY_DATASET_ID            = 'epicstore_analytics_test';
  process.env.GOOGLE_APPLICATION_CREDENTIALS = './credentials/bigquery.json';

  // Default: successful inserts
  mockTableInsert.mockResolvedValue([{}]);
  mockTableExists.mockResolvedValue([false]); // table does not exist → create
  mockDatasetCreateTable.mockResolvedValue([{}]);
  mockDatasetExists.mockResolvedValue([true]);
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const buildMockEvent = (overrides = {}) => ({
  event_id:             'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  event_type:           'purchase',
  event_source:         'server',
  schema_version:       '1.0',
  event_time_client:    '2024-01-15T12:00:00.000Z',
  event_time_server:    '2024-01-15T12:00:01.000Z',
  event_time_processed: null,
  user_id:              'user_123',
  anonymous_id:         'anon_456',
  session_id:           'sess_789',
  attribution: {
    source:              'google',
    medium:              'cpc',
    campaign:            'summer_sale',
    referrer:            'https://google.com',
    landing_page:        '/products/sneakers',
    gclid:               'test_gclid',
    fbclid:              null,
    ttclid:              null,
    confidence_score:    0.90,
    confidence_level:    'HIGH',
    is_reconstructed:    false,
    reconstruction_rule: null,
    device:              'desktop',
    browser:             'Chrome',
  },
  properties: {
    order_id:          'order_123',
    payment_reference: 'PAY_REF_123',
    revenue:           224.97,
    currency:          'USD',
    is_first_purchase: true,
    purchase_number:   1,
    item_count:        2,
    coupon:            null,
    items: [
      { item_id: 'product_abc', item_name: 'Blue Sneakers', price: 99.99, quantity: 2 },
    ],
  },
  ...overrides,
});

// ─── streamEventToBigQuery — table routing ────────────────────────────────────

describe('streamEventToBigQuery — table routing', () => {
  test('always inserts into events table for any event type', async () => {
    await streamEventToBigQuery(buildMockEvent());

    expect(mockTableInsert).toHaveBeenCalled();
    const tableNames = mockDatasetTable.mock.calls.map(call => call[0]);
    expect(tableNames).toContain('events');
  });

  test('inserts into attribution_snapshots for purchase events', async () => {
    await streamEventToBigQuery(buildMockEvent({ event_type: 'purchase' }));

    const tableNames = mockDatasetTable.mock.calls.map(call => call[0]);
    expect(tableNames).toContain('attribution_snapshots');
  });

  test('does NOT insert into attribution_snapshots for non-purchase events', async () => {
    await streamEventToBigQuery(buildMockEvent({ event_type: 'login' }));

    const tableNames = mockDatasetTable.mock.calls.map(call => call[0]);
    expect(tableNames).not.toContain('attribution_snapshots');
  });

  test('inserts into funnel_states for checkout_step events', async () => {
    await streamEventToBigQuery(buildMockEvent({
      event_type: 'checkout_step',
      properties: {
        checkout_id:  'checkout_123',
        step:         'shipping_info',
        cart_value:   99.99,
        item_count:   2,
        currency:     'USD',
        has_discount: false,
      },
    }));

    const tableNames = mockDatasetTable.mock.calls.map(call => call[0]);
    expect(tableNames).toContain('funnel_states');
  });

  test('inserts into funnel_states for begin_checkout events', async () => {
    await streamEventToBigQuery(buildMockEvent({ event_type: 'begin_checkout' }));

    const tableNames = mockDatasetTable.mock.calls.map(call => call[0]);
    expect(tableNames).toContain('funnel_states');
  });

  test('sets abandoned: true in funnel_states for checkout_abandon events', async () => {
    await streamEventToBigQuery(buildMockEvent({
      event_type: 'checkout_abandon',
      properties: { checkout_id: 'co_123', step: 'payment_selection', cart_value: 50 },
    }));

    const tableNames  = mockDatasetTable.mock.calls.map(call => call[0]);
    const funnelIndex = tableNames.indexOf('funnel_states');
    expect(funnelIndex).toBeGreaterThan(-1);

    const funnelInsertCall = mockTableInsert.mock.calls[funnelIndex];
    const insertedRow      = funnelInsertCall[0][0].json;
    expect(insertedRow.abandoned).toBe(true);
  });

  test('returns success result with tablesWritten', async () => {
    const result = await streamEventToBigQuery(buildMockEvent());

    expect(result.success).toBe(true);
    expect(result.eventId).toBe('f47ac10b-58cc-4372-a567-0e02b2c3d479');
    expect(result.insertedAt).toBeTruthy();
  });
});

// ─── events table row transformation ─────────────────────────────────────────

describe('events table row transformation', () => {
  test('maps event_id correctly', async () => {
    await streamEventToBigQuery(buildMockEvent());

    const eventsTableIndex = mockDatasetTable.mock.calls.findIndex(c => c[0] === 'events');
    const insertCall       = mockTableInsert.mock.calls[eventsTableIndex];
    const row              = insertCall[0][0].json;

    expect(row.event_id).toBe('f47ac10b-58cc-4372-a567-0e02b2c3d479');
  });

  test('maps attribution fields correctly', async () => {
    await streamEventToBigQuery(buildMockEvent());

    const eventsTableIndex = mockDatasetTable.mock.calls.findIndex(c => c[0] === 'events');
    const row              = mockTableInsert.mock.calls[eventsTableIndex][0][0].json;

    expect(row.source).toBe('google');
    expect(row.medium).toBe('cpc');
    expect(row.campaign).toBe('summer_sale');
    expect(row.gclid).toBe('test_gclid');
    expect(row.confidence_score).toBe(0.90);
    expect(row.confidence_level).toBe('HIGH');
    expect(row.is_reconstructed).toBe(false);
  });

  test('maps user identity fields correctly', async () => {
    await streamEventToBigQuery(buildMockEvent());

    const eventsTableIndex = mockDatasetTable.mock.calls.findIndex(c => c[0] === 'events');
    const row              = mockTableInsert.mock.calls[eventsTableIndex][0][0].json;

    expect(row.user_id).toBe('user_123');
    expect(row.anonymous_id).toBe('anon_456');
    expect(row.session_id).toBe('sess_789');
  });

  test('sets event_time_processed to current time', async () => {
    const before = new Date().toISOString();
    await streamEventToBigQuery(buildMockEvent());
    const after  = new Date().toISOString();

    const eventsTableIndex = mockDatasetTable.mock.calls.findIndex(c => c[0] === 'events');
    const row              = mockTableInsert.mock.calls[eventsTableIndex][0][0].json;

    expect(typeof row.event_time_processed).toBe('string');
    expect(row.event_time_processed >= before).toBe(true);
    expect(row.event_time_processed <= after).toBe(true);
  });

  test('serializes properties as JSON string', async () => {
    await streamEventToBigQuery(buildMockEvent());

    const eventsTableIndex = mockDatasetTable.mock.calls.findIndex(c => c[0] === 'events');
    const row              = mockTableInsert.mock.calls[eventsTableIndex][0][0].json;

    expect(typeof row.properties).toBe('string');
    const parsed = JSON.parse(row.properties);
    expect(parsed.revenue).toBe(224.97);
  });

  test('defaults source to "direct" when attribution is missing', async () => {
    await streamEventToBigQuery(buildMockEvent({ attribution: null }));

    const eventsTableIndex = mockDatasetTable.mock.calls.findIndex(c => c[0] === 'events');
    const row              = mockTableInsert.mock.calls[eventsTableIndex][0][0].json;

    expect(row.source).toBe('direct');
  });

  test('handles null attribution fields gracefully', async () => {
    await streamEventToBigQuery(buildMockEvent({
      attribution: { source: null, medium: null, confidence_score: null },
    }));

    const eventsTableIndex = mockDatasetTable.mock.calls.findIndex(c => c[0] === 'events');
    const row              = mockTableInsert.mock.calls[eventsTableIndex][0][0].json;

    expect(row.source).toBe('direct');
    expect(row.medium).toBeNull();
  });
});

// ─── attribution_snapshots row transformation ─────────────────────────────────

describe('attribution_snapshots row transformation', () => {
  test('maps order_id from properties', async () => {
    await streamEventToBigQuery(buildMockEvent({ event_type: 'purchase' }));

    const snapIndex = mockDatasetTable.mock.calls.findIndex(c => c[0] === 'attribution_snapshots');
    const row       = mockTableInsert.mock.calls[snapIndex][0][0].json;

    expect(row.order_id).toBe('order_123');
    expect(row.payment_reference).toBe('PAY_REF_123');
  });

  test('maps revenue and currency', async () => {
    await streamEventToBigQuery(buildMockEvent({ event_type: 'purchase' }));

    const snapIndex = mockDatasetTable.mock.calls.findIndex(c => c[0] === 'attribution_snapshots');
    const row       = mockTableInsert.mock.calls[snapIndex][0][0].json;

    expect(row.revenue).toBe(224.97);
    expect(row.currency).toBe('USD');
  });

  test('maps is_first_purchase and purchase_number', async () => {
    await streamEventToBigQuery(buildMockEvent({ event_type: 'purchase' }));

    const snapIndex = mockDatasetTable.mock.calls.findIndex(c => c[0] === 'attribution_snapshots');
    const row       = mockTableInsert.mock.calls[snapIndex][0][0].json;

    expect(row.is_first_purchase).toBe(true);
    expect(row.purchase_number).toBe(1);
  });

  test('maps confidence data for attribution quality analysis', async () => {
    await streamEventToBigQuery(buildMockEvent({ event_type: 'purchase' }));

    const snapIndex = mockDatasetTable.mock.calls.findIndex(c => c[0] === 'attribution_snapshots');
    const row       = mockTableInsert.mock.calls[snapIndex][0][0].json;

    expect(row.confidence_score).toBe(0.90);
    expect(row.confidence_level).toBe('HIGH');
    expect(row.is_reconstructed).toBe(false);
  });
});

// ─── funnel_states row transformation ────────────────────────────────────────

describe('funnel_states row transformation', () => {
  const checkoutEvent = buildMockEvent({
    event_type: 'checkout_step',
    properties: {
      checkout_id:  'checkout_123',
      step:         'shipping_info',
      cart_value:   150.00,
      item_count:   3,
      currency:     'USD',
      has_discount: true,
    },
  });

  test('maps step name', async () => {
    await streamEventToBigQuery(checkoutEvent);

    const funnelIndex = mockDatasetTable.mock.calls.findIndex(c => c[0] === 'funnel_states');
    const row         = mockTableInsert.mock.calls[funnelIndex][0][0].json;

    expect(row.step).toBe('shipping_info');
  });

  test('maps step_number (shipping_info = 1)', async () => {
    await streamEventToBigQuery(checkoutEvent);

    const funnelIndex = mockDatasetTable.mock.calls.findIndex(c => c[0] === 'funnel_states');
    const row         = mockTableInsert.mock.calls[funnelIndex][0][0].json;

    expect(row.step_number).toBe(1);
  });

  test('maps cart_value and item_count', async () => {
    await streamEventToBigQuery(checkoutEvent);

    const funnelIndex = mockDatasetTable.mock.calls.findIndex(c => c[0] === 'funnel_states');
    const row         = mockTableInsert.mock.calls[funnelIndex][0][0].json;

    expect(row.cart_value).toBe(150.00);
    expect(row.item_count).toBe(3);
    expect(row.has_discount).toBe(true);
  });
});

// ─── insertId deduplication ───────────────────────────────────────────────────

describe('insertId deduplication', () => {
  test('uses event_id as insertId for events table', async () => {
    await streamEventToBigQuery(buildMockEvent());

    const eventsTableIndex = mockDatasetTable.mock.calls.findIndex(c => c[0] === 'events');
    const rawRows          = mockTableInsert.mock.calls[eventsTableIndex][0];

    expect(rawRows[0].insertId).toContain('f47ac10b-58cc-4372-a567-0e02b2c3d479');
  });

  test('includes table name in insertId for uniqueness across tables', async () => {
    await streamEventToBigQuery(buildMockEvent({ event_type: 'purchase' }));

    const eventsIndex = mockDatasetTable.mock.calls.findIndex(c => c[0] === 'events');
    const snapIndex   = mockDatasetTable.mock.calls.findIndex(c => c[0] === 'attribution_snapshots');

    const eventsInsertId = mockTableInsert.mock.calls[eventsIndex][0][0].insertId;
    const snapInsertId   = mockTableInsert.mock.calls[snapIndex][0][0].insertId;

    expect(eventsInsertId).not.toBe(snapInsertId);
    expect(eventsInsertId).toContain('events');
    expect(snapInsertId).toContain('attribution_snapshots');
  });
});

// ─── initializeBigQuerySchema ─────────────────────────────────────────────────

describe('initializeBigQuerySchema', () => {
  test('creates all five tables when they do not exist', async () => {
    mockTableExists.mockResolvedValue([false]);

    await initializeBigQuerySchema();

    expect(mockDatasetCreateTable).toHaveBeenCalledTimes(5);
    const createdTables = mockDatasetCreateTable.mock.calls.map(call => call[0]);
    expect(createdTables).toContain('events');
    expect(createdTables).toContain('sessions');
    expect(createdTables).toContain('users');
    expect(createdTables).toContain('attribution_snapshots');
    expect(createdTables).toContain('funnel_states');
  });

  test('does NOT create tables that already exist', async () => {
    mockTableExists.mockResolvedValue([true]);

    await initializeBigQuerySchema();

    expect(mockDatasetCreateTable).not.toHaveBeenCalled();
  });

  test('creates only missing tables when some exist', async () => {
    let callCount = 0;
    mockTableExists.mockImplementation(() => {
      callCount++;
      return Promise.resolve([callCount <= 2]);
    });

    await initializeBigQuerySchema();

    expect(mockDatasetCreateTable).toHaveBeenCalledTimes(3);
  });

  test('does not throw when BIGQUERY_PROJECT_ID is missing', async () => {
    delete process.env.BIGQUERY_PROJECT_ID;

    await expect(initializeBigQuerySchema()).resolves.not.toThrow();

    process.env.BIGQUERY_PROJECT_ID = 'epicstore-test';
  });

  test('does not throw when a single table creation fails', async () => {
    mockTableExists.mockResolvedValue([false]);
    mockDatasetCreateTable.mockRejectedValueOnce(new Error('Permission denied'));

    await expect(initializeBigQuerySchema()).resolves.not.toThrow();
  });
});

// ─── checkBigQueryConfig ─────────────────────────────────────────────────────

describe('checkBigQueryConfig', () => {
  test('returns configured: true and connected: true when all env vars set and dataset exists', async () => {
    mockDatasetExists.mockResolvedValue([true]);

    const result = await checkBigQueryConfig();

    expect(result.configured).toBe(true);
    expect(result.connected).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  test('returns configured: false when BIGQUERY_PROJECT_ID missing', async () => {
    delete process.env.BIGQUERY_PROJECT_ID;

    const result = await checkBigQueryConfig();

    expect(result.configured).toBe(false);
    expect(result.missing).toContain('BIGQUERY_PROJECT_ID');

    process.env.BIGQUERY_PROJECT_ID = 'epicstore-test';
  });

  test('returns connected: false when dataset does not exist', async () => {
    mockDatasetExists.mockResolvedValue([false]);

    const result = await checkBigQueryConfig();

    expect(result.connected).toBe(false);
  });

  test('returns connected: false with error message on BigQuery connection failure', async () => {
    mockDatasetExists.mockRejectedValue(new Error('Authentication failed'));

    const result = await checkBigQueryConfig();

    expect(result.connected).toBe(false);
    expect(result.error).toBe('Authentication failed');
  });

  test('includes datasetId and projectId in result', async () => {
    mockDatasetExists.mockResolvedValue([true]);

    const result = await checkBigQueryConfig();

    expect(result.datasetId).toBe('epicstore_analytics_test');
    expect(result.projectId).toBe('epicstore-test');
  });
});

// ─── Error handling ───────────────────────────────────────────────────────────

describe('Error handling', () => {
  test('throws when BIGQUERY_PROJECT_ID is not configured', async () => {
    delete process.env.BIGQUERY_PROJECT_ID;

    await expect(
      streamEventToBigQuery(buildMockEvent())
    ).rejects.toThrow('BIGQUERY_PROJECT_ID');

    process.env.BIGQUERY_PROJECT_ID = 'epicstore-test';
  });

  test('throws when event_id is missing', async () => {
    await expect(
      streamEventToBigQuery({ ...buildMockEvent(), event_id: null })
    ).rejects.toThrow('event_id is required');
  });

  test('throws when BigQuery insert fails', async () => {
    mockTableInsert.mockRejectedValue(new Error('BigQuery insert failed'));

    await expect(
      streamEventToBigQuery(buildMockEvent())
    ).rejects.toThrow('BigQuery insert failed');
  });
});

// ─── TABLE_SCHEMAS export ─────────────────────────────────────────────────────

describe('TABLE_SCHEMAS', () => {
  test('exports schemas for all five tables', () => {
    expect(TABLE_SCHEMAS).toHaveProperty('events');
    expect(TABLE_SCHEMAS).toHaveProperty('sessions');
    expect(TABLE_SCHEMAS).toHaveProperty('users');
    expect(TABLE_SCHEMAS).toHaveProperty('attribution_snapshots');
    expect(TABLE_SCHEMAS).toHaveProperty('funnel_states');
  });

  test('events schema has required event_id field', () => {
    const eventIdField = TABLE_SCHEMAS.events.fields.find(f => f.name === 'event_id');
    expect(eventIdField).toBeTruthy();
    expect(eventIdField.mode).toBe('REQUIRED');
  });

  test('all schemas have a timePartitioningField', () => {
    Object.entries(TABLE_SCHEMAS).forEach(([name, schema]) => {
      expect(schema.timePartitioningField).toBeTruthy();
    });
  });
});
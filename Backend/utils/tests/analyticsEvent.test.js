/**
 * backend/utils/__tests__/analyticsEvent.test.js
 *
 * Phase 1 — Test Suite for analyticsEvent.js
 *
 * Run with:
 *   node --experimental-vm-modules node_modules/.bin/jest utils/__tests__/analyticsEvent.test.js
 *
 * Or add to package.json scripts:
 *   "test:analytics": "jest utils/__tests__/analyticsEvent.test.js --verbose"
 *
 * These tests validate the three guarantees Phase 1 makes:
 *   1. UUID primary path — valid client UUIDs are preserved unchanged
 *   2. Hash fallback — same inputs always produce same output
 *   3. Event schema — all required fields are present and correctly typed
 *   4. Deduplication safety — same event_id cannot be generated twice
 *      by different calls with different timestamps (UUIDs are random,
 *      not timestamp-based — this is the key property)
 */

import { v4 as uuidv4 } from 'uuid';

import {
  generateEventId,
  isValidUUID,
  buildAnalyticsEvent,
  buildPurchaseEvent,
  buildCheckoutStepEvent,
  validateAnalyticsEvent,
  ANALYTICS_EVENTS,
} from '../analyticsEvent.js';

// ─── isValidUUID ──────────────────────────────────────────────────────────────

describe('isValidUUID', () => {
  test('accepts a valid UUID v4', () => {
    // real non-v4 UUID (v1 example
    expect(isValidUUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(false);
    // correct expectation
    expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  test('rejects null, undefined, empty string', () => {
    expect(isValidUUID(null)).toBe(false);
    expect(isValidUUID(undefined)).toBe(false);
    expect(isValidUUID('')).toBe(false);
  });

  test('rejects malformed UUIDs', () => {
    expect(isValidUUID('not-a-uuid')).toBe(false);
    expect(isValidUUID('12345678-1234-1234-1234-12345678')).toBe(false); // too short
    expect(isValidUUID('12345678-1234-5234-a234-123456789012')).toBe(false); // v5, not v4
  });
});

// ─── generateEventId ──────────────────────────────────────────────────────────

describe('generateEventId', () => {
  test('returns the client UUID unchanged when valid', () => {
    const clientUUID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    expect(generateEventId(clientUUID)).toBe(clientUUID);
  });

  test('falls back to hash when clientUUID is null', () => {
    const id = generateEventId(null, {
      userId: 'user123',
      timestamp: 1700000000000,
      eventType: 'purchase',
    });
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
    expect(id.length).toBe(32); // SHA-256 truncated to 32 hex chars
  });

  test('hash fallback is deterministic — same inputs produce same output', () => {
    const parts = { userId: 'user123', timestamp: 1700000000000, eventType: 'purchase' };
    const id1 = generateEventId(null, parts);
    const id2 = generateEventId(null, parts);
    expect(id1).toBe(id2);
  });

  test('hash fallback produces DIFFERENT output for different inputs', () => {
    const id1 = generateEventId(null, { userId: 'user1', timestamp: 1700000000000, eventType: 'purchase' });
    const id2 = generateEventId(null, { userId: 'user2', timestamp: 1700000000000, eventType: 'purchase' });
    expect(id1).not.toBe(id2);
  });

  test('falls back to hash when clientUUID is an invalid format', () => {
    const id = generateEventId('not-a-valid-uuid', {
      userId: 'user123',
      timestamp: 1700000000000,
      eventType: 'purchase',
    });
    // Should NOT return the invalid UUID — should return a hash
    expect(id).not.toBe('not-a-valid-uuid');
    expect(id.length).toBe(32);
  });

  test('UUID primary path does not depend on timestamp (no clock skew issue)', () => {
    const clientUUID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    // Even if called at different times, same UUID is returned
    const id1 = generateEventId(clientUUID, { timestamp: Date.now() });
    const id2 = generateEventId(clientUUID, { timestamp: Date.now() + 5000 });
    expect(id1).toBe(id2);
    expect(id1).toBe(clientUUID);
  });
});

// ─── buildAnalyticsEvent ──────────────────────────────────────────────────────

describe('buildAnalyticsEvent', () => {
  const baseParams = {
    eventType:   'purchase',
    eventId:     'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    userId:      'user_123',
    anonymousId: 'anon_456',
    sessionId:   'session_789',
    source:      'server',
    properties:  { revenue: 99.99, currency: 'USD' },
    attribution: {
      source:           'google',
      medium:           'cpc',
      campaign:         'summer_sale',
      confidenceScore:  0.7,
      confidenceLevel:  'MEDIUM',
      isReconstructed:  false,
      gclid:            'abc123',
    },
    clientTimestamp: '2024-01-15T12:00:00.000Z',
  };

  test('preserves the client UUID as event_id', () => {
    const event = buildAnalyticsEvent(baseParams);
    expect(event.event_id).toBe('f47ac10b-58cc-4372-a567-0e02b2c3d479');
  });

  test('sets all required fields', () => {
    const event = buildAnalyticsEvent(baseParams);
    expect(event.event_id).toBeTruthy();
    expect(event.event_type).toBe('purchase');
    expect(event.event_source).toBe('server');
    expect(event.event_time_client).toBeTruthy();
    expect(event.event_time_server).toBeTruthy();
    expect(event.schema_version).toBe('1.0');
  });

  test('event_time_processed is null (set by queue worker later)', () => {
    const event = buildAnalyticsEvent(baseParams);
    expect(event.event_time_processed).toBeNull();
  });

  test('uses clientTimestamp as event_time_client when provided', () => {
    const event = buildAnalyticsEvent(baseParams);
    expect(event.event_time_client).toBe('2024-01-15T12:00:00.000Z');
  });

  test('falls back to server time when clientTimestamp is null', () => {
    const event = buildAnalyticsEvent({ ...baseParams, clientTimestamp: null });
    expect(event.event_time_client).toBeTruthy();
    // Should be a valid ISO string close to now
    expect(new Date(event.event_time_client).getTime()).toBeGreaterThan(0);
  });

  test('populates user_id, anonymous_id, session_id correctly', () => {
    const event = buildAnalyticsEvent(baseParams);
    expect(event.user_id).toBe('user_123');
    expect(event.anonymous_id).toBe('anon_456');
    expect(event.session_id).toBe('session_789');
  });

  test('nulls out identity fields when not provided', () => {
    const event = buildAnalyticsEvent({
      ...baseParams,
      userId: null,
      anonymousId: null,
      sessionId: null,
    });
    expect(event.user_id).toBeNull();
    expect(event.anonymous_id).toBeNull();
    expect(event.session_id).toBeNull();
  });

  test('correctly maps attribution fields', () => {
    const event = buildAnalyticsEvent(baseParams);
    expect(event.attribution.source).toBe('google');
    expect(event.attribution.medium).toBe('cpc');
    expect(event.attribution.confidence_score).toBe(0.7);
    expect(event.attribution.confidence_level).toBe('MEDIUM');
    expect(event.attribution.is_reconstructed).toBe(false);
    expect(event.attribution.gclid).toBe('abc123');
  });

  test('defaults attribution.source to "direct" when empty', () => {
    const event = buildAnalyticsEvent({ ...baseParams, attribution: {} });
    expect(event.attribution.source).toBe('direct');
  });

  test('defaults event_source to "server"', () => {
    const { source: _source, ...paramsWithoutSource } = baseParams;
    const event = buildAnalyticsEvent(paramsWithoutSource);
    expect(event.event_source).toBe('server');
  });

  test('accepts "client" as event_source', () => {
    const event = buildAnalyticsEvent({ ...baseParams, source: 'client' });
    expect(event.event_source).toBe('client');
  });

  test('two calls with same UUID produce events with same event_id', () => {
    const uuid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    const event1 = buildAnalyticsEvent({ ...baseParams, eventId: uuid });
    const event2 = buildAnalyticsEvent({ ...baseParams, eventId: uuid });
    // This is the deduplication guarantee: same UUID → same event_id
    expect(event1.event_id).toBe(event2.event_id);
  });
});

// ─── validateAnalyticsEvent ───────────────────────────────────────────────────

describe('validateAnalyticsEvent', () => {
  test('passes for a fully populated event', () => {
    const event = buildAnalyticsEvent({
      eventType:   'purchase',
      eventId:     'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      userId:      'user_123',
      anonymousId: 'anon_456',
      source:      'server',
    });
    const result = validateAnalyticsEvent(event);
    expect(result.valid).toBe(true);
    expect(result.errors.filter(e => !e.startsWith('WARNING'))).toHaveLength(0);
  });

  test('fails when event_id is missing', () => {
    const event = buildAnalyticsEvent({
      eventType: 'purchase',
      source:    'server',
    });
    event.event_id = null; // Force remove after build
    const result = validateAnalyticsEvent(event);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('event_id'))).toBe(true);
  });

  test('warns when both user_id and anonymous_id are null', () => {
    const event = buildAnalyticsEvent({
      eventType:   'purchase',
      eventId:     'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      userId:      null,
      anonymousId: null,
      source:      'server',
    });
    const result = validateAnalyticsEvent(event);
    // Should be valid (warning, not error) but include a warning
    expect(result.valid).toBe(true);
    expect(result.errors.some(e => e.startsWith('WARNING'))).toBe(true);
  });

  test('fails for invalid event_source', () => {
    const event = buildAnalyticsEvent({
      eventType: 'purchase',
      eventId:   'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      source:    'server',
    });
    event.event_source = 'invalid_source';
    const result = validateAnalyticsEvent(event);
    expect(result.valid).toBe(false);
  });
});

// ─── ANALYTICS_EVENTS constants ───────────────────────────────────────────────

describe('ANALYTICS_EVENTS', () => {
  test('exports all required event type constants', () => {
    expect(ANALYTICS_EVENTS.PURCHASE).toBe('purchase');
    expect(ANALYTICS_EVENTS.BEGIN_CHECKOUT).toBe('begin_checkout');
    expect(ANALYTICS_EVENTS.ADD_TO_CART).toBe('add_to_cart');
    expect(ANALYTICS_EVENTS.LOGIN).toBe('login');
    expect(ANALYTICS_EVENTS.SIGN_UP).toBe('sign_up');
  });

  test('all event type values are lowercase strings', () => {
    Object.values(ANALYTICS_EVENTS).forEach(value => {
      expect(typeof value).toBe('string');
      expect(value).toBe(value.toLowerCase());
    });
  });
});

// ─── DEDUPLICATION GUARANTEE ──────────────────────────────────────────────────

describe('Deduplication guarantee', () => {
  test('100 generateEventId calls produce 100 unique IDs (no collision)', () => {
    // This test validates the UUID primary path specifically
    // UUIDs are random — probability of collision is astronomically low
    // but we test it to document the guarantee

    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      ids.add(generateEventId(uuidv4()));
    }
    expect(ids.size).toBe(100);
  });

  test('same client UUID passed twice produces same event_id both times', () => {
    const clientUUID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    // Simulates: browser sends same UUID to both /checkout and /order endpoints
    // Both server events should carry the same event_id for GA4/Meta dedup
    const id1 = generateEventId(clientUUID);
    const id2 = generateEventId(clientUUID);
    expect(id1).toBe(id2);
    expect(id1).toBe(clientUUID);
  });

  test('auth state change does not affect UUID-based event_id', () => {
    const clientUUID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    // Before auth: userId = null
    const idBeforeAuth = generateEventId(clientUUID, { userId: null, eventType: 'purchase' });
    // After auth: userId = 'user_123'
    const idAfterAuth  = generateEventId(clientUUID, { userId: 'user_123', eventType: 'purchase' });
    // Both should return the client UUID unchanged — userId in fallbackParts is ignored
    expect(idBeforeAuth).toBe(clientUUID);
    expect(idAfterAuth).toBe(clientUUID);
    expect(idBeforeAuth).toBe(idAfterAuth);
  });
});
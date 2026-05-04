/**
 * frontend/src/utils/__tests__/analytics.test.js
 *
 * Phase 1 — Test Suite for frontend/src/utils/analytics.js
 *
 * Run with:
 *   npx vitest run src/utils/__tests__/analytics.test.js
 *   OR
 *   npx jest src/utils/__tests__/analytics.test.js --verbose
 *
 * These tests validate:
 *   1. Session management — creation, reuse, expiry, cross-tab behaviour
 *   2. UTM capture — idempotency, correct keys, no overwrite on re-visit
 *   3. Click ID capture — stored with timestamp, expiry enforcement
 *   4. Attribution context — complete snapshot with correct fallbacks
 *   5. Meta/GA4 cookie readers — correct parsing of _fbp, _fbc, _ga formats
 *   6. buildClientAnalyticsPayload — all fields present, eventId preserved
 *
 * Note: localStorage is mocked by Jest's jsdom environment automatically.
 * document.cookie requires manual setup — see beforeEach blocks.
 */

import {
  generateEventId,
  getOrCreateSessionId,
  captureUTMsOnLoad,
  captureClickIds,
  getAttributionContext,
  getMetaPixelCookies,
  getGA4ClientId,
  buildClientAnalyticsPayload,
  initAnalytics,
  resetAnalyticsState,
} from '../analytics';

// ─── SETUP ────────────────────────────────────────────────────────────────────

// Storage key constants — mirrors the KEYS object in analytics.js
const KEYS = {
  UTM_SOURCE:   'epic_utm_source',
  UTM_MEDIUM:   'epic_utm_medium',
  UTM_CAMPAIGN: 'epic_utm_campaign',
  UTM_TERM:     'epic_utm_term',
  UTM_CONTENT:  'epic_utm_content',
  UTM_CAPTURED: 'epic_utm_captured',
  LANDING_PAGE: 'epic_landing_page',
  GCLID:        'epic_gclid',
  FBCLID:       'epic_fbclid',
  TTCLID:       'epic_ttclid',
  MSCLKID:      'epic_msclkid',
  SESSION:      'epic_session',
};

beforeEach(() => {
  // Clear localStorage before each test
  localStorage.clear();

  // Reset URL to clean state
  delete window.location;
  window.location = {
    pathname: '/',
    search:   '',
    href:     'http://localhost/',
  };

  // Clear cookies
  document.cookie.split(';').forEach(cookie => {
    const name = cookie.split('=')[0].trim();
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  });
});

// ─── generateEventId ──────────────────────────────────────────────────────────

describe('generateEventId', () => {
  test('returns a valid UUID v4 string', () => {
    const id = generateEventId();
    expect(typeof id).toBe('string');
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  test('returns a different UUID on every call', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateEventId()));
    expect(ids.size).toBe(50);
  });

  test('two calls never produce the same UUID', () => {
    const id1 = generateEventId();
    const id2 = generateEventId();
    expect(id1).not.toBe(id2);
  });
});

// ─── getOrCreateSessionId ─────────────────────────────────────────────────────

describe('getOrCreateSessionId', () => {
  test('creates a new session ID on first call', () => {
    const id = getOrCreateSessionId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  test('returns the same session ID on subsequent calls within TTL', () => {
    const id1 = getOrCreateSessionId();
    const id2 = getOrCreateSessionId();
    expect(id1).toBe(id2);
  });

  test('persists session to localStorage', () => {
    const id = getOrCreateSessionId();
    const stored = JSON.parse(localStorage.getItem(KEYS.SESSION));
    expect(stored.id).toBe(id);
    expect(stored.lastSeen).toBeTruthy();
  });

  test('creates new session when existing session has expired', () => {
    // Manually store an expired session (lastSeen 31 minutes ago)
    const expiredSession = {
      id:       'expired-session-id',
      lastSeen: Date.now() - 31 * 60 * 1000,
    };
    localStorage.setItem(KEYS.SESSION, JSON.stringify(expiredSession));

    const newId = getOrCreateSessionId();
    expect(newId).not.toBe('expired-session-id');
  });

  test('refreshes lastSeen on each call to extend rolling TTL', () => {
    const id1 = getOrCreateSessionId();
    const firstSeen = JSON.parse(localStorage.getItem(KEYS.SESSION)).lastSeen;

    // Small delay to ensure timestamps differ
    jest.advanceTimersByTime ? jest.advanceTimersByTime(100) : null;

    const id2 = getOrCreateSessionId();
    const secondSeen = JSON.parse(localStorage.getItem(KEYS.SESSION)).lastSeen;

    expect(id1).toBe(id2);
    expect(secondSeen).toBeGreaterThanOrEqual(firstSeen);
  });

  test('simulates cross-tab behaviour — same session read from storage', () => {
    // Simulate Tab 1 creating a session
    const sessionFromTab1 = getOrCreateSessionId();

    // Simulate Tab 2 reading the same session (same localStorage)
    // In a real browser both tabs share localStorage
    const sessionFromTab2 = getOrCreateSessionId();

    expect(sessionFromTab1).toBe(sessionFromTab2);
  });
});

// ─── captureUTMsOnLoad ────────────────────────────────────────────────────────

describe('captureUTMsOnLoad', () => {
  test('stores UTM parameters from URL to localStorage', () => {
    window.location.search = '?utm_source=google&utm_medium=cpc&utm_campaign=summer_sale';

    captureUTMsOnLoad();

    expect(localStorage.getItem(KEYS.UTM_SOURCE)).toBe('google');
    expect(localStorage.getItem(KEYS.UTM_MEDIUM)).toBe('cpc');
    expect(localStorage.getItem(KEYS.UTM_CAMPAIGN)).toBe('summer_sale');
  });

  test('stores landing page URL', () => {
    window.location.pathname = '/products/blue-sneakers';
    window.location.search   = '?utm_source=google';

    captureUTMsOnLoad();

    expect(localStorage.getItem(KEYS.LANDING_PAGE)).toBe('/products/blue-sneakers?utm_source=google');
  });

  test('sets the utm_captured sentinel flag', () => {
    captureUTMsOnLoad();
    expect(localStorage.getItem(KEYS.UTM_CAPTURED)).toBe('1');
  });

  test('is idempotent — does NOT overwrite UTMs on second call', () => {
    // First visit: UTMs from landing page
    window.location.search = '?utm_source=google&utm_medium=cpc';
    captureUTMsOnLoad();

    // User navigates to another page (different URL, no UTMs)
    window.location.search = '';
    captureUTMsOnLoad(); // Should NOT overwrite

    expect(localStorage.getItem(KEYS.UTM_SOURCE)).toBe('google');
    expect(localStorage.getItem(KEYS.UTM_MEDIUM)).toBe('cpc');
  });

  test('does not store null UTM values', () => {
    window.location.search = '?utm_source=google'; // Only utm_source present

    captureUTMsOnLoad();

    expect(localStorage.getItem(KEYS.UTM_SOURCE)).toBe('google');
    expect(localStorage.getItem(KEYS.UTM_MEDIUM)).toBeNull();
    expect(localStorage.getItem(KEYS.UTM_CAMPAIGN)).toBeNull();
  });

  test('handles URL with no UTM parameters gracefully', () => {
    window.location.search = '';
    expect(() => captureUTMsOnLoad()).not.toThrow();

    // No UTMs stored, but sentinel and landing page should still be set
    expect(localStorage.getItem(KEYS.UTM_CAPTURED)).toBe('1');
    expect(localStorage.getItem(KEYS.UTM_SOURCE)).toBeNull();
  });
});

// ─── captureClickIds ──────────────────────────────────────────────────────────

describe('captureClickIds', () => {
  test('stores gclid from URL with timestamp', () => {
    window.location.search = '?gclid=Cj0KCQiA_test_gclid';

    captureClickIds();

    const stored = JSON.parse(localStorage.getItem(KEYS.GCLID));
    expect(stored.value).toBe('Cj0KCQiA_test_gclid');
    expect(stored.capturedAt).toBeTruthy();
  });

  test('stores fbclid from URL', () => {
    window.location.search = '?fbclid=AbCdEfGh_test_fbclid';

    captureClickIds();

    const stored = JSON.parse(localStorage.getItem(KEYS.FBCLID));
    expect(stored.value).toBe('AbCdEfGh_test_fbclid');
  });

  test('stores multiple click IDs simultaneously', () => {
    window.location.search = '?gclid=google123&fbclid=meta456&ttclid=tiktok789';

    captureClickIds();

    expect(JSON.parse(localStorage.getItem(KEYS.GCLID)).value).toBe('google123');
    expect(JSON.parse(localStorage.getItem(KEYS.FBCLID)).value).toBe('meta456');
    expect(JSON.parse(localStorage.getItem(KEYS.TTCLID)).value).toBe('tiktok789');
  });

  test('overwrites existing click ID with new one (not idempotent like UTMs)', () => {
    // First ad click
    window.location.search = '?gclid=first_click';
    captureClickIds();

    // Second ad click (different ad, new gclid)
    window.location.search = '?gclid=second_click';
    captureClickIds();

    const stored = JSON.parse(localStorage.getItem(KEYS.GCLID));
    expect(stored.value).toBe('second_click');
  });

  test('does not store click IDs when not in URL', () => {
    window.location.search = '?utm_source=google'; // No click IDs

    captureClickIds();

    expect(localStorage.getItem(KEYS.GCLID)).toBeNull();
    expect(localStorage.getItem(KEYS.FBCLID)).toBeNull();
  });
});

// ─── getAttributionContext ────────────────────────────────────────────────────

describe('getAttributionContext', () => {
  beforeEach(() => {
    // Set up a known state
    localStorage.setItem(KEYS.UTM_SOURCE,   'google');
    localStorage.setItem(KEYS.UTM_MEDIUM,   'cpc');
    localStorage.setItem(KEYS.UTM_CAMPAIGN, 'test_campaign');
    localStorage.setItem(KEYS.LANDING_PAGE, '/products/test?utm_source=google');
    localStorage.setItem(KEYS.GCLID, JSON.stringify({
      value:      'test_gclid_value',
      capturedAt: new Date().toISOString(),
    }));
  });

  test('returns all UTM fields', () => {
    const ctx = getAttributionContext();
    expect(ctx.utm_source).toBe('google');
    expect(ctx.utm_medium).toBe('cpc');
    expect(ctx.utm_campaign).toBe('test_campaign');
  });

  test('returns landing page', () => {
    const ctx = getAttributionContext();
    expect(ctx.landing_page).toBe('/products/test?utm_source=google');
  });

  test('returns gclid when not expired', () => {
    const ctx = getAttributionContext();
    expect(ctx.gclid).toBe('test_gclid_value');
  });

  test('returns null for expired gclid', () => {
    // Store a gclid captured 91 days ago (beyond 90-day expiry)
    const ninetyOneDaysAgo = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
    localStorage.setItem(KEYS.GCLID, JSON.stringify({
      value:      'expired_gclid',
      capturedAt: ninetyOneDaysAgo,
    }));

    const ctx = getAttributionContext();
    expect(ctx.gclid).toBeNull();

    // Also verifies expired key is cleaned up
    expect(localStorage.getItem(KEYS.GCLID)).toBeNull();
  });

  test('returns null for expired fbclid (7-day window)', () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    localStorage.setItem(KEYS.FBCLID, JSON.stringify({
      value:      'expired_fbclid',
      capturedAt: eightDaysAgo,
    }));

    const ctx = getAttributionContext();
    expect(ctx.fbclid).toBeNull();
  });

  test('includes sessionId', () => {
    const ctx = getAttributionContext();
    expect(ctx.sessionId).toBeTruthy();
    expect(typeof ctx.sessionId).toBe('string');
  });

  test('includes capturedAt timestamp', () => {
    const ctx = getAttributionContext();
    expect(ctx.capturedAt).toBeTruthy();
    expect(new Date(ctx.capturedAt).getTime()).toBeGreaterThan(0);
  });

  test('returns null for missing fields, not undefined', () => {
    const ctx = getAttributionContext();
    // Fields not set in localStorage should be null, not undefined
    expect(ctx.utm_term).toBeNull();
    expect(ctx.utm_content).toBeNull();
  });
});

// ─── getMetaPixelCookies ──────────────────────────────────────────────────────

describe('getMetaPixelCookies', () => {
  test('reads _fbp cookie correctly', () => {
    document.cookie = '_fbp=fb.1.1234567890.1234567890';
    const { fbp } = getMetaPixelCookies();
    expect(fbp).toBe('fb.1.1234567890.1234567890');
  });

  test('reads _fbc cookie correctly', () => {
    document.cookie = '_fbc=fb.1.1234567890.AbCdEfGhIjKlMn';
    const { fbc } = getMetaPixelCookies();
    expect(fbc).toBe('fb.1.1234567890.AbCdEfGhIjKlMn');
  });

  test('returns null when cookies are not present', () => {
    const { fbp, fbc } = getMetaPixelCookies();
    expect(fbp).toBeNull();
    expect(fbc).toBeNull();
  });

  test('handles multiple cookies correctly', () => {
    document.cookie = '_fbp=fb.1.111.222';
    document.cookie = 'other_cookie=other_value';
    document.cookie = '_fbc=fb.1.333.444';

    const { fbp, fbc } = getMetaPixelCookies();
    expect(fbp).toBe('fb.1.111.222');
    expect(fbc).toBe('fb.1.333.444');
  });
});

// ─── getGA4ClientId ───────────────────────────────────────────────────────────

describe('getGA4ClientId', () => {
  test('extracts client ID from _ga cookie', () => {
    document.cookie = '_ga=GA1.1.1234567890.1987654321';
    const clientId = getGA4ClientId();
    expect(clientId).toBe('1234567890.1987654321');
  });

  test('returns null when _ga cookie is not present', () => {
    const clientId = getGA4ClientId();
    expect(clientId).toBeNull();
  });

  test('handles malformed _ga cookie gracefully', () => {
    document.cookie = '_ga=malformed';
    const clientId = getGA4ClientId();
    expect(clientId).toBeNull();
  });

  test('handles GA1.2 format (cross-domain)', () => {
    document.cookie = '_ga=GA1.2.9876543210.1234567890';
    const clientId = getGA4ClientId();
    expect(clientId).toBe('9876543210.1234567890');
  });
});

// ─── buildClientAnalyticsPayload ─────────────────────────────────────────────

describe('buildClientAnalyticsPayload', () => {
  beforeEach(() => {
    // Set up realistic state
    localStorage.setItem(KEYS.UTM_SOURCE,   'google');
    localStorage.setItem(KEYS.UTM_MEDIUM,   'cpc');
    localStorage.setItem(KEYS.UTM_CAPTURED, '1');
    localStorage.setItem(KEYS.LANDING_PAGE, '/products/sneakers?utm_source=google');
    localStorage.setItem(KEYS.GCLID, JSON.stringify({
      value:      'test_gclid',
      capturedAt: new Date().toISOString(),
    }));

    // Set GA4 cookie
    document.cookie = '_ga=GA1.1.111111111.222222222';

    // Set Meta cookies
    document.cookie = '_fbp=fb.1.333333333.444444444';
  });

  test('includes the eventId unchanged', () => {
    const eventId  = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    const payload  = buildClientAnalyticsPayload(eventId);
    expect(payload.analyticsEventId).toBe(eventId);
  });

  test('includes clientTimestamp as an ISO string', () => {
    const payload = buildClientAnalyticsPayload(generateEventId());
    expect(payload.clientTimestamp).toBeTruthy();
    expect(new Date(payload.clientTimestamp).getTime()).toBeGreaterThan(0);
  });

  test('includes clientAttribution with UTMs and click IDs', () => {
    const payload = buildClientAnalyticsPayload(generateEventId());
    expect(payload.clientAttribution.utm_source).toBe('google');
    expect(payload.clientAttribution.utm_medium).toBe('cpc');
    expect(payload.clientAttribution.gclid).toBe('test_gclid');
  });

  test('includes ga4ClientId from _ga cookie', () => {
    const payload = buildClientAnalyticsPayload(generateEventId());
    expect(payload.ga4ClientId).toBe('111111111.222222222');
  });

  test('includes fbp from _fbp cookie', () => {
    const payload = buildClientAnalyticsPayload(generateEventId());
    expect(payload.fbp).toBe('fb.1.333333333.444444444');
  });

  test('includes all required top-level keys', () => {
    const payload = buildClientAnalyticsPayload(generateEventId());
    expect(payload).toHaveProperty('analyticsEventId');
    expect(payload).toHaveProperty('clientTimestamp');
    expect(payload).toHaveProperty('clientAttribution');
    expect(payload).toHaveProperty('ga4ClientId');
    expect(payload).toHaveProperty('fbp');
    expect(payload).toHaveProperty('fbc');
  });

  test('fbc falls back to fbclid from attribution when _fbc cookie missing', () => {
    // No _fbc cookie, but fbclid stored from ad click
    localStorage.setItem(KEYS.FBCLID, JSON.stringify({
      value:      'fbclid_from_url',
      capturedAt: new Date().toISOString(),
    }));

    const payload = buildClientAnalyticsPayload(generateEventId());
    expect(payload.fbc).toBe('fbclid_from_url');
  });
});

// ─── initAnalytics ────────────────────────────────────────────────────────────

describe('initAnalytics', () => {
  test('runs without throwing when called on clean state', () => {
    window.location.search = '?utm_source=google&gclid=test123';
    expect(() => initAnalytics()).not.toThrow();
  });

  test('captures UTMs and click IDs in one call', () => {
    window.location.search = '?utm_source=facebook&utm_medium=social&fbclid=fb_test';

    initAnalytics();

    expect(localStorage.getItem(KEYS.UTM_SOURCE)).toBe('facebook');
    expect(localStorage.getItem(KEYS.UTM_MEDIUM)).toBe('social');
    const fbclid = JSON.parse(localStorage.getItem(KEYS.FBCLID));
    expect(fbclid.value).toBe('fb_test');
  });

  test('returns attribution context object', () => {
    const result = initAnalytics();
    expect(result).toBeTruthy();
    expect(result).toHaveProperty('sessionId');
    expect(result).toHaveProperty('capturedAt');
  });

  test('captureClickIds runs before UTM idempotency check', () => {
    // First init: UTMs captured and sentinel set
    window.location.search = '?utm_source=google&gclid=gclid_v1';
    initAnalytics();

    // Second init: user comes via new ad click (new gclid), UTMs already stored
    window.location.search = '?gclid=gclid_v2';
    initAnalytics();

    // UTMs should be preserved (idempotent)
    expect(localStorage.getItem(KEYS.UTM_SOURCE)).toBe('google');

    // But gclid should be the new one (click IDs are NOT idempotent)
    const gclid = JSON.parse(localStorage.getItem(KEYS.GCLID));
    expect(gclid.value).toBe('gclid_v2');
  });
});

// ─── resetAnalyticsState ──────────────────────────────────────────────────────

describe('resetAnalyticsState', () => {
  test('clears all analytics localStorage keys', () => {
    // Set up state
    localStorage.setItem(KEYS.UTM_SOURCE,   'google');
    localStorage.setItem(KEYS.UTM_CAPTURED, '1');
    localStorage.setItem(KEYS.SESSION, JSON.stringify({ id: 'test', lastSeen: Date.now() }));

    resetAnalyticsState();

    expect(localStorage.getItem(KEYS.UTM_SOURCE)).toBeNull();
    expect(localStorage.getItem(KEYS.UTM_CAPTURED)).toBeNull();
    expect(localStorage.getItem(KEYS.SESSION)).toBeNull();
  });

  test('after reset, initAnalytics captures new UTMs', () => {
    // First session
    window.location.search = '?utm_source=google';
    initAnalytics();
    expect(localStorage.getItem(KEYS.UTM_SOURCE)).toBe('google');

    // Reset simulates new user / cleared state
    resetAnalyticsState();

    // New session with different source
    window.location.search = '?utm_source=facebook';
    initAnalytics();
    expect(localStorage.getItem(KEYS.UTM_SOURCE)).toBe('facebook');
  });
});
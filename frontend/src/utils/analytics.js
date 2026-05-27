/**
 * frontend/src/utils/analytics.js
 *
 * Client-side Analytics SDK — Phase 11
 *
 * Generates event UUIDs, manages cross-tab sessions, captures UTMs and click
 * IDs at landing time, and builds the attribution payload sent to the backend.
 */

import { v4 as uuidv4 } from 'uuid';

// ─── STORAGE KEYS ─────────────────────────────────────────────────────────────

export const KEYS = {
  UTM_SOURCE:   'epic_utm_source',
  UTM_MEDIUM:   'epic_utm_medium',
  UTM_CAMPAIGN: 'epic_utm_campaign',
  UTM_TERM:     'epic_utm_term',
  UTM_CONTENT:  'epic_utm_content',
  UTM_CAPTURED: 'epic_utm_captured', // sentinel — prevents first-touch overwrite
  LANDING_PAGE: 'epic_landing_page',
  GCLID:        'epic_gclid',
  FBCLID:       'epic_fbclid',
  TTCLID:       'epic_ttclid',
  MSCLKID:      'epic_msclkid',
  SESSION:      'epic_session',      // JSON: { id, lastSeen }
};

// 30-minute inactivity TTL — matches GA4 default session model
const SESSION_TTL_MS = 30 * 60 * 1000;

// ─── EVENT NAME CONSTANTS ─────────────────────────────────────────────────────
// Consumed by eventBridge.js — add new event types here as the plan grows.

export const ANALYTICS_EVENTS = {
  PAGE_VIEW:        'page_view',
  PRODUCT_VIEW:     'product_view',
  ADD_TO_CART:      'add_to_cart',
  REMOVE_FROM_CART: 'remove_from_cart',
  CHECKOUT_STEP:    'checkout_step',
  PURCHASE:         'purchase',
  SEARCH:           'search',
  LOGIN:            'login',
};

// ─── UUID GENERATION ──────────────────────────────────────────────────────────

/**
 * Returns a UUID v4 for a single user action.
 * Pass the same UUID to the backend, gtag(), and fbq() so GA4 and Meta can
 * deduplicate browser-side and server-side events into one conversion.
 * Generate a fresh UUID per action — never reuse across event types.
 */
export const generateEventId = () => uuidv4();

// ─── SESSION MANAGEMENT ───────────────────────────────────────────────────────

/**
 * Returns the active session ID, creating a new one if none exists or the
 * last-seen timestamp is older than SESSION_TTL_MS. Refreshes lastSeen on
 * every call. All tabs share the same session via localStorage.
 */
export const getOrCreateSessionId = () => {
  try {
    const stored = localStorage.getItem(KEYS.SESSION);

    if (stored) {
      const session = JSON.parse(stored);
      if ((Date.now() - session.lastSeen) < SESSION_TTL_MS && session.id) {
        localStorage.setItem(KEYS.SESSION, JSON.stringify({ id: session.id, lastSeen: Date.now() }));
        return session.id;
      }
    }

    const id = uuidv4();
    localStorage.setItem(KEYS.SESSION, JSON.stringify({ id, lastSeen: Date.now(), startedAt: new Date().toISOString() }));
    return id;

  } catch (err) {
    console.warn('[Analytics] localStorage unavailable, session will not persist:', err.message);
    return uuidv4();
  }
};

// ─── UTM CAPTURE ──────────────────────────────────────────────────────────────

/**
 * Persists UTMs from the landing URL to localStorage.
 * Idempotent — the UTM_CAPTURED sentinel ensures only the first landing page's
 * params are stored, implementing first-touch attribution across navigations.
 * Call once on app mount before any routing occurs.
 */
export const captureUTMsOnLoad = () => {
  try {
    if (localStorage.getItem(KEYS.UTM_CAPTURED)) return;

    const params = new URLSearchParams(window.location.search);
    const utmMap = {
      [KEYS.UTM_SOURCE]:   params.get('utm_source'),
      [KEYS.UTM_MEDIUM]:   params.get('utm_medium'),
      [KEYS.UTM_CAMPAIGN]: params.get('utm_campaign'),
      [KEYS.UTM_TERM]:     params.get('utm_term'),
      [KEYS.UTM_CONTENT]:  params.get('utm_content'),
    };

    Object.entries(utmMap).forEach(([key, value]) => {
      if (value) localStorage.setItem(key, value);
    });

    localStorage.setItem(KEYS.LANDING_PAGE, window.location.pathname + window.location.search);
    localStorage.setItem(KEYS.UTM_CAPTURED, '1');

  } catch (err) {
    console.warn('[Analytics] captureUTMsOnLoad failed:', err.message);
  }
};

// ─── CLICK ID CAPTURE ─────────────────────────────────────────────────────────

/**
 * Persists paid channel click IDs from the current URL to localStorage.
 * Not idempotent — a new ad click should overwrite the previous click ID.
 * Stored with a capturedAt timestamp for expiry checks in getClickId().
 * Call on every page load so new ad clicks are always captured.
 */
export const captureClickIds = () => {
  try {
    const params = new URLSearchParams(window.location.search);
    const clickIdMap = {
      [KEYS.GCLID]:   params.get('gclid'),
      [KEYS.FBCLID]:  params.get('fbclid'),
      [KEYS.TTCLID]:  params.get('ttclid'),
      [KEYS.MSCLKID]: params.get('msclkid'),
    };

    Object.entries(clickIdMap).forEach(([key, value]) => {
      if (value) localStorage.setItem(key, JSON.stringify({ value, capturedAt: new Date().toISOString() }));
    });

  } catch (err) {
    console.warn('[Analytics] captureClickIds failed:', err.message);
  }
};

// ─── CLICK ID READER ──────────────────────────────────────────────────────────

// Returns the stored click ID or null if expired. Removes stale entries.
const getClickId = (key, expiryDays) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;

    const { value, capturedAt } = JSON.parse(raw);
    if (Date.now() - new Date(capturedAt).getTime() > expiryDays * 86400000) {
      localStorage.removeItem(key);
      return null;
    }

    return value;
  } catch {
    return null;
  }
};

// ─── ATTRIBUTION CONTEXT ──────────────────────────────────────────────────────

/**
 * Returns a snapshot of all stored attribution signals.
 * Pass to the backend on every checkout/order request so server-side events
 * carry the same context. The backend also captures independently from cookies
 * and headers — this is a redundant source that includes the sessionId.
 */
export const getAttributionContext = () => {
  try {
    return {
      utm_source:   localStorage.getItem(KEYS.UTM_SOURCE)   || null,
      utm_medium:   localStorage.getItem(KEYS.UTM_MEDIUM)   || null,
      utm_campaign: localStorage.getItem(KEYS.UTM_CAMPAIGN) || null,
      utm_term:     localStorage.getItem(KEYS.UTM_TERM)     || null,
      utm_content:  localStorage.getItem(KEYS.UTM_CONTENT)  || null,
      landing_page: localStorage.getItem(KEYS.LANDING_PAGE) || window.location.pathname,
      gclid:        getClickId(KEYS.GCLID,   90),
      fbclid:       getClickId(KEYS.FBCLID,   7),
      ttclid:       getClickId(KEYS.TTCLID,   7),
      msclkid:      getClickId(KEYS.MSCLKID, 90),
      sessionId:    getOrCreateSessionId(),
      capturedAt:   new Date().toISOString(),
    };
  } catch (err) {
    console.warn('[Analytics] getAttributionContext failed:', err.message);
    return { sessionId: uuidv4(), capturedAt: new Date().toISOString() };
  }
};

// ─── META PIXEL HELPERS ───────────────────────────────────────────────────────

// Reads _fbp and _fbc cookies set by the Meta Pixel script.
// The backend passes these to CAPI user_data for identity matching.
export const getMetaPixelCookies = () => {
  try {
    const cookies = Object.fromEntries(
      document.cookie.split('; ').map(c => {
        const [k, ...v] = c.split('=');
        return [k, v.join('=')];
      })
    );
    return { fbp: cookies['_fbp'] || null, fbc: cookies['_fbc'] || null };
  } catch {
    return { fbp: null, fbc: null };
  }
};

// ─── GA4 CLIENT ID HELPER ─────────────────────────────────────────────────────

// Reads the GA4 client ID from the _ga cookie (format: GA1.1.XXXX.XXXX).
// Required for Measurement Protocol events to associate with the existing
// browser session — without it, server events appear as new users in GA4.
export const getGA4ClientId = () => {
  try {
    const match = document.cookie.match(/_ga=([^;]+)/);
    if (!match) return null;
    const parts = match[1].split('.');
    return parts.length >= 4 ? `${parts[2]}.${parts[3]}` : null;
  } catch {
    return null;
  }
};

// ─── CLIENT ANALYTICS PAYLOAD BUILDER ────────────────────────────────────────

/**
 * Builds the normalized payload POSTed to /api/v1/analytics/event.
 * Called by eventBridge.js sendEvent() on every tracked action.
 *
 * Accepts an options object (not a bare eventId string) so eventBridge can
 * pass eventType, properties, and an already-resolved attribution context
 * in one call — avoiding a redundant getAttributionContext() read per event.
 *
 * @param {string}  options.eventType          - Event name from ANALYTICS_EVENTS
 * @param {Object}  [options.properties]       - Event-specific properties
 * @param {Object}  [options.attribution]      - Pre-resolved attribution context
 * @param {string}  [options.analyticsEventId] - Deduplication UUID
 * @param {...*}    [overrides]                - Additional top-level fields
 */
export const buildClientAnalyticsPayload = ({
  eventType,
  properties = {},
  attribution,
  analyticsEventId,
  ...overrides
}) => {
  const resolvedAttribution = attribution || getAttributionContext();
  const metaCookies         = getMetaPixelCookies();
  const ga4ClientId         = getGA4ClientId();

  return {
    eventType,
    analyticsEventId,
    clientTimestamp:   new Date().toISOString(),
    properties,
    clientAttribution: resolvedAttribution,
    ga4ClientId,
    fbp: metaCookies.fbp,
    fbc: metaCookies.fbc || resolvedAttribution?.fbclid || null,
    ...overrides,
  };
};

// ─── INITIALIZER ──────────────────────────────────────────────────────────────

/**
 * Runs all capture functions in the correct order.
 * Call once in App.jsx useEffect on mount (empty dependency array).
 * captureClickIds must run before captureUTMsOnLoad so click IDs are stored
 * even when UTM capture has already been marked done.
 */
export const initAnalytics = () => {
  captureClickIds();
  captureUTMsOnLoad();
  const sessionId = getOrCreateSessionId();

  try {
    if (import.meta?.env?.DEV) {
      console.debug('[Analytics] Initialized', { sessionId, attribution: getAttributionContext() });
    }
  } catch {
    // import.meta.env not available in all environments
  }

  return getAttributionContext();
};

// ─── DEBUG UTILITY ────────────────────────────────────────────────────────────

export const debugAnalyticsState = () => {
  const state = {
    session:      JSON.parse(localStorage.getItem(KEYS.SESSION) || 'null'),
    attribution:  getAttributionContext(),
    ga4ClientId:  getGA4ClientId(),
    metaCookies:  getMetaPixelCookies(),
    localStorage: Object.fromEntries(
      Object.entries(KEYS).map(([label, key]) => [label, localStorage.getItem(key)])
    ),
  };
  console.table(state.attribution);
  console.log('[Analytics] Full state:', state);
  return state;
};

// ─── RESET (TESTING ONLY) ─────────────────────────────────────────────────────

// Clears all analytics keys — simulates a first-time visitor.
// Usage: import { resetAnalyticsState } from './utils/analytics'; resetAnalyticsState(); location.reload();
export const resetAnalyticsState = () => {
  Object.values(KEYS).forEach(key => localStorage.removeItem(key));
  console.info('[Analytics] State reset — reload the page to simulate first visit');
};
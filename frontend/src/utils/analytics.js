/**
 * frontend/src/utils/analytics.js
 *
 * Client-side Analytics SDK — Phase 11
 *
 * Generates event UUIDs, manages cross-tab sessions, captures UTMs and click
 * IDs at landing time, and builds the attribution payload sent to the backend.
 *
 * FIX APPLIED IN THIS VERSION:
 *
 *   [FIX] ADD_TO_WISHLIST: 'add_to_wishlist' added to ANALYTICS_EVENTS.
 *         Previously missing — wishlistSlice.js was forced to fall back to
 *         ADD_TO_CART as the eventType, causing every wishlist-add event to be
 *         logged as 'add_to_cart' in BigQuery's events table. This silently
 *         inflated add-to-cart counts and made wishlist analytics invisible.
 *         The string 'add_to_wishlist' already matched the backend schema enum
 *         (AnalyticsEvent.js) and orchestrator constants — the frontend was the
 *         only place the constant was absent.
 */

import { v4 as uuidv4 } from 'uuid';

// ─── STORAGE KEYS ─────────────────────────────────────────────────────────────

export const KEYS = {
  UTM_SOURCE:   'epic_utm_source',
  UTM_MEDIUM:   'epic_utm_medium',
  UTM_CAMPAIGN: 'epic_utm_campaign',
  UTM_TERM:     'epic_utm_term',
  UTM_CONTENT:  'epic_utm_content',
  // FIX (UTM_CAPTURED TTL): sentinel now stores a JSON object { ts } rather than
  // the bare string '1'. captureUTMsOnLoad checks the age against UTM_CAPTURED_TTL_MS
  // so a returning user from a new paid campaign after the TTL is correctly captured
  // as a new touch rather than silently ignored forever.
  UTM_CAPTURED: 'epic_utm_captured',
  LANDING_PAGE: 'epic_landing_page',
  GCLID:        'epic_gclid',
  FBCLID:       'epic_fbclid',
  TTCLID:       'epic_ttclid',
  MSCLKID:      'epic_msclkid',
  SESSION:      'epic_session',      // JSON: { id, lastSeen, startedAt }
};

// 30-minute inactivity TTL — matches GA4 default session model
const SESSION_TTL_MS = 30 * 60 * 1000;

// FIX (UTM_CAPTURED TTL): 30-day expiry on the first-touch sentinel.
// After this window the sentinel is treated as stale and a fresh landing with
// UTM params will be captured as a new attribution event. Adjust to match
// your attribution window (30 days is standard for most ad platforms).
const UTM_CAPTURED_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ─── EVENT NAME CONSTANTS ─────────────────────────────────────────────────────
// Consumed by eventBridge.js and slice files throughout the app.
// Add new event types here as the analytics plan grows.
//
// IMPORTANT: these string values must match the eventType enum in the backend
// AnalyticsEvent.js schema. Any new event type added here must also be added to
// that enum, otherwise queue persistence will throw a validation error.

export const ANALYTICS_EVENTS = {
  PAGE_VIEW:        'page_view',
  PRODUCT_VIEW:     'product_view',
  ADD_TO_CART:      'add_to_cart',
  REMOVE_FROM_CART: 'remove_from_cart',
  // [FIX] ADD_TO_WISHLIST was missing. wishlistSlice.js was falling back to
  // ADD_TO_CART which logged every wishlist-add as add_to_cart in BigQuery.
  ADD_TO_WISHLIST:  'add_to_wishlist',
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
 * last-seen timestamp is older than SESSION_TTL_MS.
 *
 * FIX (session refresh): lastSeen is no longer updated on every call to
 * getOrCreateSessionId(). Instead a separate refreshSession() export is
 * provided and should be called only when the user fires a real event (page
 * view, interaction, purchase, etc.). This prevents buildClientAnalyticsPayload
 * — which calls getAttributionContext, which calls getOrCreateSessionId — from
 * silently extending the session on every payload construction, making session
 * durations effectively infinite for active users.
 *
 * All tabs share the same session via localStorage.
 */
export const getOrCreateSessionId = () => {
  try {
    const stored = localStorage.getItem(KEYS.SESSION);

    if (stored) {
      const session = JSON.parse(stored);
      if ((Date.now() - session.lastSeen) < SESSION_TTL_MS && session.id) {
        // Return existing session ID without touching lastSeen.
        // lastSeen is updated only by refreshSession() at real event boundaries.
        return session.id;
      }
    }

    // Expired or missing — start a new session.
    const id = uuidv4();
    localStorage.setItem(KEYS.SESSION, JSON.stringify({
      id,
      lastSeen:  Date.now(),
      startedAt: new Date().toISOString(),
    }));
    return id;

  } catch (err) {
    console.warn('[Analytics] localStorage unavailable, session will not persist:', err.message);
    return uuidv4();
  }
};

/**
 * Updates lastSeen on the active session. Call this at real user-event
 * boundaries (page view, add-to-cart, purchase, etc.) — not on every
 * payload construction. Calling it at event time means the 30-minute
 * inactivity window is measured between events, matching GA4's model.
 */
export const refreshSession = () => {
  try {
    const stored = localStorage.getItem(KEYS.SESSION);
    if (!stored) return;
    const session = JSON.parse(stored);
    localStorage.setItem(KEYS.SESSION, JSON.stringify({ ...session, lastSeen: Date.now() }));
  } catch {
    // Non-critical — silently ignore
  }
};

// ─── UTM CAPTURE ──────────────────────────────────────────────────────────────

/**
 * Persists UTMs from the landing URL to localStorage.
 *
 * Implements first-touch attribution with a TTL-bounded sentinel:
 *   - If no sentinel exists → capture UTMs from the current URL.
 *   - If sentinel exists and is within UTM_CAPTURED_TTL_MS → skip (first-touch
 *     already recorded for this attribution window).
 *   - If sentinel exists but is older than UTM_CAPTURED_TTL_MS → treat as
 *     expired, allow a fresh capture so a new paid campaign landing is not
 *     silently attributed to a weeks-old organic visit.
 *
 * FIX (permanent sentinel): The original code stored '1' as the sentinel value
 * and never expired it. A user returning via a new paid ad click weeks later
 * would have their UTMs silently ignored, causing paid conversions to be
 * misattributed to the original first-touch source forever. The sentinel now
 * stores { ts } and is checked against UTM_CAPTURED_TTL_MS on every call.
 *
 * FIX (click ID / UTM mismatch): captureClickIds() is always called before
 * this function (see initAnalytics). Click IDs overwrite on every ad click.
 * Now that the UTM sentinel also expires, UTMs and click IDs will belong to
 * the same attribution event after the TTL window, eliminating the scenario
 * where a fresh fbclid is paired with stale utm_source from a prior session.
 *
 * Call once on app mount before any routing occurs.
 */

export const captureUTMsOnLoad = () => {
  try {
    const params = new URLSearchParams(window.location.search);
    const freshSource = params.get('utm_source');

    // If fresh UTM params are present on this URL, always recapture —
    // a new paid ad click must overwrite the prior first-touch sentinel.
    // The sentinel only blocks recapture when the landing URL has NO UTMs,
    // preventing mid-session page navigations from resetting attribution.
    if (!freshSource) {
      const sentinelRaw = localStorage.getItem(KEYS.UTM_CAPTURED);
      if (sentinelRaw) {
        try {
          const { ts } = JSON.parse(sentinelRaw);
          if (Date.now() - ts < UTM_CAPTURED_TTL_MS) return;
        } catch {
          // Corrupt sentinel — fall through to recapture
        }
      }
    }

    const utmMap = {
      [KEYS.UTM_SOURCE]:   params.get('utm_source'),
      [KEYS.UTM_MEDIUM]:   params.get('utm_medium'),
      [KEYS.UTM_CAMPAIGN]: params.get('utm_campaign'),
      [KEYS.UTM_TERM]:     params.get('utm_term'),
      [KEYS.UTM_CONTENT]:  params.get('utm_content'),
    };

    // Clear stale UTM keys before writing new ones so old Google UTMs
    // don't bleed through when the new URL only has some params set.
    if (freshSource) {
      Object.values(KEYS).filter(k => k.startsWith('epic_utm')).forEach(k =>
        localStorage.removeItem(k)
      );
      localStorage.removeItem(KEYS.LANDING_PAGE);
    }

    Object.entries(utmMap).forEach(([key, value]) => {
      if (value) localStorage.setItem(key, value);
    });

    localStorage.setItem(KEYS.LANDING_PAGE, window.location.pathname + window.location.search);
    localStorage.setItem(KEYS.UTM_CAPTURED, JSON.stringify({ ts: Date.now() }));

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

    const incoming = {
      [KEYS.GCLID]:   params.get('gclid'),
      [KEYS.FBCLID]:  params.get('fbclid'),
      [KEYS.TTCLID]:  params.get('ttclid'),
      [KEYS.MSCLKID]: params.get('msclkid'),
    };

    const allKeys = Object.keys(incoming);
    const hasAnyIncoming = allKeys.some(key => incoming[key]);

    if (hasAnyIncoming) {
      // A new ad click has arrived — clear ALL existing click IDs first
      // so a prior platform's click ID never bleeds into a new session.
      // e.g. landing from Google after a prior Facebook click should not
      // report both gclid and fbclid on the resulting order.
      allKeys.forEach(key => localStorage.removeItem(key));
    }

    allKeys.forEach(key => {
      const value = incoming[key];
      if (value) {
        localStorage.setItem(key, JSON.stringify({
          value,
          capturedAt: new Date().toISOString(),
        }));
      }
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
 *
 * NOTE: Does not call refreshSession(). Callers that represent real user events
 * should call refreshSession() separately after calling getAttributionContext().
 */

export const getAttributionContext = () => {
  try {
        const ua = navigator.userAgent || '';

        const device = /tablet|ipad|(android(?!.*mobile))/i.test(ua) ? 'tablet'
                    : /mobile|android|iphone|ipod|blackberry|iemobile|opera mini/i.test(ua) ? 'mobile'
                    : 'desktop';

        const browser = /samsungbrowser/i.test(ua) ? 'Samsung Internet'
                      : /edg\//i.test(ua)           ? 'Edge'
                      : /opr\//i.test(ua)           ? 'Opera'
                      : /chrome/i.test(ua)          ? 'Chrome'
                      : /firefox/i.test(ua)         ? 'Firefox'
                      : /safari/i.test(ua)          ? 'Safari'
                      : 'unknown';
                      
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
      device,
      browser,
    };
  } catch (err) {
    console.warn('[Analytics] getAttributionContext failed:', err.message);
    return { sessionId: uuidv4(), capturedAt: new Date().toISOString() };
  }
};

// ─── META PIXEL HELPERS ───────────────────────────────────────────────────────

/**
 * Reads _fbp and _fbc cookies set by the Meta Pixel script.
 * The backend passes these to CAPI user_data for identity matching.
 *
 * FIX (performance): Cookie parsing is memoized per page load using a module-
 * level cache. getMetaPixelCookies() was called inside buildClientAnalyticsPayload
 * on every tracked event — splitting and mapping document.cookie every time.
 * For a checkout flow with 4-5 steps this ran up to 5 times unnecessarily.
 * The cache is intentionally never invalidated within a page session: _fbp and
 * _fbc are written once by the Meta Pixel on load and do not change mid-session.
 */
let _metaPixelCookieCache = null;

export const getMetaPixelCookies = () => {
  if (_metaPixelCookieCache) return _metaPixelCookieCache;

  try {
    const cookies = Object.fromEntries(
      document.cookie.split('; ').map(c => {
        const [k, ...v] = c.split('=');
        return [k, v.join('=')];
      })
    );
    _metaPixelCookieCache = { fbp: cookies['_fbp'] || null, fbc: cookies['_fbc'] || null };
  } catch {
    _metaPixelCookieCache = { fbp: null, fbc: null };
  }

  return _metaPixelCookieCache;
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

// ─── FBC FORMATTER ────────────────────────────────────────────────────────────

/**
 * Formats a raw fbclid into the _fbc cookie format expected by Meta CAPI:
 *   fb.1.<creationTime>.<fbclid>
 *
 * FIX (raw fbclid as fbc): buildClientAnalyticsPayload previously fell back to
 * resolvedAttribution?.fbclid (a raw click ID from localStorage) when _fbc was
 * absent, and passed it as the `fbc` field. verifyPaymentController and
 * metaCapiService both call formatFbc on the attribution fbclid — but they only
 * do so on the attribution object's fbclid field, not on req.body.fbc, which is
 * treated as already-formatted. This created a path where a raw fbclid arrived
 * in req.body.fbc and bypassed formatting entirely.
 *
 * The fix: when _fbc cookie is absent, format the raw fbclid here at the source
 * so that every consumer of req.body.fbc receives a correctly structured value.
 */

const formatFbc = (rawFbclid) => {
  if (!rawFbclid) return null;
  return `fb.1.${Math.floor(Date.now() / 1000)}.${rawFbclid}`;
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
 * FIX (checkoutSlice.js call signature): The function signature has always
 * required an options object, but checkoutSlice.js was calling it as
 * buildClientAnalyticsPayload(eventId) — passing a bare UUID string. All
 * destructured params (eventType, analyticsEventId, etc.) were undefined,
 * so every checkout analytics payload had analyticsEventId: undefined.
 * This file is the source of truth for the API — checkoutSlice.js must be
 * updated to call buildClientAnalyticsPayload({ analyticsEventId: eventId })
 * matching the pattern already used correctly in paymentSlice.js.
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
} = {}) => {
  const resolvedAttribution = attribution || getAttributionContext();
  const metaCookies         = getMetaPixelCookies();
  const ga4ClientId         = getGA4ClientId();

  // FIX (raw fbclid as fbc): format the raw fbclid fallback so req.body.fbc
  // always arrives at the backend in the fb.1.<ts>.<fbclid> structure.
  // When _fbc cookie is present it is already correctly formatted by Meta Pixel.
  const fbc = metaCookies.fbc || formatFbc(resolvedAttribution?.fbclid) || null;

  return {
    eventType,
    analyticsEventId,
    clientTimestamp:   new Date().toISOString(),
    properties,
    clientAttribution: resolvedAttribution,
    ga4ClientId,
    fbp: metaCookies.fbp,
    fbc,
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
    // FIX (debug exposure): Guard tightened — only log in development.
    // import.meta.env.DEV is a build-time constant; if it were accidentally
    // true in a production build the debug log (including fbclid, gclid, and
    // sessionId) would execute on every page load for every user. The outer
    // try/catch remains for environments where import.meta.env is unavailable.
    if (import.meta?.env?.DEV === true) {
      console.debug('[Analytics] Initialized', { sessionId, attribution: getAttributionContext() });
    }
  } catch {
    // import.meta.env not available in all environments
  }

  return getAttributionContext();
};

// ─── DEBUG UTILITY ────────────────────────────────────────────────────────────

/**
 * FIX (debug exposure): debugAnalyticsState no longer attaches itself to
 * window.__epicAnalytics. The original code in App.jsx assigned it there
 * under import.meta.env.DEV, but if that flag were true in a production
 * build, fbclid, gclid, and sessionId would be globally readable by any
 * browser extension or injected script. The function is still exported for
 * use in dev tooling — callers that need the window global must assign it
 * explicitly and only in controlled dev environments.
 */
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
  // Also bust the memoized cookie cache so tests get a clean slate.
  _metaPixelCookieCache = null;
  console.info('[Analytics] State reset — reload the page to simulate first visit');
};
/**
 * frontend/src/utils/analytics.js
 *
 * Phase 1 — Frontend Analytics SDK
 *
 * This is the client-side counterpart to backend/utils/analyticsEvent.js.
 * It generates the UUID that becomes the event_id, manages sessions across
 * tabs, captures UTMs and click IDs at landing time, and provides the
 * attribution context object that gets forwarded to the backend on every
 * checkout/order action.
 *
 * Design decisions:
 *
 *   1. localStorage over sessionStorage for UTMs and click IDs.
 *      sessionStorage is tab-scoped — it resets on every new tab and is
 *      destroyed by OAuth redirects (Google/Facebook login opens a new tab
 *      then closes it, wiping the sessionStorage that held the UTMs).
 *      localStorage survives OAuth redirects, tab opens, and browser restores.
 *
 *   2. Session ID in localStorage with explicit TTL check.
 *      sessionStorage gives a new session per tab — one user with three tabs
 *      becomes three sessions, splitting attribution incorrectly.
 *      localStorage with a 30-minute inactivity TTL gives a single session
 *      per user journey regardless of tab count, matching GA4's session model.
 *
 *   3. captureUTMsOnLoad() is idempotent via the "utm_captured" flag.
 *      Only the FIRST landing URL's UTMs are stored. If the user navigates
 *      from page to page within the site, subsequent URL params do not
 *      overwrite the original attribution. This implements first-touch
 *      attribution at the client level.
 *
 *   4. generateEventId() returns a new UUID v4 for each distinct user action.
 *      The caller is responsible for storing and reusing this UUID when the
 *      same action is sent to both the browser pixel and the server.
 *
 *   5. getAttributionContext() returns a snapshot of all stored attribution
 *      signals. Pass this to the backend in the request body alongside the
 *      event_id so server-side events carry the same context.
 */

import { v4 as uuidv4 } from 'uuid';

// ─── STORAGE KEYS ─────────────────────────────────────────────────────────────
// Centralised here so typos don't create orphaned localStorage keys.

export const KEYS = {
  // UTM parameters (first-touch, captured once on landing)
  UTM_SOURCE:   'epic_utm_source',
  UTM_MEDIUM:   'epic_utm_medium',
  UTM_CAMPAIGN: 'epic_utm_campaign',
  UTM_TERM:     'epic_utm_term',
  UTM_CONTENT:  'epic_utm_content',
  UTM_CAPTURED: 'epic_utm_captured',   // sentinel flag — prevents overwrite

  // Landing page (URL at first arrival, preserved across navigation)
  LANDING_PAGE: 'epic_landing_page',

  // Click IDs (paid channel identifiers)
  GCLID:  'epic_gclid',   // Google Ads click ID
  FBCLID: 'epic_fbclid',  // Meta/Facebook click ID
  TTCLID: 'epic_ttclid',  // TikTok click ID
  MSCLKID:'epic_msclkid', // Microsoft Ads click ID

  // Session (cross-tab, inactivity-based TTL)
  SESSION: 'epic_session', // JSON: { id, lastSeen }
};

// Session expires after 30 minutes of inactivity (matches GA4 default)
const SESSION_TTL_MS = 30 * 60 * 1000;

// ─── UUID GENERATION ──────────────────────────────────────────────────────────

/**
 * generateEventId
 *
 * Generates a fresh UUID v4 for a single user action.
 * This UUID must be:
 *   1. Passed to the backend in the request body (req.body.analyticsEventId)
 *   2. Sent in the GA4 gtag() call as the event_id parameter
 *   3. Sent in the Meta Pixel fbq() call as the eventID parameter
 *
 * All three uses of the same UUID allow GA4 and Meta to deduplicate the
 * browser-side and server-side events into a single conversion.
 *
 * Generate a NEW UUID for each distinct user action. Do not reuse across
 * different events (e.g. don't use the same UUID for add_to_cart and purchase).
 *
 * @returns {string} UUID v4
 */
export const generateEventId = () => uuidv4();

// ─── SESSION MANAGEMENT ───────────────────────────────────────────────────────

/**
 * getOrCreateSessionId
 *
 * Returns the current session ID, creating a new one if:
 *   a) No session exists in localStorage, or
 *   b) The session has been inactive for more than SESSION_TTL_MS
 *
 * Updates lastSeen on every call to implement the rolling inactivity TTL.
 * Cross-tab: all tabs sharing the same localStorage share the same session.
 *
 * @returns {string} UUID v4 session ID
 */
export const getOrCreateSessionId = () => {
  try {
    const stored = localStorage.getItem(KEYS.SESSION);

    if (stored) {
      const session = JSON.parse(stored);
      const isActive = (Date.now() - session.lastSeen) < SESSION_TTL_MS;

      if (isActive && session.id) {
        // Refresh lastSeen to extend the inactivity window
        localStorage.setItem(KEYS.SESSION, JSON.stringify({
          id:       session.id,
          lastSeen: Date.now(),
        }));
        return session.id;
      }
    }

    // No session or session expired — create a fresh one
    const id = uuidv4();
    localStorage.setItem(KEYS.SESSION, JSON.stringify({
      id,
      lastSeen:  Date.now(),
      startedAt: new Date().toISOString(),
    }));
    return id;

  } catch (err) {
    // localStorage may be unavailable (private browsing, storage quota exceeded)
    // Fall back to a transient UUID for this call — session won't persist
    console.warn('[Analytics] localStorage unavailable, session will not persist:', err.message);
    return uuidv4();
  }
};

// ─── UTM CAPTURE ─────────────────────────────────────────────────────────────

/**
 * captureUTMsOnLoad
 *
 * Reads UTM parameters from the current URL and persists them to
 * localStorage. Must be called ONCE on app mount (App.jsx useEffect with
 * empty dependency array) — before any routing/navigation occurs.
 *
 * Idempotent: the KEYS.UTM_CAPTURED sentinel prevents subsequent page
 * navigations from overwriting the original landing page UTMs.
 *
 * To reset attribution (e.g. in testing): localStorage.removeItem('epic_utm_captured')
 */
export const captureUTMsOnLoad = () => {
  try {
    // Already captured — preserve first-touch attribution
    if (localStorage.getItem(KEYS.UTM_CAPTURED)) return;

    const params = new URLSearchParams(window.location.search);

    const utmMap = {
      [KEYS.UTM_SOURCE]:   params.get('utm_source'),
      [KEYS.UTM_MEDIUM]:   params.get('utm_medium'),
      [KEYS.UTM_CAMPAIGN]: params.get('utm_campaign'),
      [KEYS.UTM_TERM]:     params.get('utm_term'),
      [KEYS.UTM_CONTENT]:  params.get('utm_content'),
    };

    // Only store non-null values
    Object.entries(utmMap).forEach(([key, value]) => {
      if (value) localStorage.setItem(key, value);
    });

    // Always store the landing page — even if no UTMs present
    localStorage.setItem(
      KEYS.LANDING_PAGE,
      window.location.pathname + window.location.search
    );

    // Mark as captured so subsequent navigations don't overwrite
    localStorage.setItem(KEYS.UTM_CAPTURED, '1');

  } catch (err) {
    console.warn('[Analytics] captureUTMsOnLoad failed:', err.message);
  }
};

// ─── CLICK ID CAPTURE ─────────────────────────────────────────────────────────

/**
 * captureClickIds
 *
 * Reads paid channel click IDs from the current URL and persists them to
 * localStorage. Unlike UTMs, click IDs are NOT idempotent — a new click
 * (new ad click → new session) should overwrite the previous click ID
 * because each click ID is tied to a specific ad click for attribution.
 *
 * Click IDs have platform-specific expiry windows:
 *   gclid:   90 days (Google Ads)
 *   fbclid:  7 days  (Meta — tied to _fbc cookie)
 *   ttclid:  7 days  (TikTok)
 *   msclkid: 90 days (Microsoft Ads)
 *
 * The backend also captures these from query params and sets httpOnly cookies
 * (attributionMiddleware.js). Both sources are used for resilience.
 *
 * Call this on every page load (not just first) so new ad clicks are captured.
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

    // Store with timestamp so we can check expiry
    Object.entries(clickIdMap).forEach(([key, value]) => {
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

/**
 * getClickId
 *
 * Retrieves a stored click ID, returning null if expired.
 * Expiry windows match the platform's attribution window.
 *
 * @param {string} key            - One of KEYS.GCLID, KEYS.FBCLID, etc.
 * @param {number} expiryDays     - Days before the click ID is considered stale
 * @returns {string|null}
 */
const getClickId = (key, expiryDays) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;

    const { value, capturedAt } = JSON.parse(raw);
    const ageMs = Date.now() - new Date(capturedAt).getTime();
    const expiryMs = expiryDays * 24 * 60 * 60 * 1000;

    if (ageMs > expiryMs) {
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
 * getAttributionContext
 *
 * Returns a snapshot of all stored attribution signals.
 * Pass this object to the backend in every checkout/order request body
 * so server-side events carry the same attribution context as client events.
 *
 * The backend's attributionMiddleware.js will also capture these signals
 * independently from cookies and headers. The frontend context serves as a
 * redundant source and also carries the sessionId which the server cannot
 * easily reconstruct after the fact.
 *
 * @returns {Object} Attribution context snapshot
 */
export const getAttributionContext = () => {
  try {
    return {
      // UTM parameters (first-touch from landing page)
      utm_source:   localStorage.getItem(KEYS.UTM_SOURCE)   || null,
      utm_medium:   localStorage.getItem(KEYS.UTM_MEDIUM)   || null,
      utm_campaign: localStorage.getItem(KEYS.UTM_CAMPAIGN) || null,
      utm_term:     localStorage.getItem(KEYS.UTM_TERM)     || null,
      utm_content:  localStorage.getItem(KEYS.UTM_CONTENT)  || null,

      // Landing page
      landing_page: localStorage.getItem(KEYS.LANDING_PAGE) || window.location.pathname,

      // Click IDs with platform-specific expiry windows
      gclid:   getClickId(KEYS.GCLID,   90), // Google Ads: 90 days
      fbclid:  getClickId(KEYS.FBCLID,   7), // Meta: 7 days
      ttclid:  getClickId(KEYS.TTCLID,   7), // TikTok: 7 days
      msclkid: getClickId(KEYS.MSCLKID, 90), // Microsoft: 90 days

      // Session
      sessionId: getOrCreateSessionId(),

      // Snapshot timestamp (for debugging timing issues)
      capturedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.warn('[Analytics] getAttributionContext failed:', err.message);
    return { sessionId: uuidv4(), capturedAt: new Date().toISOString() };
  }
};

// ─── META PIXEL HELPERS ───────────────────────────────────────────────────────

/**
 * getMetaPixelCookies
 *
 * Reads the Meta Pixel cookies (_fbp and _fbc) from document.cookie.
 * These are set automatically by the Meta Pixel browser script.
 * The backend needs these for CAPI user_data matching.
 *
 * _fbp: Meta browser ID (set by pixel on first visit)
 * _fbc: Meta click ID cookie (set when user arrives via a Facebook ad)
 *
 * @returns {{ fbp: string|null, fbc: string|null }}
 */
export const getMetaPixelCookies = () => {
  try {
    const cookies = Object.fromEntries(
      document.cookie.split('; ').map(c => {
        const [k, ...v] = c.split('=');
        return [k, v.join('=')];
      })
    );
    return {
      fbp: cookies['_fbp'] || null,
      fbc: cookies['_fbc'] || null,
    };
  } catch {
    return { fbp: null, fbc: null };
  }
};

// ─── GA4 CLIENT ID HELPER ─────────────────────────────────────────────────────

/**
 * getGA4ClientId
 *
 * Reads the GA4 client ID from the _ga cookie.
 * GA4 uses this to associate server-side Measurement Protocol events
 * with the correct browser session in GA4 reporting.
 *
 * Without the correct client_id, server-side events appear as new users
 * in GA4 rather than being attributed to the existing browser session.
 *
 * The _ga cookie format is: GA1.1.XXXXXXXXXX.XXXXXXXXXX
 * The client_id is the last two dot-separated segments: XXXXXXXXXX.XXXXXXXXXX
 *
 * @returns {string|null}
 */
export const getGA4ClientId = () => {
  try {
    const match = document.cookie.match(/_ga=([^;]+)/);
    if (!match) return null;
    // Extract client_id from GA1.1.CLIENT_ID format
    const parts = match[1].split('.');
    if (parts.length >= 4) {
      return `${parts[2]}.${parts[3]}`;
    }
    return null;
  } catch {
    return null;
  }
};

// ─── FULL ANALYTICS PAYLOAD BUILDER ──────────────────────────────────────────

/**
 * buildClientAnalyticsPayload
 *
 * Builds the complete analytics payload that should be sent to the backend
 * alongside any checkout or order request. The backend merges this with
 * server-side signals (cookie attribution, confidence scoring) to produce
 * the final analytics event.
 *
 * Usage in Redux thunks:
 *   const eventId = generateEventId();
 *   const analyticsPayload = buildClientAnalyticsPayload(eventId);
 *   dispatch(createOrder({ ...orderData, ...analyticsPayload }));
 *
 * @param {string} eventId - UUID generated by generateEventId() for this action
 * @returns {Object}
 */
export const buildClientAnalyticsPayload = (eventId) => {
  const attribution = getAttributionContext();
  const metaCookies = getMetaPixelCookies();
  const ga4ClientId = getGA4ClientId();

  return {
    // The UUID that ties client and server events together for deduplication
    analyticsEventId: eventId,

    // ISO timestamp from the browser at the moment of user action
    // Used as event_time_client on the backend
    clientTimestamp: new Date().toISOString(),

    // Full attribution context
    clientAttribution: attribution,

    // GA4 client ID for Measurement Protocol session matching
    ga4ClientId,

    // Meta Pixel cookies for CAPI user matching
    fbp: metaCookies.fbp,
    fbc: metaCookies.fbc || attribution.fbclid,
  };
};

// ─── INITIALIZER ─────────────────────────────────────────────────────────────

/**
 * initAnalytics
 *
 * Single initializer that runs all capture functions.
 * Call this ONCE in App.jsx useEffect on mount (empty dependency array).
 *
 * Order matters:
 *   1. captureClickIds() — must run before captureUTMsOnLoad() so click IDs
 *      are stored even if UTM capture has already been marked as done
 *   2. captureUTMsOnLoad() — idempotent, only stores on first visit
 *   3. getOrCreateSessionId() — creates/refreshes session
 *
 * @returns {Object} Initial attribution context (useful for debugging)
 */

export const initAnalytics = () => {
  captureClickIds();
  captureUTMsOnLoad();
  const sessionId = getOrCreateSessionId();

  try {
    if (import.meta?.env?.DEV) {
      console.debug('[Analytics] Initialized', {
        sessionId,
        attribution: getAttributionContext(),
      });
    }
  } catch {
    // import.meta.env not available in all environments
  }

  return getAttributionContext();
};

// ─── DEBUG UTILITY ────────────────────────────────────────────────────────────


export const debugAnalyticsState = () => {
  const state = {
    session:     JSON.parse(localStorage.getItem(KEYS.SESSION) || 'null'),
    attribution: getAttributionContext(),
    ga4ClientId: getGA4ClientId(),
    metaCookies: getMetaPixelCookies(),
    localStorage: Object.fromEntries(
      Object.entries(KEYS).map(([label, key]) => [label, localStorage.getItem(key)])
    ),
  };
  console.table(state.attribution);
  console.log('[Analytics] Full state:', state);
  return state;
};

// ─── RESET (TESTING ONLY) ─────────────────────────────────────────────────────

/**
 * resetAnalyticsState
 *
 * Clears all analytics localStorage keys.
 * USE ONLY IN TESTING — simulates a first-time visitor.
 *
 * Usage in browser console:
 *   import { resetAnalyticsState } from './utils/analytics';
 *   resetAnalyticsState();
 *   location.reload();
 */
export const resetAnalyticsState = () => {
  Object.values(KEYS).forEach(key => localStorage.removeItem(key));
  console.info('[Analytics] State reset — reload the page to simulate first visit');
};
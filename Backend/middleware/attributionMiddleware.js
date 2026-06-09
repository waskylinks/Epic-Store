/**
 * backend/middleware/attribution-tracking-middleware.js — PHASE 3 FULL REPLACEMENT
 *
 * Phase 3 — Attribution Confidence Scoring
 *
 *   1. Click ID capture — reads gclid/fbclid/ttclid/msclkid from query params
 *      and sets them as httpOnly cookies with platform-specific TTLs.
 *      Falls back to reading from existing cookies if not in query params.
 *
 *   2. Confidence scoring — composable score from four independent signals:
 *        hasClickId      × 0.50  (strongest — cryptographically signed by ad platform)
 *        hasUTM          × 0.20  (manually set — can be missing or spoofed)
 *        hasReferrer     × 0.10  (easily stripped by browsers and privacy tools)
 *        sessionContinuity × 0.20 (returning session means prior attribution exists)
 *
 *   3. Referrer reconstruction trigger — when confidence is LOW and all
 *      signals are absent, calls reconstructReferrer() from Phase 4.
 *      Result is tagged isReconstructed: true so it is never mixed silently
 *      with raw attribution data.
 *
 *   4. req.attribution shape — expanded to include all new fields.
 *      Every downstream controller reads from req.attribution only.
 *
 * Design rules:
 *   - Confidence scoring never blocks the request — all failures default to LOW
 *   - Click ID cookies are set with httpOnly: true (not accessible to JS)
 *   - Reconstruction is conservative — returns null rather than guess wrong
 *   - isReconstructed: true is always set when reconstruction fires
 *   - Click ID values are length-capped before being written to cookies
 *   - UTM cookies use a 30-day TTL to support multi-session purchase journeys
 *   - Routes that don't need attribution are skipped via BYPASS_PATHS
 *
 * Mount order in app.js (already correct from Phase 2):
 *   app.use(sessionMiddleware)     ← Phase 2: sets req.sessionId
 *   app.use(identityMiddleware)    ← Phase 2: sets req.anonymousId
 *   app.use(trackAttribution)      ← Phase 3: sets req.attribution (this file)
 */

import { reconstructReferrer } from '../utils/referrerReconstruction.js';

// ─── CLICK ID TTL CONFIGURATION ───────────────────────────────────────────────

const CLICK_ID_TTL = {
  gclid:   (parseInt(process.env.CLICK_ID_COOKIE_TTL) || 90) * 86400000, // Google Ads: 90 days
  fbclid:  7  * 86400000, // Meta: 7 days
  ttclid:  7  * 86400000, // TikTok: 7 days
  msclkid: 90 * 86400000, // Microsoft Ads: 90 days
};

// ─── CLICK ID VALUE MAX LENGTH ────────────────────────────────────────────────
// Browser cookie size limit is ~4096 bytes per cookie. Cap individual click ID
// values well below that to prevent silent cookie drops from malicious or
// malformed query params.

const CLICK_ID_MAX_LENGTH = 512;

// ─── UTM COOKIE TTL ───────────────────────────────────────────────────────────
// 30 days — matches industry standard for a multi-session purchase journey.
// The previous value of 30 minutes matched the payment session window, which
// caused UTM attribution to be lost for any user who didn't convert immediately.

const UTM_COOKIE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days in ms

// ─── ROUTES THAT BYPASS ATTRIBUTION ──────────────────────────────────────────
// Attribution scoring runs on every request by default. These prefixes are
// skipped because they carry no attribution signals and don't need req.attribution.
// Health checks, receipts, shipping lookups, and SEO routes are all included.

const BYPASS_PATHS = [
  '/health',
  '/api/v1/receipts',
  '/api/v1/shipping/rates',
  '/api/v1/shipping/carriers',
  '/api/v1/analytics/event',
  '/sitemap',
  '/robots.txt',
  '/favicon',
];

const shouldBypass = (path) =>
  BYPASS_PATHS.some((prefix) => path === prefix || path.startsWith(prefix + '/'));

// ─── NULL ATTRIBUTION FALLBACK ────────────────────────────────────────────────
// Shared shape for both bypass and error-fallback paths. Keeping one definition
// prevents the two from drifting apart structurally.

const buildNullAttribution = (req) => ({
  source:             'direct',
  medium:             null,
  campaign:           null,
  term:               null,
  content:            null,
  referrer:           null,
  landingPage:        req.originalUrl || null,
  device:             'unknown',
  browser:            'unknown',
  gclid:              null,
  fbclid:             null,
  ttclid:             null,
  msclkid:            null,
  confidenceScore:    0,
  confidenceLevel:    'LOW',
  isReconstructed:    false,
  reconstructionRule: null,
});

// ─── CONFIDENCE SCORE WEIGHTS ─────────────────────────────────────────────────

const WEIGHTS = {
  clickId:           0.50,
  utm:               0.20,
  referrer:          0.10,
  sessionContinuity: 0.20,
};

// ─── CONFIDENCE LEVEL THRESHOLDS ─────────────────────────────────────────────

const getConfidenceLevel = (score) => {
  if (score >= 0.80) return 'HIGH';
  if (score >= 0.50) return 'MEDIUM';
  return 'LOW';
};

// ─── COOKIE HELPERS ───────────────────────────────────────────────────────────

const buildClickIdCookieOptions = (maxAge) => ({
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge,
});

// UTM cookies use sameSite: 'strict' to prevent them from being sent on
// cross-site form submissions. Click IDs intentionally use 'lax' because
// they arrive via cross-site top-level redirects from ad platforms.

const UTM_COOKIE_OPTIONS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge:   UTM_COOKIE_TTL,
};

// ─── DEVICE DETECTION ────────────────────────────────────────────────────────

const detectDevice = (userAgent = '') => {
  const ua = userAgent.toLowerCase();
  if (/mobile|android|iphone|ipod|blackberry|opera mini|iemobile/.test(ua)) return 'mobile';
  if (/tablet|ipad/.test(ua)) return 'tablet';
  return 'desktop';
};

const detectBrowser = (userAgent = '') => {
  const ua = userAgent.toLowerCase();
  if (/edg\//.test(ua))     return 'Edge';
  if (/chrome/.test(ua))    return 'Chrome';
  if (/firefox/.test(ua))   return 'Firefox';
  if (/safari/.test(ua))    return 'Safari';
  if (/opera|opr/.test(ua)) return 'Opera';
  return 'unknown';
};

// ─── CLICK ID CAPTURE ─────────────────────────────────────────────────────────

const captureClickIds = (req, res) => {
  const clickIds = {};

  ['gclid', 'fbclid', 'ttclid', 'msclkid'].forEach((key) => {
    const rawFromQuery = req.query[key];
    const fromCookie   = req.cookies?.[key];

    if (rawFromQuery) {
      // Cap value length before writing to cookie — an oversized click ID value
      // (e.g. from a malformed or malicious URL) would silently drop the cookie
      // if it pushes the total cookie size over the ~4096 byte browser limit.
      const fromQuery = String(rawFromQuery).slice(0, CLICK_ID_MAX_LENGTH);
      res.cookie(key, fromQuery, buildClickIdCookieOptions(CLICK_ID_TTL[key]));
      clickIds[key] = fromQuery;
    } else if (fromCookie) {
      clickIds[key] = fromCookie;
    } else {
      clickIds[key] = null;
    }
  });

  return clickIds;
};

// ─── UTM EXTRACTION ───────────────────────────────────────────────────────────

const extractUTMParams = (req) => {
  const fromQuery = {
    source:   req.query.utm_source,
    medium:   req.query.utm_medium,
    campaign: req.query.utm_campaign,
    term:     req.query.utm_term,
    content:  req.query.utm_content,
  };

  const fromCookies = {
    source:   req.cookies?.utm_source,
    medium:   req.cookies?.utm_medium,
    campaign: req.cookies?.utm_campaign,
    term:     req.cookies?.utm_term,
    content:  req.cookies?.utm_content,
  };

  return {
    source:   fromQuery.source   || fromCookies.source   || null,
    medium:   fromQuery.medium   || fromCookies.medium   || null,
    campaign: fromQuery.campaign || fromCookies.campaign || null,
    term:     fromQuery.term     || fromCookies.term     || null,
    content:  fromQuery.content  || fromCookies.content  || null,
    // Track whether UTMs arrived fresh on this request so we know whether
    // to (re)write the cookies below.
    _freshFromQuery: !!fromQuery.source,
  };
};

// ─── CONFIDENCE SCORING ───────────────────────────────────────────────────────

export const computeConfidence = ({ hasClickId, hasUTM, hasReferrer, sessionContinuity }) => {
  const raw =
    (hasClickId        ? WEIGHTS.clickId           : 0) +
    (hasUTM            ? WEIGHTS.utm               : 0) +
    (hasReferrer       ? WEIGHTS.referrer          : 0) +
    (sessionContinuity ? WEIGHTS.sessionContinuity : 0);

  const score = Math.round(raw * 100) / 100;
  const level = getConfidenceLevel(score);

  return { score, level };
};

// ─── MAIN MIDDLEWARE ──────────────────────────────────────────────────────────

export const trackAttribution = (req, res, next) => {
  // Skip attribution scoring entirely for routes that don't need it.
  // This avoids running confidence scoring, cookie reads, and reconstruction
  // on health checks, receipts, and SEO routes.
  if (shouldBypass(req.path)) {
    req.attribution = buildNullAttribution(req);
    return next();
  }

  try {
    const userAgent   = req.headers['user-agent'] || '';
    const referer     = req.headers['referer'] || req.headers['referrer'] || null;
    const landingPage = req.originalUrl || null;

    // ── Extract UTMs ──────────────────────────────────────────────────────────
    const utms = extractUTMParams(req);

    // ── Capture click IDs ─────────────────────────────────────────────────────
    const clickIds = captureClickIds(req, res);

    // ── Device detection ──────────────────────────────────────────────────────
    const device  = detectDevice(userAgent);
    const browser = detectBrowser(userAgent);

    // ── Session continuity ────────────────────────────────────────────────────
    // req.sessionId is set by sessionMiddleware which must be mounted before
    // trackAttribution in app.js. Both conditions must be true: sessionMiddleware
    // sets req.sessionId and the client must also carry the session cookie.
    // If middleware order is wrong, req.sessionId is undefined and this is false —
    // which is the correct conservative behaviour (no false continuity signal).
    const sessionContinuity = !!(req.sessionId && req.cookies?.epicstore_sid);

    // ── Confidence signals ────────────────────────────────────────────────────
    const hasClickId = Object.values(clickIds).some(Boolean);

    // hasUTM is true when there is any UTM source other than the literal string
    // "direct". Previously this only checked utms.source, which caused
    // reconstruction to fire even when utm_source=direct cookie evidence existed
    // from a prior real session — an attribution inversion.
    const hasUTM = !!(utms.source && utms.source !== 'direct');

    // hasUTMCookieEvidence is a softer signal: UTM cookies exist even if source
    // is "direct". Used to suppress reconstruction when cookie evidence is present.
    const hasUTMCookieEvidence = !!(
      req.cookies?.utm_source ||
      req.cookies?.utm_medium ||
      req.cookies?.utm_campaign
    );

    const hasReferrer = !!referer;

    // ── Compute confidence score ──────────────────────────────────────────────
    const { score: confidenceScore, level: confidenceLevel } = computeConfidence({
      hasClickId,
      hasUTM,
      hasReferrer,
      sessionContinuity,
    });

    // ── Referrer reconstruction ───────────────────────────────────────────────
    // Reconstruction only fires when ALL direct signals are absent AND there is
    // no cookie evidence of prior UTM attribution. If utm_source=direct exists
    // in cookies from a prior session, we do not reconstruct — the cookie is
    // the evidence.
    let isReconstructed     = false;
    let reconstructionRule  = null;
    let reconstructedSource = null;
    let reconstructedMedium = null;

    if (
      confidenceLevel === 'LOW' &&
      !hasUTM &&
      !hasClickId &&
      !hasReferrer &&
      !hasUTMCookieEvidence
    ) {
      const reconstruction = reconstructReferrer({
        landingPage,
        sessionContinuity,
        isFirstVisit: !sessionContinuity,
      });

      if (reconstruction) {
        isReconstructed     = true;
        reconstructionRule  = reconstruction.reconstructionRule;
        reconstructedSource = reconstruction.source;
        reconstructedMedium = reconstruction.medium;
      }
    }

    // ── Persist UTMs to cookies ───────────────────────────────────────────────
    // Only write UTM cookies when fresh params arrived on this request.
    // Cookies persist for 30 days to support multi-session purchase journeys.
    // The previous 30-minute TTL caused UTM loss for any user who didn't
    // convert on the landing visit.
    if (utms._freshFromQuery) {
      if (utms.source)   res.cookie('utm_source',   utms.source,   UTM_COOKIE_OPTIONS);
      if (utms.medium)   res.cookie('utm_medium',   utms.medium,   UTM_COOKIE_OPTIONS);
      if (utms.campaign) res.cookie('utm_campaign', utms.campaign, UTM_COOKIE_OPTIONS);
      if (utms.term)     res.cookie('utm_term',     utms.term,     UTM_COOKIE_OPTIONS);
      if (utms.content)  res.cookie('utm_content',  utms.content,  UTM_COOKIE_OPTIONS);
    }

    // ── Assemble req.attribution ──────────────────────────────────────────────
    req.attribution = {
      source:   reconstructedSource || utms.source || 'direct',
      medium:   reconstructedMedium || utms.medium || null,
      campaign: utms.campaign || null,
      term:     utms.term     || null,
      content:  utms.content  || null,
      referrer:    referer,
      landingPage,
      device,
      browser,
      gclid:   clickIds.gclid,
      fbclid:  clickIds.fbclid,
      ttclid:  clickIds.ttclid,
      msclkid: clickIds.msclkid,
      confidenceScore,
      confidenceLevel,
      isReconstructed,
      reconstructionRule,
    };

  } catch (err) {
    console.error('[trackAttribution] Failed (non-fatal):', err.message);
    req.attribution = buildNullAttribution(req);
  }

  next();
};
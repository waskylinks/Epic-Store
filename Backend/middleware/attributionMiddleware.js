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
    const fromQuery  = req.query[key];
    const fromCookie = req.cookies?.[key];

    if (fromQuery) {
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
  try {
    const userAgent  = req.headers['user-agent'] || '';
    const referer    = req.headers['referer'] || req.headers['referrer'] || null;
    const landingPage = req.originalUrl || null;

    // ── Extract UTMs ──────────────────────────────────────────────────────────
    const utms = extractUTMParams(req);

    // ── Capture click IDs ─────────────────────────────────────────────────────
    const clickIds = captureClickIds(req, res);

    // ── Device detection ──────────────────────────────────────────────────────
    const device  = detectDevice(userAgent);
    const browser = detectBrowser(userAgent);

    // ── Confidence signals ────────────────────────────────────────────────────
    const hasClickId        = Object.values(clickIds).some(Boolean);
    const hasUTM            = !!(utms.source && utms.source !== 'direct');
    const hasReferrer       = !!referer;
    const sessionContinuity = !!(req.sessionId && req.cookies?.epicstore_sid);

    // ── Compute confidence score ──────────────────────────────────────────────
    const { score: confidenceScore, level: confidenceLevel } = computeConfidence({
      hasClickId,
      hasUTM,
      hasReferrer,
      sessionContinuity,
    });

    // ── Referrer reconstruction ───────────────────────────────────────────────
    let isReconstructed     = false;
    let reconstructionRule  = null;
    let reconstructedSource = null;
    let reconstructedMedium = null;

    if (confidenceLevel === 'LOW' && !hasUTM && !hasClickId && !hasReferrer) {
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
    if (utms.source && req.query.utm_source) {
      const utmCookieOptions = {
        httpOnly: true,
        secure:   process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge:   30 * 60 * 1000,
      };
      if (utms.source)   res.cookie('utm_source',   utms.source,   utmCookieOptions);
      if (utms.medium)   res.cookie('utm_medium',   utms.medium,   utmCookieOptions);
      if (utms.campaign) res.cookie('utm_campaign', utms.campaign, utmCookieOptions);
      if (utms.term)     res.cookie('utm_term',     utms.term,     utmCookieOptions);
      if (utms.content)  res.cookie('utm_content',  utms.content,  utmCookieOptions);
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
    req.attribution = {
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
    };
  }

  next();
};
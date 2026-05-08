/**
 * backend/middleware/__tests__/attributionMiddleware.test.js
 *
 * Phase 3 — Test Suite for attributionMiddleware.js
 *
 * Run with:
 *   npx jest middleware/__tests__/attributionMiddleware.test.js --verbose
 *
 * WHY jest.unstable_mockModule:
 *   Running under --experimental-vm-modules (ESM mode). jest.mock() with a
 *   factory that closes over outer-scope jest.fn() instances silently fails —
 *   the factory runs before `const` declarations are initialised, so the mock
 *   module receives `undefined` instead of the jest.fn() references.
 *
 *   jest.unstable_mockModule + deferred await import() is the correct pattern.
 *   See sessionMiddleware.test.js for a detailed explanation.
 */

import { jest } from '@jest/globals';

// ─── MOCK referrerReconstruction ─────────────────────────────────────────────

const mockReconstructReferrer = jest.fn();

jest.unstable_mockModule('../../utils/referrerReconstruction.js', () => ({
  reconstructReferrer: mockReconstructReferrer,
}));

// ─── DEFERRED IMPORTS ────────────────────────────────────────────────────────

let trackAttribution;
let computeConfidence;

beforeAll(async () => {
  const mod        = await import('../attributionMiddleware.js');
  trackAttribution = mod.trackAttribution;
  computeConfidence = mod.computeConfidence;
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const buildMockReq = ({
  query       = {},
  cookies     = {},
  headers     = {},
  sessionId   = null,
  originalUrl = '/products/test-product',
} = {}) => ({
  query,
  cookies,
  headers: {
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0',
    ...headers,
  },
  sessionId,
  originalUrl,
});

const buildMockRes = () => {
  const res = {
    _cookies: {},
    cookie:   jest.fn((name, value, options) => {
      res._cookies[name] = { value, options };
    }),
  };
  return res;
};

const buildMockNext = () => jest.fn();

// ─── SETUP ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockReconstructReferrer.mockReturnValue(null);
});

// ─── computeConfidence ────────────────────────────────────────────────────────

describe('computeConfidence', () => {
  test('returns 1.0 and HIGH when all signals present', () => {
    const { score, level } = computeConfidence({
      hasClickId:        true,
      hasUTM:            true,
      hasReferrer:       true,
      sessionContinuity: true,
    });
    expect(score).toBe(1.0);
    expect(level).toBe('HIGH');
  });

  test('click ID alone gives 0.50 and MEDIUM', () => {
    const { score, level } = computeConfidence({
      hasClickId:        true,
      hasUTM:            false,
      hasReferrer:       false,
      sessionContinuity: false,
    });
    expect(score).toBe(0.50);
    expect(level).toBe('MEDIUM');
  });

  test('click ID + session continuity gives 0.70 and MEDIUM', () => {
    const { score, level } = computeConfidence({
      hasClickId:        true,
      hasUTM:            false,
      hasReferrer:       false,
      sessionContinuity: true,
    });
    expect(score).toBe(0.70);
    expect(level).toBe('MEDIUM');
  });

  test('click ID + UTM + session gives 0.90 and HIGH', () => {
    const { score, level } = computeConfidence({
      hasClickId:        true,
      hasUTM:            true,
      hasReferrer:       false,
      sessionContinuity: true,
    });
    expect(score).toBe(0.90);
    expect(level).toBe('HIGH');
  });

  test('UTM alone gives 0.20 and LOW', () => {
    const { score, level } = computeConfidence({
      hasClickId:        false,
      hasUTM:            true,
      hasReferrer:       false,
      sessionContinuity: false,
    });
    expect(score).toBe(0.20);
    expect(level).toBe('LOW');
  });

  test('UTM + referrer gives 0.30 and LOW', () => {
    const { score, level } = computeConfidence({
      hasClickId:        false,
      hasUTM:            true,
      hasReferrer:       true,
      sessionContinuity: false,
    });
    expect(score).toBe(0.30);
    expect(level).toBe('LOW');
  });

  test('UTM + referrer + session gives 0.50 and MEDIUM', () => {
    const { score, level } = computeConfidence({
      hasClickId:        false,
      hasUTM:            true,
      hasReferrer:       true,
      sessionContinuity: true,
    });
    expect(score).toBe(0.50);
    expect(level).toBe('MEDIUM');
  });

  test('session continuity alone gives 0.20 and LOW', () => {
    const { score, level } = computeConfidence({
      hasClickId:        false,
      hasUTM:            false,
      hasReferrer:       false,
      sessionContinuity: true,
    });
    expect(score).toBe(0.20);
    expect(level).toBe('LOW');
  });

  test('no signals gives 0.0 and LOW', () => {
    const { score, level } = computeConfidence({
      hasClickId:        false,
      hasUTM:            false,
      hasReferrer:       false,
      sessionContinuity: false,
    });
    expect(score).toBe(0.0);
    expect(level).toBe('LOW');
  });

  test('score is rounded to 2 decimal places — no floating point noise', () => {
    const { score } = computeConfidence({
      hasClickId:        true,
      hasUTM:            true,
      hasReferrer:       true,
      sessionContinuity: false,
    });
    expect(score).toBe(0.80);
    expect(String(score)).not.toContain('0000000');
  });

  test('HIGH threshold is >= 0.80', () => {
    const { level: atBoundary } = computeConfidence({
      hasClickId: true, hasUTM: true, hasReferrer: true, sessionContinuity: false,
    });
    expect(atBoundary).toBe('HIGH'); // 0.80

    const { level: justBelow } = computeConfidence({
      hasClickId: true, hasUTM: false, hasReferrer: false, sessionContinuity: true,
    });
    expect(justBelow).toBe('MEDIUM'); // 0.70
  });

  test('MEDIUM threshold is >= 0.50', () => {
    const { level: atBoundary } = computeConfidence({
      hasClickId: true, hasUTM: false, hasReferrer: false, sessionContinuity: false,
    });
    expect(atBoundary).toBe('MEDIUM'); // 0.50

    const { level: justBelow } = computeConfidence({
      hasClickId: false, hasUTM: true, hasReferrer: true, sessionContinuity: false,
    });
    expect(justBelow).toBe('LOW'); // 0.30
  });
});

// ─── trackAttribution — req.attribution shape ─────────────────────────────────

describe('trackAttribution — req.attribution shape', () => {
  test('sets all required fields on req.attribution', () => {
    const req  = buildMockReq({ query: { utm_source: 'google', utm_medium: 'cpc' } });
    const res  = buildMockRes();
    const next = buildMockNext();

    trackAttribution(req, res, next);

    // Check all required keys exist with correct types.
    // Nullable fields (medium, campaign, referrer, click IDs, reconstructionRule)
    // are validated with toHaveProperty — they must be present on the object
    // but may legitimately be null. expect.anything() rejects null so cannot
    // be used for optional fields.
    expect(req.attribution).toMatchObject({
      source:          expect.any(String),
      landingPage:     expect.any(String),
      device:          expect.any(String),
      browser:         expect.any(String),
      confidenceScore: expect.any(Number),
      confidenceLevel: expect.stringMatching(/^(HIGH|MEDIUM|LOW)$/),
      isReconstructed: expect.any(Boolean),
    });

    // Nullable fields — must be present on the object (not missing), but value may be null
    const nullableFields = ['medium', 'campaign', 'referrer', 'gclid', 'fbclid', 'ttclid', 'msclkid', 'reconstructionRule'];
    nullableFields.forEach(field => {
      expect(req.attribution).toHaveProperty(field);
    });
  });

  test('always calls next()', () => {
    const req  = buildMockReq();
    const res  = buildMockRes();
    const next = buildMockNext();

    trackAttribution(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  test('sets source to "direct" when no UTMs or click IDs present', () => {
    const req  = buildMockReq();
    const res  = buildMockRes();
    const next = buildMockNext();

    trackAttribution(req, res, next);

    expect(req.attribution.source).toBe('direct');
  });

  test('correctly reads utm_source from query params', () => {
    const req  = buildMockReq({ query: { utm_source: 'facebook', utm_medium: 'social' } });
    const res  = buildMockRes();
    const next = buildMockNext();

    trackAttribution(req, res, next);

    expect(req.attribution.source).toBe('facebook');
    expect(req.attribution.medium).toBe('social');
  });

  test('falls back to cookie UTMs when no query params', () => {
    const req  = buildMockReq({
      cookies: { utm_source: 'email', utm_medium: 'newsletter' },
    });
    const res  = buildMockRes();
    const next = buildMockNext();

    trackAttribution(req, res, next);

    expect(req.attribution.source).toBe('email');
    expect(req.attribution.medium).toBe('newsletter');
  });

  test('detects mobile device from user-agent', () => {
    const req = buildMockReq({
      headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) Mobile/15E148' },
    });
    const res  = buildMockRes();
    const next = buildMockNext();

    trackAttribution(req, res, next);

    expect(req.attribution.device).toBe('mobile');
  });

  test('detects desktop device from user-agent', () => {
    const req = buildMockReq({
      headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120' },
    });
    const res  = buildMockRes();
    const next = buildMockNext();

    trackAttribution(req, res, next);

    expect(req.attribution.device).toBe('desktop');
  });

  test('reads referrer from Referer header', () => {
    const req = buildMockReq({
      headers: { 'referer': 'https://www.google.com/search?q=sneakers' },
    });
    const res  = buildMockRes();
    const next = buildMockNext();

    trackAttribution(req, res, next);

    expect(req.attribution.referrer).toBe('https://www.google.com/search?q=sneakers');
  });
});

// ─── Click ID capture ─────────────────────────────────────────────────────────

describe('Click ID capture', () => {
  test('captures gclid from query params and sets cookie', () => {
    const req  = buildMockReq({ query: { gclid: 'Cj0KCQ_test_gclid' } });
    const res  = buildMockRes();
    const next = buildMockNext();

    trackAttribution(req, res, next);

    expect(req.attribution.gclid).toBe('Cj0KCQ_test_gclid');
    expect(res._cookies['gclid'].value).toBe('Cj0KCQ_test_gclid');
    expect(res._cookies['gclid'].options.httpOnly).toBe(true);
  });

  test('captures fbclid from query params', () => {
    const req  = buildMockReq({ query: { fbclid: 'AbCdEfGh_test' } });
    const res  = buildMockRes();
    const next = buildMockNext();

    trackAttribution(req, res, next);

    expect(req.attribution.fbclid).toBe('AbCdEfGh_test');
  });

  test('falls back to cookie when no query param click ID', () => {
    const req  = buildMockReq({ cookies: { gclid: 'cookie_gclid_value' } });
    const res  = buildMockRes();
    const next = buildMockNext();

    trackAttribution(req, res, next);

    expect(req.attribution.gclid).toBe('cookie_gclid_value');
    expect(res._cookies['gclid']).toBeUndefined();
  });

  test('gclid presence gives MEDIUM confidence when combined with session', () => {
    const req  = buildMockReq({
      query:     { gclid: 'test_gclid' },
      sessionId: 'existing-session',
      cookies:   { epicstore_sid: 'existing-session' },
    });
    const res  = buildMockRes();
    const next = buildMockNext();

    trackAttribution(req, res, next);

    // gclid (0.50) + sessionContinuity (0.20) = 0.70 = MEDIUM
    expect(req.attribution.confidenceScore).toBe(0.70);
    expect(req.attribution.confidenceLevel).toBe('MEDIUM');
  });

  test('gclid + UTM + session gives HIGH confidence', () => {
    const req  = buildMockReq({
      query:     { gclid: 'test_gclid', utm_source: 'google', utm_medium: 'cpc' },
      sessionId: 'existing-session',
      cookies:   { epicstore_sid: 'existing-session' },
    });
    const res  = buildMockRes();
    const next = buildMockNext();

    trackAttribution(req, res, next);

    // gclid (0.50) + UTM (0.20) + session (0.20) = 0.90
    expect(req.attribution.confidenceScore).toBe(0.90);
    expect(req.attribution.confidenceLevel).toBe('HIGH');
  });
});

// ─── Confidence scoring integration ──────────────────────────────────────────

describe('Confidence scoring integration', () => {
  test('no signals → confidenceScore 0.0, confidenceLevel LOW', () => {
    const req  = buildMockReq({ query: {}, cookies: {}, sessionId: null });
    const res  = buildMockRes();
    const next = buildMockNext();

    trackAttribution(req, res, next);

    expect(req.attribution.confidenceScore).toBe(0.0);
    expect(req.attribution.confidenceLevel).toBe('LOW');
  });

  test('UTM + referrer + session → 0.50, MEDIUM', () => {
    const req  = buildMockReq({
      query:      { utm_source: 'google', utm_medium: 'cpc' },
      headers:    { referer: 'https://google.com', 'user-agent': 'test' },
      sessionId:  'existing-session',
      cookies:    { epicstore_sid: 'existing-session' },
    });
    const res  = buildMockRes();
    const next = buildMockNext();

    trackAttribution(req, res, next);

    expect(req.attribution.confidenceScore).toBe(0.50);
    expect(req.attribution.confidenceLevel).toBe('MEDIUM');
  });
});

// ─── Reconstruction trigger ───────────────────────────────────────────────────

describe('Referrer reconstruction trigger', () => {
  test('calls reconstructReferrer when LOW confidence and no signals', () => {
    mockReconstructReferrer.mockReturnValue({
      source:             'dark_social',
      medium:             'social',
      reconstructionRule: 'first_visit_product_page',
    });

    const req  = buildMockReq({ query: {}, cookies: {}, sessionId: null });
    const res  = buildMockRes();
    const next = buildMockNext();

    trackAttribution(req, res, next);

    expect(mockReconstructReferrer).toHaveBeenCalledTimes(1);
    expect(req.attribution.isReconstructed).toBe(true);
    expect(req.attribution.reconstructionRule).toBe('first_visit_product_page');
    expect(req.attribution.source).toBe('dark_social');
  });

  test('does NOT call reconstructReferrer when UTM is present', () => {
    const req  = buildMockReq({ query: { utm_source: 'google' } });
    const res  = buildMockRes();
    const next = buildMockNext();

    trackAttribution(req, res, next);

    expect(mockReconstructReferrer).not.toHaveBeenCalled();
    expect(req.attribution.isReconstructed).toBe(false);
  });

  test('does NOT call reconstructReferrer when click ID is present', () => {
    const req  = buildMockReq({ query: { gclid: 'test_gclid' } });
    const res  = buildMockRes();
    const next = buildMockNext();

    trackAttribution(req, res, next);

    expect(mockReconstructReferrer).not.toHaveBeenCalled();
    expect(req.attribution.isReconstructed).toBe(false);
  });

  test('does NOT call reconstructReferrer when referrer header is present', () => {
    const req  = buildMockReq({
      headers: { referer: 'https://google.com', 'user-agent': 'test' },
    });
    const res  = buildMockRes();
    const next = buildMockNext();

    trackAttribution(req, res, next);

    expect(mockReconstructReferrer).not.toHaveBeenCalled();
    expect(req.attribution.isReconstructed).toBe(false);
  });

  test('sets isReconstructed false when reconstruction returns null', () => {
    mockReconstructReferrer.mockReturnValue(null);

    const req  = buildMockReq({ query: {}, cookies: {}, sessionId: null });
    const res  = buildMockRes();
    const next = buildMockNext();

    trackAttribution(req, res, next);

    expect(req.attribution.isReconstructed).toBe(false);
    expect(req.attribution.source).toBe('direct');
  });

  test('reconstructed source overrides "direct" default', () => {
    mockReconstructReferrer.mockReturnValue({
      source:             'likely_email_or_social',
      medium:             'email',
      reconstructionRule: 'first_visit_promo_page',
    });

    const req  = buildMockReq({
      query:       {},
      cookies:     {},
      sessionId:   null,
      originalUrl: '/sale',
    });
    const res  = buildMockRes();
    const next = buildMockNext();

    trackAttribution(req, res, next);

    expect(req.attribution.source).toBe('likely_email_or_social');
    expect(req.attribution.medium).toBe('email');
    expect(req.attribution.isReconstructed).toBe(true);
  });
});

// ─── Failure resilience ───────────────────────────────────────────────────────

describe('Failure resilience', () => {
  test('does NOT throw when req.query is undefined', () => {
    const req  = { cookies: {}, headers: {}, sessionId: null, originalUrl: '/' };
    const res  = buildMockRes();
    const next = buildMockNext();

    expect(() => trackAttribution(req, res, next)).not.toThrow();
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('does NOT throw when req.cookies is undefined', () => {
    const req  = { query: {}, headers: {}, sessionId: null, originalUrl: '/' };
    const res  = buildMockRes();
    const next = buildMockNext();

    expect(() => trackAttribution(req, res, next)).not.toThrow();
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('sets safe default attribution when an unexpected error occurs', () => {
    const req = {
      get query() { throw new Error('Unexpected error'); },
      cookies:     {},
      headers:     {},
      sessionId:   null,
      originalUrl: '/',
    };
    const res  = buildMockRes();
    const next = buildMockNext();

    trackAttribution(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.attribution.source).toBe('direct');
    expect(req.attribution.confidenceLevel).toBe('LOW');
    expect(req.attribution.confidenceScore).toBe(0);
  });
});
/**
 * backend/middleware/__tests__/sessionMiddleware.test.js
 *
 * Phase 2 — Test Suite for sessionMiddleware.js
 *
 * Run with:
 *   npx jest middleware/__tests__/sessionMiddleware.test.js --verbose
 *
 * Tests validate:
 *   1. Cookie creation — new session gets a valid UUID cookie
 *   2. Cookie rolling — existing session cookie TTL is refreshed every request
 *   3. req.sessionId — always populated regardless of Redis state
 *   4. Redis enrichment — page views increment, lastSeenAt updates
 *   5. Redis failure resilience — middleware never throws when Redis is down
 *   6. getSessionMeta — returns null gracefully on missing/expired sessions
 *   7. invalidateSession — clears cookie and removes Redis key
 */

import { jest } from '@jest/globals';

// ─── MOCK REDIS ───────────────────────────────────────────────────────────────
// We mock the redis utility so tests don't require a real Redis instance.
// Each test controls exactly what getCache returns and what setCache receives.

const mockGetCache = jest.fn();
const mockSetCache = jest.fn();
const mockDeleteCache = jest.fn();

jest.mock('../../utils/redis.js', () => ({
  getCache:    mockGetCache,
  setCache:    mockSetCache,
  deleteCache: mockDeleteCache,
}));

import {
  sessionMiddleware,
  getSessionMeta,
  invalidateSession,
} from '../sessionMiddleware.js';

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/**
 * buildMockReq
 * Builds a minimal Express request object for testing.
 * Cookies can be pre-populated to simulate returning visitors.
 */
const buildMockReq = (cookies = {}) => ({
  cookies,
});

/**
 * buildMockRes
 * Builds a minimal Express response object that captures cookie calls.
 */
const buildMockRes = () => {
  const res = {
    _cookies:    {},
    _cleared:    [],
    cookie:      jest.fn((name, value, options) => { res._cookies[name] = { value, options }; }),
    clearCookie: jest.fn((name, options) => { res._cleared.push({ name, options }); }),
  };
  return res;
};

const buildMockNext = () => jest.fn();

// UUID v4 regex for assertions
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ─── SETUP ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  // Default: Redis returns null (no existing session meta)
  mockGetCache.mockResolvedValue(null);
  mockSetCache.mockResolvedValue(true);
  mockDeleteCache.mockResolvedValue(true);
});

// ─── COOKIE CREATION ─────────────────────────────────────────────────────────

describe('Cookie creation — new session', () => {
  test('sets epicstore_sid cookie when none exists', async () => {
    const req  = buildMockReq({});
    const res  = buildMockRes();
    const next = buildMockNext();

    await sessionMiddleware(req, res, next);

    expect(res.cookie).toHaveBeenCalledWith(
      'epicstore_sid',
      expect.stringMatching(UUID_V4_REGEX),
      expect.objectContaining({ httpOnly: true })
    );
  });

  test('generated session ID is a valid UUID v4', async () => {
    const req  = buildMockReq({});
    const res  = buildMockRes();
    const next = buildMockNext();

    await sessionMiddleware(req, res, next);

    const cookieValue = res._cookies['epicstore_sid'].value;
    expect(cookieValue).toMatch(UUID_V4_REGEX);
  });

  test('cookie is set with httpOnly: true', async () => {
    const req  = buildMockReq({});
    const res  = buildMockRes();
    const next = buildMockNext();

    await sessionMiddleware(req, res, next);

    const opts = res._cookies['epicstore_sid'].options;
    expect(opts.httpOnly).toBe(true);
  });

  test('cookie is set with sameSite: lax', async () => {
    const req  = buildMockReq({});
    const res  = buildMockRes();
    const next = buildMockNext();

    await sessionMiddleware(req, res, next);

    const opts = res._cookies['epicstore_sid'].options;
    expect(opts.sameSite).toBe('lax');
  });

  test('cookie maxAge matches SESSION_ROLLING_TTL env (default 1800s = 1800000ms)', async () => {
    const req  = buildMockReq({});
    const res  = buildMockRes();
    const next = buildMockNext();

    await sessionMiddleware(req, res, next);

    const opts = res._cookies['epicstore_sid'].options;
    expect(opts.maxAge).toBe(1800 * 1000);
  });
});

// ─── COOKIE ROLLING ───────────────────────────────────────────────────────────

describe('Cookie rolling — returning session', () => {
  test('refreshes existing session cookie on every request', async () => {
    const existingId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    const req  = buildMockReq({ epicstore_sid: existingId });
    const res  = buildMockRes();
    const next = buildMockNext();

    mockGetCache.mockResolvedValue({
      pageViews:  5,
      startedAt:  '2024-01-01T00:00:00.000Z',
      lastSeenAt: '2024-01-01T00:05:00.000Z',
    });

    await sessionMiddleware(req, res, next);

    // Cookie should be set again (rolling) with the same ID
    expect(res.cookie).toHaveBeenCalledWith(
      'epicstore_sid',
      existingId,
      expect.objectContaining({ httpOnly: true })
    );
  });

  test('preserves the existing session ID — does not generate a new one', async () => {
    const existingId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    const req  = buildMockReq({ epicstore_sid: existingId });
    const res  = buildMockRes();
    const next = buildMockNext();

    mockGetCache.mockResolvedValue({ pageViews: 1, startedAt: new Date().toISOString() });

    await sessionMiddleware(req, res, next);

    expect(req.sessionId).toBe(existingId);
    expect(res._cookies['epicstore_sid'].value).toBe(existingId);
  });
});

// ─── req.sessionId ────────────────────────────────────────────────────────────

describe('req.sessionId attachment', () => {
  test('attaches sessionId to req for new session', async () => {
    const req  = buildMockReq({});
    const res  = buildMockRes();
    const next = buildMockNext();

    await sessionMiddleware(req, res, next);

    expect(req.sessionId).toBeTruthy();
    expect(req.sessionId).toMatch(UUID_V4_REGEX);
  });

  test('attaches existing sessionId to req for returning session', async () => {
    const existingId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    const req  = buildMockReq({ epicstore_sid: existingId });
    const res  = buildMockRes();
    const next = buildMockNext();

    mockGetCache.mockResolvedValue({ pageViews: 3, startedAt: new Date().toISOString() });

    await sessionMiddleware(req, res, next);

    expect(req.sessionId).toBe(existingId);
  });

  test('always calls next()', async () => {
    const req  = buildMockReq({});
    const res  = buildMockRes();
    const next = buildMockNext();

    await sessionMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(); // no error argument
  });
});

// ─── REDIS ENRICHMENT ─────────────────────────────────────────────────────────

describe('Redis enrichment', () => {
  test('initialises sessionMeta for new session', async () => {
    const req  = buildMockReq({});
    const res  = buildMockRes();
    const next = buildMockNext();

    mockGetCache.mockResolvedValue(null); // No existing meta

    await sessionMiddleware(req, res, next);

    expect(req.sessionMeta).toMatchObject({
      pageViews: 0,
      startedAt: expect.any(String),
    });
  });

  test('increments pageViews for returning session', async () => {
    const existingId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    const req  = buildMockReq({ epicstore_sid: existingId });
    const res  = buildMockRes();
    const next = buildMockNext();

    mockGetCache.mockResolvedValue({
      pageViews:  4,
      startedAt:  '2024-01-01T00:00:00.000Z',
      lastSeenAt: '2024-01-01T00:10:00.000Z',
    });

    await sessionMiddleware(req, res, next);

    expect(req.sessionMeta.pageViews).toBe(5);
  });

  test('updates lastSeenAt on every request', async () => {
    const existingId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    const req  = buildMockReq({ epicstore_sid: existingId });
    const res  = buildMockRes();
    const next = buildMockNext();

    const oldLastSeen = '2024-01-01T00:00:00.000Z';
    mockGetCache.mockResolvedValue({
      pageViews:  1,
      startedAt:  '2024-01-01T00:00:00.000Z',
      lastSeenAt: oldLastSeen,
    });

    await sessionMiddleware(req, res, next);

    expect(req.sessionMeta.lastSeenAt).not.toBe(oldLastSeen);
  });

  test('persists updated meta back to Redis with rolling TTL', async () => {
    const existingId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    const req  = buildMockReq({ epicstore_sid: existingId });
    const res  = buildMockRes();
    const next = buildMockNext();

    mockGetCache.mockResolvedValue({ pageViews: 2, startedAt: new Date().toISOString() });

    await sessionMiddleware(req, res, next);

    expect(mockSetCache).toHaveBeenCalledWith(
      `session_meta:${existingId}`,
      expect.objectContaining({ pageViews: 3 }),
      1800 // SESSION_ROLLING_TTL default
    );
  });
});

// ─── REDIS FAILURE RESILIENCE ─────────────────────────────────────────────────

describe('Redis failure resilience', () => {
  test('does NOT throw when Redis getCache fails', async () => {
    const req  = buildMockReq({});
    const res  = buildMockRes();
    const next = buildMockNext();

    mockGetCache.mockRejectedValue(new Error('Redis connection refused'));

    // Should not throw
    await expect(sessionMiddleware(req, res, next)).resolves.not.toThrow();
  });

  test('still calls next() when Redis fails', async () => {
    const req  = buildMockReq({});
    const res  = buildMockRes();
    const next = buildMockNext();

    mockGetCache.mockRejectedValue(new Error('Redis timeout'));

    await sessionMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(); // no error
  });

  test('still sets req.sessionId when Redis fails', async () => {
    const req  = buildMockReq({});
    const res  = buildMockRes();
    const next = buildMockNext();

    mockGetCache.mockRejectedValue(new Error('Redis unavailable'));

    await sessionMiddleware(req, res, next);

    expect(req.sessionId).toBeTruthy();
    expect(req.sessionId).toMatch(UUID_V4_REGEX);
  });

  test('sets safe default sessionMeta when Redis fails', async () => {
    const req  = buildMockReq({});
    const res  = buildMockRes();
    const next = buildMockNext();

    mockGetCache.mockRejectedValue(new Error('Redis unavailable'));

    await sessionMiddleware(req, res, next);

    expect(req.sessionMeta).toMatchObject({
      pageViews: 0,
      startedAt: expect.any(String),
    });
  });

  test('still sets cookie when Redis fails', async () => {
    const req  = buildMockReq({});
    const res  = buildMockRes();
    const next = buildMockNext();

    mockGetCache.mockRejectedValue(new Error('Redis down'));

    await sessionMiddleware(req, res, next);

    expect(res.cookie).toHaveBeenCalledWith(
      'epicstore_sid',
      expect.any(String),
      expect.objectContaining({ httpOnly: true })
    );
  });

  test('does NOT throw when Redis setCache fails', async () => {
    const req  = buildMockReq({});
    const res  = buildMockRes();
    const next = buildMockNext();

    mockGetCache.mockResolvedValue(null);
    mockSetCache.mockRejectedValue(new Error('Redis write failed'));

    await expect(sessionMiddleware(req, res, next)).resolves.not.toThrow();
    expect(next).toHaveBeenCalledTimes(1);
  });
});

// ─── getSessionMeta ───────────────────────────────────────────────────────────

describe('getSessionMeta', () => {
  test('returns session metadata when found in Redis', async () => {
    const meta = { pageViews: 10, startedAt: '2024-01-01T00:00:00.000Z' };
    mockGetCache.mockResolvedValue(meta);

    const result = await getSessionMeta('test-session-id');
    expect(result).toEqual(meta);
  });

  test('returns null when session not found in Redis', async () => {
    mockGetCache.mockResolvedValue(null);

    const result = await getSessionMeta('unknown-session-id');
    expect(result).toBeNull();
  });

  test('returns null when sessionId is null or undefined', async () => {
    expect(await getSessionMeta(null)).toBeNull();
    expect(await getSessionMeta(undefined)).toBeNull();
  });

  test('returns null when Redis fails', async () => {
    mockGetCache.mockRejectedValue(new Error('Redis down'));

    const result = await getSessionMeta('test-session-id');
    expect(result).toBeNull();
  });
});

// ─── invalidateSession ────────────────────────────────────────────────────────

describe('invalidateSession', () => {
  test('clears the epicstore_sid cookie', async () => {
    const res = buildMockRes();
    await invalidateSession('test-session-id', res);

    expect(res.clearCookie).toHaveBeenCalledWith(
      'epicstore_sid',
      expect.objectContaining({ httpOnly: true })
    );
  });

  test('calls deleteCache on Redis for the session key', async () => {
    const res = buildMockRes();
    await invalidateSession('test-session-id', res);

    expect(mockDeleteCache).toHaveBeenCalledWith('session_meta:test-session-id');
  });

  test('does not throw when sessionId is null', async () => {
    const res = buildMockRes();
    await expect(invalidateSession(null, res)).resolves.not.toThrow();
    // Cookie should still be cleared
    expect(res.clearCookie).toHaveBeenCalled();
  });

  test('does not throw when Redis deleteCache fails', async () => {
    mockDeleteCache.mockRejectedValue(new Error('Redis down'));
    const res = buildMockRes();
    await expect(invalidateSession('test-session-id', res)).resolves.not.toThrow();
  });
});
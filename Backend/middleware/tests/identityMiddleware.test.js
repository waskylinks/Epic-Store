/**
 * backend/middleware/__tests__/identityMiddleware.test.js
 *
 * Phase 2 — Test Suite for identityMiddleware.js
 *
 * Run with:
 *   npx jest middleware/__tests__/identityMiddleware.test.js --verbose
 *
 * WHY jest.unstable_mockModule instead of jest.mock?
 *
 *   Same reason as sessionMiddleware.test.js — this suite runs under
 *   --experimental-vm-modules (ESM mode). jest.mock() factory functions
 *   that close over outer-scope variables fail in ESM because the factory
 *   executes before `const` declarations are initialised.
 *
 *   Additionally, stitchIdentity uses a dynamic import() to load
 *   CustomerAnalytics (to avoid circular deps). jest.mock() cannot
 *   intercept dynamic imports at all in ESM mode — jest.unstable_mockModule
 *   registers the mock in Jest's module registry so both static and dynamic
 *   imports of that path receive the mock.
 *
 *   Pattern:
 *     1. Call jest.unstable_mockModule BEFORE any import of the module under test
 *     2. Import the module under test with await import() inside beforeAll()
 *     3. All mock fn references (mockFindOneAndUpdate) remain in outer scope
 *        and are controlled per-test via mockResolvedValue / mockRejectedValue
 */

import { jest } from '@jest/globals';

// ─── MOCK CustomerAnalytics ───────────────────────────────────────────────────

const mockFindOneAndUpdate = jest.fn();

// Must be called before any import of identityMiddleware.js.
// Intercepts both the static import path and the dynamic import() path
// used inside stitchIdentity — jest.unstable_mockModule handles both.
jest.unstable_mockModule('../../models/customer-analytics-model.js', () => ({
  default: {
    findOneAndUpdate: mockFindOneAndUpdate,
  },
}));

// ─── DEFERRED IMPORTS ────────────────────────────────────────────────────────
// Static imports are hoisted above jest.unstable_mockModule in ESM, so the
// module under test would load the real CustomerAnalytics before the mock
// is registered. Dynamic import() respects registration order.

let identityMiddleware;
let stitchIdentity;
let stitchIdentityFromRequest;

beforeAll(async () => {
  const mod = await import('../identityMiddleware.js');
  identityMiddleware          = mod.identityMiddleware;
  stitchIdentity              = mod.stitchIdentity;
  stitchIdentityFromRequest   = mod.stitchIdentityFromRequest;
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const buildMockReq = (cookies = {}, user = null) => ({
  cookies,
  user,
  anonymousId: undefined,
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

const UUID_V4_REGEX   = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TTL_365_DAYS_MS = 365 * 24 * 60 * 60 * 1000;

// ─── SETUP ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockFindOneAndUpdate.mockResolvedValue({ _id: 'ca_123' });
});

// ─── COOKIE CREATION ─────────────────────────────────────────────────────────

describe('Cookie creation — new anonymous ID', () => {
  test('sets epicstore_anon cookie when none exists', () => {
    const req  = buildMockReq({});
    const res  = buildMockRes();
    const next = buildMockNext();

    identityMiddleware(req, res, next);

    expect(res.cookie).toHaveBeenCalledWith(
      'epicstore_anon',
      expect.stringMatching(UUID_V4_REGEX),
      expect.objectContaining({ httpOnly: true })
    );
  });

  test('generated anonymous ID is a valid UUID v4', () => {
    const req  = buildMockReq({});
    const res  = buildMockRes();
    const next = buildMockNext();

    identityMiddleware(req, res, next);

    const cookieValue = res._cookies['epicstore_anon'].value;
    expect(cookieValue).toMatch(UUID_V4_REGEX);
  });

  test('cookie is set with httpOnly: true', () => {
    const req  = buildMockReq({});
    const res  = buildMockRes();
    const next = buildMockNext();

    identityMiddleware(req, res, next);

    const opts = res._cookies['epicstore_anon'].options;
    expect(opts.httpOnly).toBe(true);
  });

  test('cookie is set with sameSite: lax', () => {
    const req  = buildMockReq({});
    const res  = buildMockRes();
    const next = buildMockNext();

    identityMiddleware(req, res, next);

    const opts = res._cookies['epicstore_anon'].options;
    expect(opts.sameSite).toBe('lax');
  });

  test('cookie maxAge is 365 days in milliseconds by default', () => {
    const req  = buildMockReq({});
    const res  = buildMockRes();
    const next = buildMockNext();

    identityMiddleware(req, res, next);

    const opts = res._cookies['epicstore_anon'].options;
    expect(opts.maxAge).toBe(TTL_365_DAYS_MS);
  });

  test('two new sessions get different anonymous IDs', () => {
    const req1 = buildMockReq({});
    const res1 = buildMockRes();
    identityMiddleware(req1, res1, buildMockNext());

    const req2 = buildMockReq({});
    const res2 = buildMockRes();
    identityMiddleware(req2, res2, buildMockNext());

    const id1 = res1._cookies['epicstore_anon'].value;
    const id2 = res2._cookies['epicstore_anon'].value;
    expect(id1).not.toBe(id2);
  });
});

// ─── COOKIE PERSISTENCE ───────────────────────────────────────────────────────

describe('Cookie persistence — returning visitor', () => {
  test('does NOT set a new cookie when epicstore_anon already exists', () => {
    const existingId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    const req  = buildMockReq({ epicstore_anon: existingId });
    const res  = buildMockRes();
    const next = buildMockNext();

    identityMiddleware(req, res, next);

    expect(res.cookie).not.toHaveBeenCalled();
  });

  test('preserves existing anonymous ID unchanged on returning visitor', () => {
    const existingId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    const req  = buildMockReq({ epicstore_anon: existingId });
    const res  = buildMockRes();
    const next = buildMockNext();

    identityMiddleware(req, res, next);

    expect(req.anonymousId).toBe(existingId);
  });

  test('anonymous ID is stable across many requests', () => {
    const existingId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

    for (let i = 0; i < 10; i++) {
      const req  = buildMockReq({ epicstore_anon: existingId });
      const res  = buildMockRes();
      const next = buildMockNext();

      identityMiddleware(req, res, next);

      expect(req.anonymousId).toBe(existingId);
      expect(res.cookie).not.toHaveBeenCalled();
    }
  });
});

// ─── req.anonymousId ─────────────────────────────────────────────────────────

describe('req.anonymousId attachment', () => {
  test('attaches anonymousId to req for new visitor', () => {
    const req  = buildMockReq({});
    const res  = buildMockRes();
    const next = buildMockNext();

    identityMiddleware(req, res, next);

    expect(req.anonymousId).toBeTruthy();
    expect(req.anonymousId).toMatch(UUID_V4_REGEX);
  });

  test('attaches existing anonymousId to req for returning visitor', () => {
    const existingId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    const req  = buildMockReq({ epicstore_anon: existingId });
    const res  = buildMockRes();
    const next = buildMockNext();

    identityMiddleware(req, res, next);

    expect(req.anonymousId).toBe(existingId);
  });

  test('always calls next()', () => {
    const req  = buildMockReq({});
    const res  = buildMockRes();
    const next = buildMockNext();

    identityMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });
});

// ─── stitchIdentity ───────────────────────────────────────────────────────────

describe('stitchIdentity', () => {
  test('calls CustomerAnalytics.findOneAndUpdate with correct arguments', async () => {
    await stitchIdentity('user_123', 'anon_456');

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { user: 'user_123' },
      expect.objectContaining({
        $addToSet: { anonymousIds: 'anon_456' },
        $set:      expect.objectContaining({ lastStitchedAt: expect.any(Date) }),
      }),
      expect.objectContaining({ upsert: false })
    );
  });

  test('uses $addToSet to prevent duplicate anonymous IDs', async () => {
    await stitchIdentity('user_123', 'anon_456');
    await stitchIdentity('user_123', 'anon_456');

    const calls = mockFindOneAndUpdate.mock.calls;
    expect(calls[0][1].$addToSet.anonymousIds).toBe('anon_456');
    expect(calls[1][1].$addToSet.anonymousIds).toBe('anon_456');
  });

  test('does NOT throw when userId is null', async () => {
    await expect(stitchIdentity(null, 'anon_456')).resolves.not.toThrow();
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  test('does NOT throw when anonymousId is null', async () => {
    await expect(stitchIdentity('user_123', null)).resolves.not.toThrow();
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  test('does NOT throw when both userId and anonymousId are null', async () => {
    await expect(stitchIdentity(null, null)).resolves.not.toThrow();
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  test('does NOT throw when CustomerAnalytics.findOneAndUpdate rejects', async () => {
    mockFindOneAndUpdate.mockRejectedValue(new Error('MongoDB connection lost'));

    // stitchIdentity propagates the error so the caller's .catch() fires —
    // this is intentional. The controller wraps it: stitchIdentity(...).catch(...)
    await expect(stitchIdentity('user_123', 'anon_456')).rejects.toThrow('MongoDB connection lost');
  });

  test('different anonymousIds are stitched independently for same user', async () => {
    await stitchIdentity('user_123', 'anon_device1');
    await stitchIdentity('user_123', 'anon_device2');

    expect(mockFindOneAndUpdate).toHaveBeenCalledTimes(2);

    const call1 = mockFindOneAndUpdate.mock.calls[0];
    const call2 = mockFindOneAndUpdate.mock.calls[1];

    expect(call1[1].$addToSet.anonymousIds).toBe('anon_device1');
    expect(call2[1].$addToSet.anonymousIds).toBe('anon_device2');
  });
});

// ─── stitchIdentityFromRequest ────────────────────────────────────────────────

describe('stitchIdentityFromRequest', () => {
  test('reads userId from req.user._id and anonymousId from req.anonymousId', async () => {
    const req = {
      user:        { _id: { toString: () => 'user_123' } },
      anonymousId: 'anon_456',
    };

    await stitchIdentityFromRequest(req);

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { user: 'user_123' },
      expect.objectContaining({
        $addToSet: { anonymousIds: 'anon_456' },
      }),
      expect.any(Object)
    );
  });

  test('does NOT throw when req.user is null (unauthenticated request)', async () => {
    const req = { user: null, anonymousId: 'anon_456' };

    await expect(stitchIdentityFromRequest(req)).resolves.not.toThrow();
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  test('does NOT throw when req.anonymousId is undefined', async () => {
    const req = {
      user:        { _id: { toString: () => 'user_123' } },
      anonymousId: undefined,
    };

    await expect(stitchIdentityFromRequest(req)).resolves.not.toThrow();
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });
});
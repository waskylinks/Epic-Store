/**
 * backend/utils/__tests__/referrerReconstruction.test.js
 *
 * Phase 3 — Test Suite for referrerReconstruction.js
 *
 * Run with:
 *   npx jest utils/__tests__/referrerReconstruction.test.js --verbose
 *
 * Tests validate:
 *   1. All reconstruction rules fire correctly for matching patterns
 *   2. Rules return null when pattern does not match
 *   3. Checkout/cart paths always return null
 *   4. reconstructionRule names match documented values
 *   5. Output always has isReconstructed semantics (caller sets the flag)
 *   6. getReconstructionRules returns correct metadata
 */

import {
  reconstructReferrer,
  getReconstructionRules,
} from '../referrerReconstruction.js';

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const reconstruct = (overrides = {}) => reconstructReferrer({
  landingPage:       '/products/blue-sneakers',
  sessionContinuity: false,
  isFirstVisit:      true,
  ...overrides,
});

// ─── NULL SAFETY ──────────────────────────────────────────────────────────────

describe('Null safety', () => {
  test('returns null when landingPage is null', () => {
    expect(reconstructReferrer({ landingPage: null, sessionContinuity: false, isFirstVisit: true })).toBeNull();
  });

  test('returns null when landingPage is undefined', () => {
    expect(reconstructReferrer({ landingPage: undefined, sessionContinuity: false, isFirstVisit: true })).toBeNull();
  });

  test('returns null when landingPage is empty string', () => {
    expect(reconstructReferrer({ landingPage: '', sessionContinuity: false, isFirstVisit: true })).toBeNull();
  });
});

// ─── CHECKOUT AND CART PATH GUARD ─────────────────────────────────────────────

describe('Checkout and cart path guard', () => {
  const checkoutPaths = [
    '/shipping',
    '/order/confirm',
    '/process/payment',
    '/cart',
  ];

  checkoutPaths.forEach(path => {
    test(`returns null for checkout/cart path: ${path}`, () => {
      const result = reconstruct({ landingPage: path, isFirstVisit: true });
      expect(result).toBeNull();
    });
  });

  test('returns null for cart even on returning visitor', () => {
    const result = reconstruct({
      landingPage:       '/cart',
      sessionContinuity: true,
      isFirstVisit:      false,
    });
    expect(result).toBeNull();
  });
});

// ─── RULE 1: first_visit_product_page ────────────────────────────────────────

describe('Rule: first_visit_product_page', () => {
  test('fires for first visit to a product detail page', () => {
    const result = reconstruct({
      landingPage:  '/products/blue-sneakers',
      isFirstVisit: true,
      sessionContinuity: false,
    });

    expect(result).not.toBeNull();
    expect(result.reconstructionRule).toBe('first_visit_product_page');
    expect(result.source).toBe('dark_social');
    expect(result.medium).toBe('social');
  });

  test('fires for deeply nested product paths', () => {
    const result = reconstruct({
      landingPage:  '/products/category/subcategory/product-slug',
      isFirstVisit: true,
      sessionContinuity: false,
    });
    expect(result?.reconstructionRule).toBe('first_visit_product_page');
  });

  test('does NOT fire for returning visitor (different rule applies)', () => {
    const result = reconstruct({
      landingPage:       '/products/blue-sneakers',
      isFirstVisit:      false,
      sessionContinuity: true,
    });
    // Should match returning_visitor_product_page instead
    expect(result?.reconstructionRule).not.toBe('first_visit_product_page');
  });

  test('does NOT fire for /products list page (no slug)', () => {
    const result = reconstruct({
      landingPage:  '/products',
      isFirstVisit: true,
      sessionContinuity: false,
    });
    // /products matches category page rule, not product page rule
    expect(result?.reconstructionRule).not.toBe('first_visit_product_page');
  });
});

// ─── RULE 2: returning_visitor_product_page ───────────────────────────────────

describe('Rule: returning_visitor_product_page', () => {
  test('fires for returning visitor with session on product page', () => {
    const result = reconstruct({
      landingPage:       '/products/red-hoodie',
      sessionContinuity: true,
      isFirstVisit:      false,
    });

    expect(result).not.toBeNull();
    expect(result.reconstructionRule).toBe('returning_visitor_product_page');
    expect(result.source).toBe('returning_direct');
    expect(result.medium).toBe('none');
  });

  test('does NOT fire when no session continuity', () => {
    const result = reconstruct({
      landingPage:       '/products/red-hoodie',
      sessionContinuity: false,
      isFirstVisit:      true,
    });
    // Should match first_visit_product_page instead
    expect(result?.reconstructionRule).not.toBe('returning_visitor_product_page');
  });
});

// ─── RULE 3: first_visit_promo_page ──────────────────────────────────────────

describe('Rule: first_visit_promo_page', () => {
  test('fires for first visit to /sale', () => {
    const result = reconstruct({
      landingPage:  '/sale',
      isFirstVisit: true,
      sessionContinuity: false,
    });

    expect(result).not.toBeNull();
    expect(result.reconstructionRule).toBe('first_visit_promo_page');
    expect(result.source).toBe('likely_email_or_social');
    expect(result.medium).toBe('email');
  });

  test('fires for first visit to /new-arrivals', () => {
    const result = reconstruct({
      landingPage:  '/new-arrivals',
      isFirstVisit: true,
      sessionContinuity: false,
    });

    expect(result).not.toBeNull();
    expect(result.reconstructionRule).toBe('first_visit_promo_page');
  });

  test('fires for /sale with query string', () => {
    const result = reconstruct({
      landingPage:  '/sale?category=shoes',
      isFirstVisit: true,
      sessionContinuity: false,
    });
    expect(result?.reconstructionRule).toBe('first_visit_promo_page');
  });

  test('does NOT fire for returning visitor (different rule applies)', () => {
    const result = reconstruct({
      landingPage:       '/sale',
      isFirstVisit:      false,
      sessionContinuity: true,
    });
    expect(result?.reconstructionRule).not.toBe('first_visit_promo_page');
  });
});

// ─── RULE 4: returning_visitor_sale_page ─────────────────────────────────────

describe('Rule: returning_visitor_sale_page', () => {
  test('fires for returning visitor to /sale', () => {
    const result = reconstruct({
      landingPage:       '/sale',
      sessionContinuity: true,
      isFirstVisit:      false,
    });

    expect(result).not.toBeNull();
    expect(result.reconstructionRule).toBe('returning_visitor_sale_page');
    expect(result.source).toBe('likely_retargeting');
    expect(result.medium).toBe('paid');
  });

  test('does NOT fire for /new-arrivals returning visitor', () => {
    const result = reconstruct({
      landingPage:       '/new-arrivals',
      sessionContinuity: true,
      isFirstVisit:      false,
    });
    expect(result?.reconstructionRule).not.toBe('returning_visitor_sale_page');
  });
});

// ─── RULE 5: first_visit_category_page ───────────────────────────────────────

describe('Rule: first_visit_category_page', () => {
  test('fires for first visit to /products list', () => {
    const result = reconstruct({
      landingPage:  '/products',
      isFirstVisit: true,
      sessionContinuity: false,
    });

    expect(result).not.toBeNull();
    expect(result.reconstructionRule).toBe('first_visit_category_page');
    expect(result.source).toBe('likely_organic');
    expect(result.medium).toBe('organic');
  });

  test('fires for /categories path', () => {
    const result = reconstruct({
      landingPage:  '/categories',
      isFirstVisit: true,
      sessionContinuity: false,
    });
    expect(result?.reconstructionRule).toBe('first_visit_category_page');
  });

  test('fires for /products with query string', () => {
    const result = reconstruct({
      landingPage:  '/products?category=shoes&page=2',
      isFirstVisit: true,
      sessionContinuity: false,
    });
    expect(result?.reconstructionRule).toBe('first_visit_category_page');
  });
});

// ─── NO RULE MATCHES ─────────────────────────────────────────────────────────

describe('No rule matches — returns null', () => {
  test('returns null for first visit to homepage', () => {
    const result = reconstruct({
      landingPage:  '/',
      isFirstVisit: true,
      sessionContinuity: false,
    });
    expect(result).toBeNull();
  });

  test('returns null for first visit to /about-us', () => {
    const result = reconstruct({
      landingPage:  '/about-us',
      isFirstVisit: true,
      sessionContinuity: false,
    });
    expect(result).toBeNull();
  });

  test('returns null for /login page', () => {
    const result = reconstruct({
      landingPage:  '/login',
      isFirstVisit: true,
      sessionContinuity: false,
    });
    expect(result).toBeNull();
  });

  test('returns null for /profile page', () => {
    const result = reconstruct({
      landingPage:  '/profile',
      isFirstVisit: false,
      sessionContinuity: true,
    });
    expect(result).toBeNull();
  });
});

// ─── RULE OUTPUT SHAPE ────────────────────────────────────────────────────────

describe('Rule output shape', () => {
  test('every non-null result has source, medium, reconstructionRule', () => {
    const testCases = [
      { landingPage: '/products/item', isFirstVisit: true,  sessionContinuity: false },
      { landingPage: '/products/item', isFirstVisit: false, sessionContinuity: true  },
      { landingPage: '/sale',          isFirstVisit: true,  sessionContinuity: false },
      { landingPage: '/sale',          isFirstVisit: false, sessionContinuity: true  },
      { landingPage: '/products',      isFirstVisit: true,  sessionContinuity: false },
    ];

    testCases.forEach(params => {
      const result = reconstructReferrer(params);
      if (result !== null) {
        expect(result).toHaveProperty('source');
        expect(result).toHaveProperty('medium');
        expect(result).toHaveProperty('reconstructionRule');
        expect(typeof result.source).toBe('string');
        expect(typeof result.medium).toBe('string');
        expect(typeof result.reconstructionRule).toBe('string');
      }
    });
  });

  test('reconstructionRule names use snake_case', () => {
    const rules = getReconstructionRules();
    rules.forEach(({ rule }) => {
      expect(rule).toMatch(/^[a-z]+(_[a-z]+)*$/);
    });
  });
});

// ─── getReconstructionRules ───────────────────────────────────────────────────

describe('getReconstructionRules', () => {
  test('returns an array of rule metadata objects', () => {
    const rules = getReconstructionRules();
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(0);
  });

  test('each rule has required metadata fields', () => {
    const rules = getReconstructionRules();
    rules.forEach(rule => {
      expect(rule).toHaveProperty('rule');
      expect(rule).toHaveProperty('description');
      expect(rule).toHaveProperty('targetSource');
      expect(rule).toHaveProperty('targetMedium');
    });
  });

  test('rule names match actual reconstruction output', () => {
    const rules       = getReconstructionRules();
    const ruleNames   = rules.map(r => r.rule);
    const knownRules  = [
      'first_visit_product_page',
      'returning_visitor_product_page',
      'first_visit_promo_page',
      'returning_visitor_sale_page',
      'first_visit_category_page',
    ];
    knownRules.forEach(name => {
      expect(ruleNames).toContain(name);
    });
  });
});
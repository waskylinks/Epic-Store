/**
 * backend/utils/referrerReconstruction.js
 *
 * Phase 3/4 — Referrer Reconstruction Engine
 *
 * Reduces fake direct traffic by inferring probable attribution sources
 * when all direct signals (UTMs, click IDs, referrer header) are absent.
 *
 * Design rules (critical — read before adding new rules):
 *
 *   1. ONLY runs when confidence would otherwise be LOW.
 *      The guard lives in attributionMiddleware.js:
 *        if (confidenceLevel === 'LOW' && !hasUTM && !hasClickId && !hasReferrer)
 *      Never call this function with any direct signals present.
 *
 *   2. ALWAYS sets isReconstructed: true on the output.
 *      Reconstructed data must never be mixed silently with raw data.
 *      BigQuery queries can filter on is_reconstructed to exclude or
 *      separately analyze inferred attribution.
 *
 *   3. Returns null when no conservative inference is possible.
 *      Better to report LOW confidence "direct" than to guess wrong.
 *      Do NOT add rules that are speculative — only add rules backed
 *      by observed patterns in your real traffic data (after 30 days
 *      of Phase 9 BigQuery data collection).
 *
 *   4. Rules are ordered from most specific to least specific.
 *      The first matching rule wins and the function returns immediately.
 *      Keep the most reliable inferences at the top.
 *
 *   5. reconstructionRule names use snake_case and describe the pattern,
 *      not the conclusion (e.g. "returning_product_direct" not "returning_paid").
 *      This makes audit queries readable in BigQuery.
 *
 * Adding new rules:
 *   Only add rules after analyzing 30+ days of BigQuery data.
 *   Identify patterns in your direct traffic that correlate with known
 *   paid or social channels. Document the rule with a comment explaining
 *   what traffic pattern it targets and what evidence supports it.
 */

// ─── PATH MATCHERS ────────────────────────────────────────────────────────────
// Centralised so rules reference named patterns, not raw strings.
// Update these if your route structure changes.

const PATHS = {
  productPage:  (path) => /^\/products\/[^/]+/.test(path),
  categoryPage: (path) => /^\/products\/?(\?.*)?$/.test(path) || /^\/categories/.test(path),
  salePage:     (path) => /^\/sale/.test(path),
  newArrivals:  (path) => /^\/new-arrivals/.test(path),
  homepage:     (path) => path === '/' || path === '',
  checkoutPath: (path) => /^\/shipping|\/order\/confirm|\/process\/payment/.test(path),
  cartPage:     (path) => /^\/cart/.test(path),
};

// ─── RECONSTRUCTION ENGINE ────────────────────────────────────────────────────

/**
 * reconstructReferrer
 *
 * Attempts to infer attribution source when all direct signals are absent.
 * Returns a reconstruction result or null if no confident inference is possible.
 *
 * @param {Object}  params
 * @param {string}  params.landingPage       - The full URL path of the current request
 * @param {boolean} params.sessionContinuity - true if user has an existing session cookie
 * @param {boolean} params.isFirstVisit      - true if this is a new session (no cookie)
 * @returns {{ source, medium, reconstructionRule } | null}
 */
export const reconstructReferrer = ({ landingPage, sessionContinuity, isFirstVisit }) => {
  // Safety check — should never be called with a missing landingPage
  if (!landingPage) return null;

  // Normalize: strip query string for path matching
  const path = landingPage.split('?')[0];

  // ── Rule 1: Skip checkout/cart paths ─────────────────────────────────────
  // Checkout and cart pages are navigated to internally — never from an ad.
  // Reconstructing attribution for these would produce meaningless results.
  if (PATHS.checkoutPath(path) || PATHS.cartPage(path)) {
    return null;
  }

  // ── Rule 2: First visit to a specific product page ────────────────────────
  // Pattern: No cookies (first visit), landed directly on a product detail page.
  // Signal: Deep product URLs are rarely typed manually — users arrive via
  //         social shares (WhatsApp, Telegram, Slack) or dark social links.
  //         Dark social = messaging apps that strip referrer headers.
  // Evidence: This is the most common source of "dark social" traffic.
  // Confidence: Conservative — tagged as social/dark_social, not a specific platform.
  if (isFirstVisit && PATHS.productPage(path)) {
    return {
      source:             'dark_social',
      medium:             'social',
      reconstructionRule: 'first_visit_product_page',
    };
  }

  // ── Rule 3: Returning visitor to a specific product page ──────────────────
  // Pattern: Has existing session, landed directly on a product detail page.
  // Signal: User has visited before. Direct return to a specific product
  //         suggests they bookmarked it, shared the link themselves, or
  //         are returning from a paid/social exposure they remember.
  // Evidence: Reduces "direct" misattribution for known returning users.
  if (sessionContinuity && PATHS.productPage(path)) {
    return {
      source:             'returning_direct',
      medium:             'none',
      reconstructionRule: 'returning_visitor_product_page',
    };
  }

  // ── Rule 4: First visit to sale or new arrivals page ─────────────────────
  // Pattern: No cookies, landed on /sale or /new-arrivals.
  // Signal: These pages are campaign destinations. Users who arrive on
  //         promotional pages without UTMs likely clicked an email or
  //         social post where the sender stripped/forgot UTM params.
  // Evidence: Email clients and some social platforms strip query params.
  //           UTM-less promo page landings are a known email attribution gap.
  if (isFirstVisit && (PATHS.salePage(path) || PATHS.newArrivals(path))) {
    return {
      source:             'likely_email_or_social',
      medium:             'email',
      reconstructionRule: 'first_visit_promo_page',
    };
  }

  // ── Rule 5: Returning visitor to sale page ────────────────────────────────
  // Pattern: Has session, lands on /sale.
  // Signal: Promotional pages as second+ visit often indicate the user
  //         was reminded by an email or retargeting ad (without click ID).
  if (sessionContinuity && PATHS.salePage(path)) {
    return {
      source:             'likely_retargeting',
      medium:             'paid',
      reconstructionRule: 'returning_visitor_sale_page',
    };
  }

  // ── Rule 6: First visit to category or product list page ─────────────────
  // Pattern: No cookies, landed on /products or /categories.
  // Signal: Category landings without referrer are often from search (SEO)
  //         where the referrer was stripped by HTTPS→HTTP transition, or
  //         from a social post linking to a category.
  if (isFirstVisit && PATHS.categoryPage(path)) {
    return {
      source:             'likely_organic',
      medium:             'organic',
      reconstructionRule: 'first_visit_category_page',
    };
  }

  // ── No rule matched — cannot make a conservative inference ────────────────
  // Return null so the caller keeps the raw source ("direct") with LOW confidence.
  // This is the correct behaviour — we never force an attribution guess.
  return null;
};

// ─── RULE AUDIT HELPER ────────────────────────────────────────────────────────

/**
 * getReconstructionRules
 *
 * Returns metadata about all active reconstruction rules.
 * Used by the observability controller (Phase 10) to populate the
 * attribution health dashboard with rule-level breakdown.
 *
 * @returns {Array<{ rule, description, targetSource, targetMedium }>}
 */
export const getReconstructionRules = () => [
  {
    rule:          'first_visit_product_page',
    description:   'First visit to a product detail page with no signals — dark social',
    targetSource:  'dark_social',
    targetMedium:  'social',
  },
  {
    rule:          'returning_visitor_product_page',
    description:   'Returning visitor to product page with no signals — returning direct',
    targetSource:  'returning_direct',
    targetMedium:  'none',
  },
  {
    rule:          'first_visit_promo_page',
    description:   'First visit to /sale or /new-arrivals — likely email without UTMs',
    targetSource:  'likely_email_or_social',
    targetMedium:  'email',
  },
  {
    rule:          'returning_visitor_sale_page',
    description:   'Returning visitor to /sale — likely retargeting ad without click ID',
    targetSource:  'likely_retargeting',
    targetMedium:  'paid',
  },
  {
    rule:          'first_visit_category_page',
    description:   'First visit to category page — likely organic search with stripped referrer',
    targetSource:  'likely_organic',
    targetMedium:  'organic',
  },
];
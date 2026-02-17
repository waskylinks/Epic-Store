// BUG: RESERVED_SLUGS was defined in products-route.js and imported by
// product-controller.js, while products-route.js simultaneously imports
// from product-controller.js. This mutual ESM cycle means that when Node
// evaluates the first module in the chain, the second module's exports are
// an incomplete namespace — RESERVED_SLUGS is a live binding that resolves
// to undefined at the moment product-controller.js captures it.
//
// Although ESM live bindings mean the value resolves correctly before any
// HTTP request is handled (since requests arrive after startup completes),
// this is an architectural antipattern that breaks static analysis, makes
// tree-shaking unreliable, and is one refactor away from a runtime crash.
//
// FIX: Extract RESERVED_SLUGS to this standalone module. Both
// product-controller.js and products-route.js import from here — no cycle.

export const RESERVED_SLUGS = new Set([
  'trending',
  'new-arrivals',
  'featured',
  'bestsellers',
  'search',
  'category',
  'brand',
  'sale',
  'sitemap',
  'robots'
]);


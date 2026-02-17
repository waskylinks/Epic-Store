// FIX #7 — Single source of truth for category URL slug conversion.
// Previously seo.service.js used /\s+/g and seo-routes.js used /[\s&]+/g,
// causing "Clothing & Apparel" to produce "/clothing-&-apparel" in
// breadcrumbs but "/clothing-apparel" in the sitemap — those links 404'd.
//
// Import categoryToSlug and categorySlugToName everywhere category URL
// segments are produced or consumed.

export const VALID_CATEGORIES = [
  'Electronics',
  'Clothing & Apparel',
  'Home & Living',
  'Sports & Outdoors',
  'Beauty & Personal Care',
  'Books & Media',
  'Food & Beverages'
];

export const categoryToSlug = (category) =>
  category.toLowerCase().replace(/[\s&]+/g, '-');

export const categorySlugToName = (slug) => {
  const normalised = slug.toLowerCase();
  return VALID_CATEGORIES.find(
    cat => categoryToSlug(cat) === normalised
  ) ?? null;
};
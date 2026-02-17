import express from 'express';
import seoService, { SEOService } from '../services/seoService.js';
import { getCacheRaw, setCacheRaw, deleteCachePattern } from '../utils/redis.js';
import Product from '../models/product-model.js';
import { verifyUserAuth, roleBaseAccess } from '../middleware/user-auth.js';
import { categoryToSlug, categorySlugToName, VALID_CATEGORIES } from '../utils/categorySlug.js';

const router = express.Router();

// ============================================
// HELPERS
// ============================================

const getSitemapBaseUrl = (req) => {
  const envUrl = process.env.FRONTEND_URL;

  if (envUrl) {
    return envUrl.replace(/\/$/, '');
  }

  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  console.warn(
    'FRONTEND_URL env var is not set. Falling back to request-derived URL. ' +
    'Set FRONTEND_URL in production to avoid sitemap/canonical mismatches.'
  );
  return `${protocol}://${host}`;
};

// ============================================
// PUBLIC SITEMAP ROUTES
// ============================================

router.get('/sitemap.xml', async (req, res) => {
  try {
    const baseUrl = getSitemapBaseUrl(req);
    const sitemap = await seoService.generateSitemap({ baseUrl });

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(sitemap);
  } catch (error) {
    console.error('Sitemap generation error:', error);
    res.status(500).type('text').send('Error generating sitemap');
  }
});

router.get('/sitemap_index.xml', async (req, res) => {
  try {
    const cacheKey = 'sitemap_index';
    const cached = await getCacheRaw(cacheKey);

    if (cached) {
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(cached);
    }

    const baseUrl = getSitemapBaseUrl(req);
    const today = new Date().toISOString().split('T')[0];

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

    xml += '  <sitemap>\n';
    xml += `    <loc>${baseUrl}/sitemap.xml</loc>\n`;
    xml += `    <lastmod>${today}</lastmod>\n`;
    xml += '  </sitemap>\n';

    // FIX #7 — Use shared categoryToSlug() so category URL slugs are
    // identical across sitemap index, category sitemaps, and breadcrumbs.
    for (const category of VALID_CATEGORIES) {
      xml += '  <sitemap>\n';
      xml += `    <loc>${baseUrl}/sitemap-${categoryToSlug(category)}.xml</loc>\n`;
      xml += `    <lastmod>${today}</lastmod>\n`;
      xml += '  </sitemap>\n';
    }

    xml += '</sitemapindex>';

    await setCacheRaw(cacheKey, xml, 3600);

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(xml);
  } catch (error) {
    console.error('Sitemap index generation error:', error);
    res.status(500).type('text').send('Error generating sitemap index');
  }
});

router.get('/sitemap-:category.xml', async (req, res) => {
  try {
    const { category } = req.params;

    // FIX #7 — categorySlugToName() imported from shared util so the
    // lookup logic is identical to seoService.generateBreadcrumbs().
    const categoryName = categorySlugToName(category);
    if (!categoryName) {
      return res.status(404).type('text').send('Category not found');
    }

    const cacheKey = `sitemap_category_${category}`;
    const cached = await getCacheRaw(cacheKey);

    if (cached) {
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(cached);
    }

    const products = await Product.find({
      status: 'published',
      'seo.noIndex': false,
      category: categoryName
    })
    .select('slug lastModifiedAt publishedAt createdAt isFeatured isNewArrival isBestseller')
    .sort({ lastModifiedAt: -1 })
    .lean();

    if (products.length === 0) {
      return res.status(404).type('text').send('No products found for this category');
    }

    const baseUrl = getSitemapBaseUrl(req);

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

    for (const product of products) {
      // FIX #6 — Delegate to shared SEOService.getSitemapUrlMeta() instead
      // of inlining the priority/changefreq logic that also lives in
      // seoService.generateSitemap(). One place to update business rules.
      const { lastMod, changefreq, priority } = SEOService.getSitemapUrlMeta(product);

      xml += '  <url>\n';
      xml += `    <loc>${baseUrl}/products/${product.slug}</loc>\n`;
      if (lastMod) {
        xml += `    <lastmod>${new Date(lastMod).toISOString().split('T')[0]}</lastmod>\n`;
      }
      xml += `    <changefreq>${changefreq}</changefreq>\n`;
      xml += `    <priority>${priority}</priority>\n`;
      xml += '  </url>\n';
    }

    xml += '</urlset>';

    await setCacheRaw(cacheKey, xml, 3600);

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(xml);
  } catch (error) {
    console.error('Category sitemap generation error:', error);
    res.status(500).type('text').send('Error generating category sitemap');
  }
});

router.get('/robots.txt', (req, res) => {
  const baseUrl = getSitemapBaseUrl(req);
  const robotsTxt = seoService.generateRobotsTxt(baseUrl);

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(robotsTxt);
});

// ============================================
// ADMIN SITEMAP ROUTES
// FIX #10 — Removed the /api/v1 prefix from route paths. This router is
// mounted at /api/v1 in app.js, so including it here produced the double-
// prefixed path /api/v1/api/v1/sitemap/stats, which always 404'd.
// ============================================

router.get(
  '/sitemap/stats',
  verifyUserAuth,
  roleBaseAccess('admin'),
  async (req, res) => {
    try {
      const [total, published, indexable, noIndex, categoryBreakdown, recentlyUpdated] =
        await Promise.all([
          Product.countDocuments(),
          Product.countDocuments({ status: 'published' }),
          Product.countDocuments({ status: 'published', 'seo.noIndex': false }),
          Product.countDocuments({ status: 'published', 'seo.noIndex': true }),
          Product.aggregate([
            { $match: { status: 'published', 'seo.noIndex': false } },
            { $group: { _id: '$category', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
          ]),
          Product.find({ status: 'published', 'seo.noIndex': false })
            .select('name slug lastModifiedAt')
            .sort({ lastModifiedAt: -1 })
            .limit(10)
            .lean()
        ]);

      res.json({
        success: true,
        stats: {
          total,
          published,
          indexable,
          noIndex,
          indexablePercentage: total > 0
            ? ((indexable / total) * 100).toFixed(2)
            : '0.00',
          categoryBreakdown,
          recentlyUpdated
        }
      });
    } catch (error) {
      console.error('Sitemap stats error:', error);
      res.status(500).json({ success: false, message: 'Error fetching sitemap stats' });
    }
  }
);

router.post(
  '/sitemap/refresh',
  verifyUserAuth,
  roleBaseAccess('admin'),
  async (req, res) => {
    try {
      await deleteCachePattern('sitemap*');

      const baseUrl = getSitemapBaseUrl(req);
      const sitemap = await seoService.generateSitemap({ skipCache: true, baseUrl });

      res.json({
        success: true,
        message: 'Sitemap cache cleared and regenerated',
        size: sitemap.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Sitemap refresh error:', error);
      res.status(500).json({ success: false, message: 'Error refreshing sitemap' });
    }
  }
);

export default router;
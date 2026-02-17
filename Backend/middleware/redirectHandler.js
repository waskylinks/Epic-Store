import Product from '../models/product-model.js';

/**
 * Express error-handling middleware for SEO slug redirects.
 *
 * When a product's slug is renamed, its old slug is stored in slugHistory.
 * The public route /products/:slug returns 404 for the old slug (via
 * getProductBySlug), which Express forwards to this error handler. If the
 * old slug exists in slugHistory, this middleware issues a proper 301 with
 * a Location header so browsers, API clients, and crawlers follow the
 * redirect automatically.
 *
 * Must be mounted at the APPLICATION level (app.use(redirectHandler)),
 * NOT at router level. At router level req.path is relative (e.g. '/old-slug')
 * and the startsWith('/api/v1/products/') guard would never match.
 */
const redirectHandler = async (err, req, res, next) => {
  const status = err.statusCode || err.status || 500;

  if (status !== 404 || !req.path.startsWith('/api/v1/products/')) {
    return next(err);
  }

  try {
    const pathSegments = req.path.split('/').filter(Boolean);
    // pathSegments for /api/v1/products/old-slug:
    //   ["api", "v1", "products", "old-slug"]
    const productsIdx = pathSegments.indexOf('products');

    if (productsIdx === -1) {
      return next(err);
    }

    // The slug is always the segment immediately after "products".
    // The route is registered as /products/:slug — there is no
    // intermediate /products/slug/:value sub-path, so the previous
    // code that checked `if (slug === 'slug')` was dead and has been removed.
    const slug = pathSegments[productsIdx + 1];

    if (!slug) {
      return next(err);
    }

    const product = await Product.findOne({
      'slugHistory.oldSlug': slug,
      status: 'published'
    }).select('slug');

    if (product) {
      const newSegments = [...pathSegments];
      newSegments[pathSegments.lastIndexOf(slug)] = product.slug;
      const newPath = '/' + newSegments.join('/');

      const queryString = req.originalUrl.split('?')[1] || '';
      const newUrl = queryString ? `${newPath}?${queryString}` : newPath;

      console.log(`301 Redirect: ${req.path} → ${newUrl}`);

      // Location header is REQUIRED for a valid HTTP redirect.
      // Without it, browsers and crawlers treat the 301 as broken
      // and will not follow it, causing de-indexing of renamed products.
      res.setHeader('Location', newUrl);
      return res.status(301).json({
        success: true,
        redirect: true,
        oldSlug: slug,
        newSlug: product.slug,
        newUrl,
        message: 'This product URL has been updated. Redirecting to the new URL.'
      });
    }

    return next(err);
  } catch (error) {
    console.error('Redirect handler error:', error);
    return next(err);
  }
};

/**
 * Build a map of every old-slug → current-slug for audit/debugging.
 * @returns {Promise<Object>}
 */
export const auditRedirects = async () => {
  try {
    const productsWithHistory = await Product.find({
      slugHistory: { $exists: true, $ne: [] },
      status: 'published'
    }).select('slug slugHistory name');

    const redirectMap = {};
    productsWithHistory.forEach(product => {
      product.slugHistory.forEach(history => {
        redirectMap[history.oldSlug] = {
          newSlug: product.slug,
          productName: product.name,
          changedAt: history.changedAt
        };
      });
    });

    console.log('=== SEO REDIRECT AUDIT ===');
    console.log(`Total redirects configured: ${Object.keys(redirectMap).length}`);
    Object.entries(redirectMap).slice(0, 5).forEach(([oldSlug, data]) => {
      console.log(`  ${oldSlug} → ${data.newSlug} (${data.productName})`);
    });

    return redirectMap;
  } catch (error) {
    console.error('Redirect audit error:', error);
    throw error;
  }
};

/**
 * Remove slug history entries older than `daysOld` days from all products.
 * @param {number} daysOld
 */
export const cleanupOldRedirects = async (daysOld = 730) => {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await Product.updateMany(
      {},
      { $pull: { slugHistory: { changedAt: { $lt: cutoffDate } } } }
    );

    console.log(`Cleaned up slug history older than ${daysOld} days`);
    console.log(`Products affected: ${result.modifiedCount}`);
    return result;
  } catch (error) {
    console.error('Cleanup error:', error);
    throw error;
  }
};

export default redirectHandler;
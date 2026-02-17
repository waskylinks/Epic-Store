import Product from '../models/product-model.js';

// FIX #9 — This is now the single authoritative location for slug-history
// redirect logic. The duplicate lookup that previously existed in
// getProductBySlug (product-controller.js) has been removed. That controller
// now returns a plain 404 and lets this middleware handle it, eliminating:
//   • Two DB queries per renamed-product 404 (one in controller, one here)
//   • Two different 301 response shapes for the same redirect
const redirectHandler = async (err, req, res, next) => {
  // FIX — err.statusCode vs err.status:
  //   Express error objects may carry the HTTP status in either property
  //   depending on the library that created them.
  const status = err.statusCode || err.status || 500;

  if (status !== 404 || !req.path.startsWith('/api/v1/products/')) {
    return next(err);
  }

  try {
    const pathSegments = req.path.split('/').filter(Boolean);
    const productsIdx = pathSegments.indexOf('products');

    if (productsIdx === -1) {
      return next(err);
    }

    let slug = pathSegments[productsIdx + 1];
    if (slug === 'slug' && pathSegments[productsIdx + 2]) {
      slug = pathSegments[productsIdx + 2];
    }

    if (!slug) {
      return next(err);
    }

    const product = await Product.findOne({
      'slugHistory.oldSlug': slug,
      status: 'published'
    }).select('slug');

    if (product) {
      // FIX — String replace may hit wrong segment:
      //   Segment-level replacement is safe regardless of slug content.
      const newSegments = [...pathSegments];
      const slugIdx = pathSegments.lastIndexOf(slug);
      newSegments[slugIdx] = product.slug;
      const newPath = '/' + newSegments.join('/');

      const queryString = req.originalUrl.split('?')[1] || '';
      const newUrl = queryString ? `${newPath}?${queryString}` : newPath;

      console.log(`301 Redirect: ${req.path} → ${newUrl}`);

      return res.status(301).json({
        success: true,
        redirect: true,
        oldSlug: slug,
        newSlug: product.slug,
        newUrl,
        message: 'This product URL has been updated. Redirecting to the new URL.'
      });
    }

    next(err);
  } catch (error) {
    console.error('Redirect handler error:', error);
    next(err);
  }
};

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
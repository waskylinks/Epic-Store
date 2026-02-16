import Product from '../models/product-model.js';

/**
 * SEO Redirect Handler Middleware
 * 
 * This middleware intercepts 404 errors from product routes and checks if the
 * requested slug exists in the slugHistory. If found, it performs a 301 redirect
 * to the current product URL, preserving SEO equity and user experience.
 * 
 * Usage:
 * Place this AFTER your product routes and BEFORE the final 404 handler:
 * 
 * app.use('/api/v1/products', productRoutes);
 * app.use(redirectHandler);  // <-- Place here
 * app.use(notFoundHandler);  // Final 404
 * 
 * @param {Object} err - Express error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const redirectHandler = async (err, req, res, next) => {
  // Only intercept 404 errors from product routes
  if (err.statusCode !== 404 || !req.path.startsWith('/api/v1/products/')) {
    return next(err);
  }

  try {
    // Extract slug from the request path
    // Expected format: /api/v1/products/:slug or /api/v1/products/slug/:slug
    const pathSegments = req.path.split('/').filter(Boolean);
    const slugIndex = pathSegments.indexOf('products') + 1;
    
    // Handle different route patterns
    let slug = pathSegments[slugIndex];
    
    // If the next segment is "slug", the actual slug is one position further
    if (slug === 'slug' && pathSegments[slugIndex + 1]) {
      slug = pathSegments[slugIndex + 1];
    }

    if (!slug) {
      return next(err);
    }

    // Check if this slug exists in any product's slug history
    const product = await Product.findOne({ 
      'slugHistory.oldSlug': slug,
      status: 'published' 
    }).select('slug');

    if (product) {
      // Found a product with this old slug - perform 301 redirect
      const newUrl = req.path.replace(`/${slug}`, `/${product.slug}`);
      
      // Log for analytics (optional - remove in production if not needed)
      console.log(`301 Redirect: ${req.path} → ${newUrl}`);

      return res.status(301).json({
        success: true,
        redirect: true,
        oldSlug: slug,
        newSlug: product.slug,
        newUrl: newUrl,
        message: 'This product URL has been updated. Redirecting to the new URL.'
      });
    }

    // No redirect found - continue to 404 handler
    next(err);
  } catch (error) {
    // Log error but don't block the request
    console.error('Redirect handler error:', error);
    next(err);
  }
};

/**
 * Alternative Implementation: Redirect via Express res.redirect()
 * 
 * If you prefer a traditional HTTP redirect instead of JSON response:
 * 
 * return res.redirect(301, newUrl);
 * 
 * Note: This only works if your frontend routes match your API routes.
 * For SPA applications, the JSON approach is recommended.
 */

/**
 * ADVANCED: Redirect with Query Parameters
 * 
 * To preserve query parameters during redirect:
 */
export const redirectHandlerWithQuery = async (err, req, res, next) => {
  if (err.statusCode !== 404 || !req.path.startsWith('/api/v1/products/')) {
    return next(err);
  }

  try {
    const pathSegments = req.path.split('/').filter(Boolean);
    const slugIndex = pathSegments.indexOf('products') + 1;
    let slug = pathSegments[slugIndex];
    
    if (slug === 'slug' && pathSegments[slugIndex + 1]) {
      slug = pathSegments[slugIndex + 1];
    }

    if (!slug) {
      return next(err);
    }

    const product = await Product.findOne({ 
      'slugHistory.oldSlug': slug,
      status: 'published' 
    }).select('slug');

    if (product) {
      const newPath = req.path.replace(`/${slug}`, `/${product.slug}`);
      const queryString = req.originalUrl.split('?')[1] || '';
      const newUrl = queryString ? `${newPath}?${queryString}` : newPath;

      return res.status(301).json({
        success: true,
        redirect: true,
        oldSlug: slug,
        newSlug: product.slug,
        newUrl: newUrl,
        message: 'This product URL has been updated. Redirecting to the new URL.'
      });
    }

    next(err);
  } catch (error) {
    console.error('Redirect handler error:', error);
    next(err);
  }
};

/**
 * BULK REDIRECT CHECKER (Maintenance Utility)
 * 
 * Check for products with old slugs that should redirect.
 * Useful for auditing and maintenance.
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
    console.log('Sample redirects:');
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
 * CLEANUP OLD SLUG HISTORY (Maintenance Utility)
 * 
 * Remove slug history older than specified days.
 * Run this periodically to prevent database bloat.
 * 
 * Recommendation: Keep history for 12-24 months to preserve SEO equity.
 */
export const cleanupOldRedirects = async (daysOld = 730) => {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await Product.updateMany(
      {},
      {
        $pull: {
          slugHistory: {
            changedAt: { $lt: cutoffDate }
          }
        }
      }
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
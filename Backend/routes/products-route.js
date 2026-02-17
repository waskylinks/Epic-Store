import express from 'express';
import { 
    getProductDetails, 
    getAllProducts, 
    updateProduct, 
    createProducts, 
    deleteProduct,
    deleteMultipleProducts,
    getAdminProducts, 
    createProductReview, 
    getProductReviews, 
    deleteReview,
    getProductBySlug,
    getProductStructuredData
} from '../controller/product-controller.js';
import {
    getTrendingProducts,
    getNewProducts,
    getFeaturedProducts,
    getBestsellers
} from '../controller/public-controller.js';
import { roleBaseAccess, verifyUserAuth } from '../middleware/user-auth.js';
import { publicProductLimiter, adminLimiter } from '../middleware/rateLimiter.js';
import upload from '../middleware/multer.js';
import { trackProductView } from '../middleware/product-tracking-middleware.js';
// BUG: RESERVED_SLUGS was previously defined in this file and imported by
// product-controller.js, while this file simultaneously imported from
// product-controller.js — a mutual ESM cycle. During module evaluation,
// product-controller.js captured RESERVED_SLUGS as a live binding that was
// undefined at that instant (the Set() initializer had not run yet in this
// file). ESM live bindings mean it resolves correctly before any HTTP request
// arrives, but this is a fragile antipattern that breaks static analysis and
// is one refactor away from a real runtime crash.
// FIX: RESERVED_SLUGS moved to utils/reserved-slugs.js — a standalone module
// with no imports from routes or controllers. Both files now import from there,
// breaking the cycle entirely.
import { RESERVED_SLUGS } from '../utils/reserved-slugs.js'; // ← CHANGED

const router = express.Router();

// ============================================
// SLUG VALIDATION MIDDLEWARE
// Rejects any slug that:
//   1. Is a MongoDB ObjectID (24 hex chars)
//   2. Matches a reserved route name
//   3. Contains characters outside [a-z0-9-]
//   4. Is shorter than 2 chars or longer than 200 chars
// ============================================
const validateSlugParam = (req, res, next) => {
  const { slug } = req.params;

  if (/^[a-f0-9]{24}$/i.test(slug)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid product URL. Use /product/:id for ID-based lookups.'
    });
  }

  if (RESERVED_SLUGS.has(slug)) {
    return res.status(400).json({
      success: false,
      message: `"${slug}" is a reserved path and cannot be a product slug.`
    });
  }

  if (!/^[a-z0-9-]{2,200}$/.test(slug)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid product slug format.'
    });
  }

  next();
};

// ============================================
// PUBLIC ROUTES — Product Discovery
// Static routes MUST be declared before the :slug wildcard
// ============================================

router.route('/products').get(publicProductLimiter, getAllProducts);

router.route('/products/trending').get(publicProductLimiter, getTrendingProducts);
router.route('/products/new-arrivals').get(publicProductLimiter, getNewProducts);
router.route('/products/featured').get(publicProductLimiter, getFeaturedProducts);
router.route('/products/bestsellers').get(publicProductLimiter, getBestsellers);

router.get(
  '/products/:slug',
  publicProductLimiter,
  validateSlugParam,
  trackProductView,
  getProductBySlug
);

// ============================================
// REVIEWS ROUTES
// ============================================

router.route('/review').put(verifyUserAuth, createProductReview);

router.route('/reviews')
  .get(getProductReviews)
  .delete(verifyUserAuth, deleteReview);

// ============================================
// ADMIN ROUTES — Product Management
// ============================================

router.route('/product/:id')
  .get(verifyUserAuth, roleBaseAccess('admin'), adminLimiter, getProductDetails);

router.route('/admin/products')
  .get(verifyUserAuth, roleBaseAccess('admin'), adminLimiter, getAdminProducts);

router.route('/admin/products/create')
  .post(verifyUserAuth, roleBaseAccess('admin'), adminLimiter, upload.array('image', 10), createProducts);

router.route('/admin/products/batch-delete')
  .delete(verifyUserAuth, roleBaseAccess('admin'), adminLimiter, deleteMultipleProducts);

router.route('/admin/product/:id')
  .put(verifyUserAuth, roleBaseAccess('admin'), adminLimiter, upload.array('image', 10), updateProduct)
  .delete(verifyUserAuth, roleBaseAccess('admin'), adminLimiter, deleteProduct);

router.route('/admin/product/:id/structured-data')
  .get(verifyUserAuth, roleBaseAccess('admin'), adminLimiter, getProductStructuredData);

export default router;
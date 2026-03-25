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
    getAdminProductStats,
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
import { uploadProductImages } from '../middleware/multer.js';
import { trackProductView } from '../middleware/product-tracking-middleware.js';
import { RESERVED_SLUGS } from '../utils/reserved-slugs.js'; 

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

// ============================================
// ADMIN ROUTES
//
// Upload middleware order on multipart routes:
//   1. verifyUserAuth      — checks JWT header only, never touches body
//   2. roleBaseAccess      — checks user.role only, never touches body
//   3. uploadProductImages — parses multipart stream immediately
//                            (wrapped so multer errors return clean 400
//                             instead of leaving req.body undefined)
//   4. adminLimiter        — runs after body is already parsed
//   5. controller          — receives populated req.body and req.files
// ============================================

router.route('/product/:id')
  .get(verifyUserAuth, roleBaseAccess('admin', "superAdmin"), adminLimiter, getProductDetails);

router.route('/admin/products')
  .get(verifyUserAuth, roleBaseAccess('admin', "superAdmin"), adminLimiter, getAdminProducts);

router.route('/admin/products/stats')
  .get(verifyUserAuth, roleBaseAccess('admin', "superAdmin"), adminLimiter, getAdminProductStats);

router.route('/admin/products/create')
  .post(
    verifyUserAuth,
    roleBaseAccess('admin', "superAdmin"),
    uploadProductImages,   // ← wrapped multer, before adminLimiter
    adminLimiter,
    createProducts
  );

router.route('/admin/products/batch-delete')
  .delete(verifyUserAuth, roleBaseAccess('admin', "superAdmin"), adminLimiter, deleteMultipleProducts);

router.route('/admin/product/:id')
  .put(
    verifyUserAuth,
    roleBaseAccess('admin', "superAdmin"),
    uploadProductImages,   // ← wrapped multer, before adminLimiter
    adminLimiter,
    updateProduct
  )
  .delete(verifyUserAuth, roleBaseAccess('admin', "superAdmin"), adminLimiter, deleteProduct);

router.route('/admin/product/:id/structured-data')
  .get(verifyUserAuth, roleBaseAccess('admin', "superAdmin"), adminLimiter, getProductStructuredData);

export default router;
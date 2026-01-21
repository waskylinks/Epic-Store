import express from 'express';
import { 
    getProductDetails, 
    getAllProducts, 
    updateProduct, 
    createProducts, 
    deleteProduct, 
    getAdminProducts, 
    createProductReview, 
    getProductReviews, 
    deleteReview
} from '../controller/product-controller.js';
import {
    getTrendingProducts,
    getNewProducts,
    getFeaturedProducts,
    getBestsellers
} from '../controller/public-controller.js';
import { roleBaseAccess, verifyUserAuth } from '../middleware/user-auth.js';
import { publicProductLimiter } from '../middleware/rateLimiter.js';
import upload from '../middleware/multer.js';

const router = express.Router();

// Public routes - Product discovery (with rate limiting)
router.route("/products").get(publicProductLimiter, getAllProducts);

// Analytics-based product routes (place before /product/:id to avoid route conflicts)
// These now use the advanced public-controller with caching, pagination, and filtering
router.route('/products/trending').get(publicProductLimiter, getTrendingProducts);
router.route('/products/new-arrivals').get(publicProductLimiter, getNewProducts);
router.route('/products/featured').get(publicProductLimiter, getFeaturedProducts);
router.route('/products/bestsellers').get(publicProductLimiter, getBestsellers);

// Single product details
router.route('/product/:id').get(publicProductLimiter, getProductDetails);

// Reviews routes
router.route('/review').put(verifyUserAuth, createProductReview);

router.route('/reviews')
    .get(getProductReviews)
    .delete(verifyUserAuth, deleteReview);

// Admin routes - Product management
router.route('/admin/products')
    .get(verifyUserAuth, roleBaseAccess('admin'), getAdminProducts);

router.route("/admin/products/create")
    .post(verifyUserAuth, roleBaseAccess('admin'), upload.array('image', 10), createProducts);

router.route('/admin/product/:id')
    .put(verifyUserAuth, roleBaseAccess('admin'), upload.array('image', 10), updateProduct)
    .delete(verifyUserAuth, roleBaseAccess('admin'), deleteProduct);

export default router;
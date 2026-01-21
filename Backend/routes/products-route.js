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
    deleteReview,
    getTrendingProducts,
    getNewArrivals,
    getFeaturedProducts,
    getBestsellers
} from '../controller/product-controller.js';
import { roleBaseAccess, verifyUserAuth } from '../middleware/user-auth.js';
import upload from '../middleware/multer.js';

const router = express.Router();

// Public routes - Product discovery
router.route("/products").get(getAllProducts);

// Analytics-based product routes (place before /product/:id to avoid route conflicts)
router.route('/products/trending').get(getTrendingProducts);
router.route('/products/new-arrivals').get(getNewArrivals);
router.route('/products/featured').get(getFeaturedProducts);
router.route('/products/bestsellers').get(getBestsellers);

// Single product details
router.route('/product/:id').get(getProductDetails);

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
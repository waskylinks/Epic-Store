import express from 'express';
import { getProductDetails, getAllProducts, updateProduct, createProducts, deleteProduct, getAdminProducts, createProductReview, getProductReviews } from '../controller/product-controller.js';
import { roleBaseAccess, verifyUserAuth } from '../middleware/user-auth.js';


const router = express.Router();

router.route("/products").get(getAllProducts);

router.route('/product/:id').get(getProductDetails);

router.route('/review/').put(verifyUserAuth, createProductReview);

router.route('/reviews/').get(getProductReviews);

router.route('/admin/products/').get(verifyUserAuth, roleBaseAccess('admin'), getAdminProducts);

router.route("/admin/product/create").post(verifyUserAuth, roleBaseAccess('admin'), createProducts);

router.route('/admin/product/:id')
.put(verifyUserAuth, roleBaseAccess('admin'), updateProduct)
.delete(verifyUserAuth, roleBaseAccess('admin'),deleteProduct);


export default router;
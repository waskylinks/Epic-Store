import express from 'express';
import { getProductDetails, getAllProducts, updateProduct, createProducts, deleteProduct, getAdminProducts, createProductReview, getProductReviews, deleteReview } from '../controller/product-controller.js';
import { roleBaseAccess, verifyUserAuth } from '../middleware/user-auth.js';
import upload from '../middleware/multer.js';


const router = express.Router();

router.route("/products").get(getAllProducts);

router.route('/product/:id').get(getProductDetails);

router.route('/review').put(verifyUserAuth, createProductReview);

router.route('/reviews/').get(getProductReviews);

router.route('/reviews/').get(getProductReviews).delete(verifyUserAuth, deleteReview)

router.route('/admin/products/').get(verifyUserAuth, roleBaseAccess('admin'), getAdminProducts);

router.route("/admin/products/create")
  .post(verifyUserAuth, roleBaseAccess('admin'), upload.array('image', 10), createProducts); // 10 = max images, adjust as needed

router.route('/admin/product/:id')
.put(verifyUserAuth, roleBaseAccess('admin'), upload.array('image', 10), updateProduct)
.delete(verifyUserAuth, roleBaseAccess('admin'),deleteProduct);


export default router;
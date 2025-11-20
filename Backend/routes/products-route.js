import express from 'express';
import { getProductDetails, getAllProducts, updateProduct, createProducts, deleteProduct } from '../controller/product-controller.js';
import { roleBaseAccess, verifyUserAuth } from '../middleware/user-auth.js';


const router = express.Router();

router.route("/products")
.get(getAllProducts);

router.route("/admin/product/create").post(verifyUserAuth, roleBaseAccess('admin'), createProducts);

router.route('/admin/product/:id')
.put(verifyUserAuth, roleBaseAccess('admin'), updateProduct)
.delete(verifyUserAuth, roleBaseAccess('admin'),deleteProduct);

router.route('product/:id').get(getProductDetails);

export default router;
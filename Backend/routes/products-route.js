import express from 'express';
import { getProductDetails, getAllProducts, updateProduct, createProducts, deleteProduct } from '../controller/product-controller.js';
import { roleBaseAccess, verifyUserAuth } from '../middleware/user-auth.js';


const router = express.Router();

router.route("/products")
.get(verifyUserAuth, getAllProducts)
.post(verifyUserAuth, roleBaseAccess('admin'), createProducts);

router.route('/product/:id')
.put(verifyUserAuth, roleBaseAccess('admin'), updateProduct)
.delete(verifyUserAuth, roleBaseAccess('admin'),deleteProduct)
.get(verifyUserAuth, getProductDetails);

export default router;
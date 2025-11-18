import express from 'express';
import { getProductDetails, getAllProducts, updateProduct, createProducts, deleteProduct } from '../controller/product-controller.js';
import { verifyUserAuth } from '../middleware/user-auth.js';


const router = express.Router();

router.route("/products")
.get(verifyUserAuth, getAllProducts)
.post(createProducts);

router.route('/product/:id')
.put(updateProduct)
.delete(deleteProduct)
.get(getProductDetails);

export default router;
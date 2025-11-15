import express from 'express';

const router = express.Router();

import { updateProduct } from '../controller/product-controller.js';

const updateProductRoute = router.put('/product/:id', updateProduct);

export default updateProductRoute;

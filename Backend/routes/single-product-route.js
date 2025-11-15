import express from 'express';

const router = express.Router();

import { getProductDetails } from '../controller/product-controller.js';

const productDetailsRoute = router.get('/product/:id', getProductDetails);

export default productDetailsRoute;
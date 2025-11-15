import express from 'express';

const router = express.Router();

import { createProducts } from '../controller/product-controller.js';

const createProductRoute = router.post('/products', createProducts);

export default createProductRoute;
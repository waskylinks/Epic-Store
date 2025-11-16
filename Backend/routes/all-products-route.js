import express from 'express';

const router = express.Router();

import { getAllProducts } from '../controller/product-controller.js';

const createProductRoute = router.get('/products', getAllProducts);

export default createProductRoute;
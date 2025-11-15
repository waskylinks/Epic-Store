import express from 'express';

const router = express.Router();

import { deleteProduct } from '../controller/product-controller.js';

const deleteProductRoute = router.delete('/product/:id', deleteProduct);

export default deleteProductRoute;
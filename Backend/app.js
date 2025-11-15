import express from 'express';
const app = express();

import allProductsRoute from './routes/all-products-route.js';
import productDetailsRoute from './routes/single-product-route.js';
import createProductRoute from './routes/create-product-route.js';
import updateProductRoute from './routes/updateProduct-route.js';
import deleteProductRoute from './routes/deleteProduct-route.js';

//middleware
app.use(express.json());

//home route
app.use('/api/v1', allProductsRoute);
app.use('/api/v1', createProductRoute);
app.use('/api/v1', updateProductRoute);
app.use('/api/v1', deleteProductRoute);
app.use('/api/v1', productDetailsRoute);


export default app;
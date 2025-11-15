import express from 'express';
const app = express();

import allProductsRoute from './routes/all-products-route.js';
import singleProductRoute from './routes/single-product-route.js';
import createProductRoute from './routes/create-product-route.js';

//middleware
app.use(express.json());

//home route
app.use('/api/v1', allProductsRoute);
app.use('/api/v1', createProductRoute);
app.use('/api/v1', singleProductRoute);


export default app;
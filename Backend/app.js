import express from 'express';
const app = express();

import products from './routes/products-route.js';
import errorHandleMiddleware from './middleware/error.js';
import user from './routes/user-route.js';
import order from './routes/order-routes.js';
import cookieParser from 'cookie-parser';
import fileUpload from 'express-fileupload';
import dotenv from 'dotenv'
import paystack from './routes/paystack-routes.js';






//middleware
app.use(express.json());
app.use(cookieParser());
app.use(fileUpload());

//home route
app.use('/api/v1', products);
app.use('/api/v1', user);
app.use('/api/v1', order);
app.use('/api/v1', paystack);

app.use(errorHandleMiddleware);

dotenv.config({
    path: 'Backend/.env'
})


export default app;
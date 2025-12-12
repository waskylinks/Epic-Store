import express from 'express';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import fileUpload from 'express-fileupload';

// Routes
import products from './routes/products-route.js';
import user from './routes/user-route.js';
import order from './routes/order-routes.js';
import payment from './routes/payment.routes.js'; // unified multipayment route

// Middleware
import errorHandleMiddleware from './middleware/error.js';

const app = express();

// Body parser, cookies, file uploads
app.use(express.json());
app.use(cookieParser());
app.use(fileUpload());

// API routes
app.use('/api/v1', products);
app.use('/api/v1', user);
app.use('/api/v1', order);
app.use('/api/v1/payment', payment); // use unified payment route

// Global error handler
app.use(errorHandleMiddleware);

export default app;

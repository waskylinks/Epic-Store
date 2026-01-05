import express from 'express';
import cookieParser from 'cookie-parser';

// Routes
import products from './routes/products-route.js';
import user from './routes/user-route.js';
import order from './routes/order-routes.js';
import payment from './routes/payment.routes.js';
import receipt from './routes/receipts-routes.js';
import analytics from './routes/analytics-routes.js';

// Middleware
import errorHandleMiddleware from './middleware/error.js';

const app = express();

// Body parser and cookies only
app.use(express.json({ limit: '10mb' })); // optional: increase limit if needed
app.use(express.urlencoded({ extended: true })); // if you use form urlencoded elsewhere
app.use(cookieParser());

// API routes
app.use('/api/v1', products);
app.use('/api/v1', user);
app.use('/api/v1', order);
app.use('/api/v1/payment', payment);
app.use('/api/v1/receipts', receipt);
app.use('/api/v1', analytics);


// Global error handler
app.use(errorHandleMiddleware);

export default app;
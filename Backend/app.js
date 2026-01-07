import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { 
  helmetConfig, 
  sanitizeData, 
  xssProtection, 
  preventParameterPollution,
  corsOptions,
  additionalSecurityHeaders 
} from './middleware/security.js';

// Routes
import products from './routes/products-route.js';
import user from './routes/user-route.js';
import order from './routes/order-routes.js';
import payment from './routes/payment.routes.js';
import receipt from './routes/receipts-routes.js';
import analytics from './routes/analytics-routes.js';

// ✅ UPDATED: Import enterprise error handlers
import { globalErrorHandler, handle404 } from './middleware/error.js';

const app = express();

// ------------------- SECURITY MIDDLEWARE -------------------
// MUST come before body parsers and routes
app.use(helmetConfig);
app.use(cors(corsOptions));
app.use(additionalSecurityHeaders);
app.use(sanitizeData);
app.use(xssProtection);
app.use(preventParameterPollution);

// ------------------- BODY PARSERS -------------------
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// ------------------- HEALTH CHECK (Optional but recommended) -------------------
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// ------------------- API ROUTES -------------------
app.use('/api/v1', products);
app.use('/api/v1', user);
app.use('/api/v1', order);
app.use('/api/v1/payment', payment);
app.use('/api/v1/receipts', receipt);
app.use('/api/v1', analytics);

// ------------------- ERROR HANDLING -------------------
// ✅ CRITICAL: Order matters! 404 handler must come BEFORE global error handler

// Handle undefined routes (404)
app.all('*', handle404);

// Global error handler (MUST be last)
app.use(globalErrorHandler);

export default app;
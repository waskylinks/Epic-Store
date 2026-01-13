import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import passport from 'passport';
import { PaymentFactory } from './Services/payment/paymentFactory.js';

import {
  helmetConfig,
  corsOptions,
  hppProtection,
  apiLimiter,
  additionalSecurityHeaders,
  startupGuards
} from './middleware/security.js';

import userRoutes from './routes/user-route.js';
import productRoutes from './routes/products-route.js';
import orderRoutes from './routes/order-routes.js';
import oauthRoutes from './routes/oauth-routes.js';
import analyticsRoutes from './routes/analytics-routes.js';
import paymentRoutes from './routes/payment-routes.js';
import receiptRoutes from './routes/receipts-routes.js';

// Import passport configuration
import './config/passport.js';

const app = express();

/* ================= WEBHOOK ROUTES (MUST BE BEFORE BODY PARSERS) ================= */
// Paystack webhook needs raw body for signature verification
app.post('/api/v1/payment/webhook/paystack', 
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    console.log('>>> Paystack webhook route reached');
    
    try {
      const service = PaymentFactory.getWebhookService('paystack');
      
      if (!service) {
        return res.status(400).json({ message: 'Webhook service unavailable' });
      }
      
      await service.handleWebhook(req, res);
    } catch (err) {
      console.error('Paystack webhook error:', err);
      res.status(500).json({ message: 'Webhook processing failed' });
    }
  }
);

/* ================= CORE ================= */
app.use(express.json({ 
  limit: '1mb',
  verify: (req, res, buf) => {
    // Store raw body for webhook signature verification if needed
    if (req.originalUrl.includes('/webhook')) {
      req.rawBody = buf.toString('utf8');
    }
  }
}));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

/* ================= PASSPORT (JWT-based, no sessions) ================= */
app.use(passport.initialize());

/* ================= REQUEST LOGGING (DEVELOPMENT ONLY) ================= */
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    if (req.method === 'POST' || req.method === 'PUT') {
      console.log('📨 Incoming Request:', {
        method: req.method,
        path: req.originalUrl,
        contentType: req.headers['content-type'],
        bodyExists: !!req.body,
        bodyKeys: req.body ? Object.keys(req.body) : []
        // ❌ Removed: body: req.body (prevents logging sensitive data)
      });
    }
    next();
  });
}

/* ================= SECURITY ================= */
// Startup guard (non-destructive, validates app)
startupGuards(app);

// Standard security middlewares
app.use(cors(corsOptions));
app.use(helmetConfig);
app.use(hppProtection);
app.use(apiLimiter);
app.use(additionalSecurityHeaders);

/* ================= ROUTES ================= */
app.use('/api/v1', userRoutes);
app.use('/api/v1', productRoutes);
app.use('/api/v1', orderRoutes);
app.use('/api/v1/oauth', oauthRoutes);
app.use('/api/v1', analyticsRoutes);
app.use('/api/v1/payment', paymentRoutes);
app.use('/api/v1/receipts', receiptRoutes);

/* ================= ERROR HANDLER ================= */
app.use((err, req, res, next) => {
  // Log full error server-side for debugging
  console.error('🔥 ERROR', {
    method: req.method,
    path: req.originalUrl,
    message: err.message,
    // Only log stack trace in development
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    statusCode: err.statusCode
  });

  // Send sanitized error to client
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  res.status(err.statusCode || 500).json({
    success: false,
    message: isDevelopment 
      ? err.message 
      : (err.statusCode >= 400 && err.statusCode < 500)
        ? err.message // Client errors (4xx) can show actual message
        : 'An error occurred', // Server errors (5xx) use generic message
    ...(isDevelopment && { stack: err.stack }) // Include stack only in dev
  });
});

export default app;
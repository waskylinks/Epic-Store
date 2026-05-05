import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import session from 'express-session';
import { EventEmitter } from 'events';
import passport from 'passport';
import { PaymentFactory } from './Services/payment/paymentFactory.js';
import redis from './utils/redis.js';
import { RedisStore } from 'connect-redis';

import {
  helmetConfig,
  corsOptions,
  hppProtection,
  additionalSecurityHeaders,
  startupGuards
} from './middleware/security.js';

import { webhookLimiter } from './middleware/rateLimiter.js';

import userRoutes from './routes/user-route.js';
import productRoutes from './routes/products-route.js';
import customerOrderRoutes from './routes/customer-order-routes.js';
import adminOrderRoutes from './routes/admin-order-routes.js';
import refundRoutes from './routes/refund-routes.js';
import returnRoutes from './routes/return-routes.js';;
import oauthRoutes from './routes/oauth-routes.js';
import paymentRoutes from './routes/payment-routes.js';
import receiptRoutes from './routes/receipts-routes.js';
import wishlistRoutes from './routes/wishlist-routes.js';
import cartRoutes from './routes/cart-routes.js';
import shippingRoutes from './routes/shipping-routes.js';
import discountRoutes from './routes/discount-routes.js';
import checkoutRoutes from './routes/checkout-routes.js';
import analyticsRoutes from './routes/analytics-routes-index.js';
import adminStatsRoutes from './routes/admin-stats-routes.js';
import discountAnalyticsRoutes from './routes/discount-analytics-routes.js';
import recoveryEmailRoutes from './routes/recovery-email-routes.js'
import seoRoutes from './routes/seo-routes.js';
import { trackAttribution } from './middleware/attribution-tracking-middleware.js';
import cronHealthRouter from './routes/cronHealthRoutes.js';


import './config/passport.js';

import redirectHandler from './middleware/redirectHandler.js';

const app = express();

/* ================= WEBHOOK ROUTES (MUST BE BEFORE BODY PARSERS) ================= */

app.post(
  '/api/v1/payment/webhook/stripe',
  webhookLimiter,
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    console.log('>>> Stripe webhook route reached');
    try {
      const service = PaymentFactory.getService('stripe');
      if (!service || typeof service.handleWebhook !== 'function') {
        console.error('Stripe webhook service unavailable');
        return res.status(500).json({ message: 'Webhook service unavailable' });
      }
      await service.handleWebhook(req, res);
    } catch (err) {
      console.error('Stripe webhook error:', err);
      res.status(500).json({ message: 'Webhook processing failed' });
    }
  }
);

app.post(
  '/api/v1/payment/webhook/paystack',
  webhookLimiter,
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    console.log('>>> Paystack webhook route reached');
    try {
      const service = PaymentFactory.getService('paystack');
      if (!service || typeof service.handleWebhook !== 'function') {
        console.error('Paystack webhook service unavailable');
        return res.status(500).json({ message: 'Webhook service unavailable' });
      }
      await service.handleWebhook(req, res);
    } catch (err) {
      console.error('Paystack webhook error:', err);
      res.status(500).json({ message: 'Webhook processing failed' });
    }
  }
);

app.post(
  '/api/v1/payment/webhook/flutterwave',
  webhookLimiter,
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    console.log('>>> Flutterwave webhook route reached');
    try {
      const service = PaymentFactory.getService('flutterwave');
      if (!service || typeof service.handleWebhook !== 'function') {
        console.error('Flutterwave webhook service unavailable');
        return res.status(500).json({ message: 'Webhook service unavailable' });
      }
      await service.handleWebhook(req, res);
    } catch (err) {
      console.error('Flutterwave webhook error:', err);
      res.status(500).json({ message: 'Webhook processing failed' });
    }
  }
);

/* ================= CORE BODY PARSERS (AFTER WEBHOOKS) ================= */
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

/* ================= SESSION ================= */
app.use(
  session({
    store: new RedisStore({
      client: redis,
      prefix: 'epicstore:session:',
      ttl: 900
    }),
    secret: process.env.SESSION_SECRET ,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 15,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    },
    name: 'oauth.sid'
  })
);

/* ================= PASSPORT ================= */
app.use(passport.initialize());

/* ================= REQUEST LOGGING (DEVELOPMENT ONLY) ================= */
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    if (req.method === 'POST' || req.method === 'PUT') {
      console.log('Incoming Request:', {
        method: req.method,
        path: req.originalUrl,
        contentType: req.headers['content-type'],
        bodyExists: !!req.body,
        bodyKeys: req.body ? Object.keys(req.body) : []
      });
    }
    next();
  });
}

/* ================= SECURITY ================= */
startupGuards(app);
app.use(cors(corsOptions));
app.use(helmetConfig);


app.use((req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart/form-data')) {
    return next(); // skip hpp for file upload requests
  }
  return hppProtection(req, res, next);
});

app.use(additionalSecurityHeaders);
app.use(trackAttribution);

/* ================= ROUTES ================= */
app.use('/api/v1/admin/cron', cronHealthRouter);
app.use('/api/v1', userRoutes);
app.use('/api/v1', productRoutes);
app.use('/api/v1/oauth', oauthRoutes);
app.use('/api/v1/payment', paymentRoutes);

app.use('/api/v1', customerOrderRoutes);
app.use('/api/v1', adminOrderRoutes);
app.use('/api/v1', refundRoutes);
app.use('/api/v1', returnRoutes);

app.use('/api/v1/receipts', receiptRoutes);
app.use('/api/v1/wishlist', wishlistRoutes);
app.use('/api/v1/cart', cartRoutes);
app.use('/api/v1', cartRoutes);
app.use('/api/v1/shipping', shippingRoutes);
app.use('/api/v1/discounts', discountRoutes);
app.use("/api/v1/recovery", recoveryEmailRoutes);
app.use('/api/v1/checkout', checkoutRoutes);
app.use('/api/v1', seoRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/admin', adminStatsRoutes);
app.use("/api/v1/discount-analytics", discountAnalyticsRoutes);

app.use(redirectHandler);

/* ================= ERROR HANDLER ================= */
app.use((err, req, res, next) => {
  console.error('ERROR', {
    method: req.method,
    path: req.originalUrl,
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    statusCode: err.statusCode
  });

  const isDevelopment = process.env.NODE_ENV === 'development';

  res.status(err.statusCode || 500).json({
    success: false,
    message:
      isDevelopment
        ? err.message
        : err.statusCode >= 400 && err.statusCode < 500
        ? err.message
        : 'An error occurred',
    ...(isDevelopment && { stack: err.stack })
  });
});

export default app;
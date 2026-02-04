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
import orderRoutes from './routes/order-routes.js';
import oauthRoutes from './routes/oauth-routes.js';
import analyticsRoutes from './routes/analytics-routes.js';
import paymentRoutes from './routes/payment-routes.js';
import receiptRoutes from './routes/receipts-routes.js';
import wishlistRoutes from './routes/wishlist-routes.js';
import cartRoutes from './routes/cart-routes.js';
import shippingRoutes from './routes/shipping-routes.js';
import cartAnalyticsRoutes from './routes/cart-analytics-routes.js';

// Import passport configuration
import './config/passport.js';

const app = express();

/* ================= WEBHOOK ROUTES (MUST BE BEFORE BODY PARSERS) ================= */

/**
 * Stripe Webhook - Raw body required for signature verification
 */
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
      console.error('❌ Stripe webhook error:', err);
      res.status(500).json({ message: 'Webhook processing failed' });
    }
  }
);

/**
 * Paystack Webhook - Raw body required for signature verification
 */
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
      console.error('❌ Paystack webhook error:', err);
      res.status(500).json({ message: 'Webhook processing failed' });
    }
  }
);

/**
 * Flutterwave Webhook - Raw body required for signature verification
 */
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
      console.error('❌ Flutterwave webhook error:', err);
      res.status(500).json({ message: 'Webhook processing failed' });
    }
  }
);

/* ================= CORE BODY PARSERS (AFTER WEBHOOKS) ================= */
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

/* ================= CUSTOM REDIS SESSION STORE ================= */
// Simple Redis store implementation (no connect-redis needed)
class RedisSessionStore extends EventEmitter {
  constructor(redisClient, options = {}) {
    super();
    this.client = redisClient;
    this.prefix = options.prefix || 'sess:';
    this.ttl = options.ttl || 900; // 15 minutes default
  }

  async get(sid, callback) {
    try {
      const data = await this.client.get(this.prefix + sid);
      callback(null, data ? JSON.parse(data) : null);
    } catch (err) {
      callback(err);
    }
  }

  async set(sid, session, callback) {
    try {
      await this.client.set(
        this.prefix + sid,
        JSON.stringify(session),
        { EX: this.ttl }
      );
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  async destroy(sid, callback) {
    try {
      await this.client.del(this.prefix + sid);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  async touch(sid, session, callback) {
    try {
      await this.client.expire(this.prefix + sid, this.ttl);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }
}

const sessionStore = new RedisSessionStore(redis, {
  prefix: 'epicstore:session:',
  ttl: 900 // 15 minutes
});

app.use(
  session({
    store: new RedisStore({ 
      client: redis,
      prefix: 'epicstore:session:',
      ttl: 900 // 15 minutes in seconds
    }),
    secret: process.env.SESSION_SECRET || 'fallback-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 15, // 15 minutes
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    },
    name: 'oauth.sid'
  })
);

/* ================= PASSPORT ================= */
// Passport is used for OAuth only (JWT handles auth)
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
app.use(additionalSecurityHeaders);

/* ================= ROUTES ================= */
app.use('/api/v1', userRoutes);
app.use('/api/v1', productRoutes);
app.use('/api/v1', orderRoutes);
app.use('/api/v1/oauth', oauthRoutes);
app.use('/api/v1', analyticsRoutes);
app.use('/api/v1/payment', paymentRoutes);
app.use('/api/v1/receipts', receiptRoutes);
app.use('/api/v1/wishlist', wishlistRoutes);
app.use('/api/v1/cart', cartRoutes);
app.use('/api/v1', cartRoutes); // For /products/:id/availability endpoint
app.use('/api/v1/shipping', shippingRoutes);
app.use('/api/v1/analytics/cart', cartAnalyticsRoutes);

/* ================= ERROR HANDLER ================= */
app.use((err, req, res, next) => {
  console.error('🔥 ERROR', {
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
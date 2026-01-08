import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';

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

const app = express();

/* ================= CORE ================= */
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

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

/* ================= ERROR HANDLER ================= */
app.use((err, req, res, next) => {
  console.error('🔥 ERROR', {
    method: req.method,
    path: req.originalUrl,
    message: err.message,
    stack: err.stack
  });

  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Internal Server Error'
  });
});

export default app;

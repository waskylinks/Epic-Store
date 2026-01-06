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

// Error middleware
import errorHandleMiddleware from './middleware/error.js';

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

// ------------------- ROUTES -------------------
app.use('/api/v1', products);
app.use('/api/v1', user);
app.use('/api/v1', order);
app.use('/api/v1/payment', payment);
app.use('/api/v1/receipts', receipt);
app.use('/api/v1', analytics);

// ------------------- ERROR HANDLER -------------------
app.use(errorHandleMiddleware);

export default app;

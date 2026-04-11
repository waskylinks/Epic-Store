import express from 'express';
import { verifyUserAuth, roleBaseAccess } from '../middleware/user-auth.js';
import { adminAnalyticsLimiter } from '../middleware/rateLimiter.js';
import {
  getCheckoutAbandonmentStats,
  getAbandonedCheckoutsList,
  getRecoveryOpportunities,
  getReAbandonmentAnalytics,
} from '../controller/checkout-analytics-controller.js';

const router = express.Router();

const admin = [verifyUserAuth, roleBaseAccess('admin', 'superAdmin'), adminAnalyticsLimiter];

router.get('/abandonment',            ...admin, getCheckoutAbandonmentStats);
router.get('/abandoned-list',         ...admin, getAbandonedCheckoutsList);
router.get('/recovery-opportunities', ...admin, getRecoveryOpportunities);
router.get('/re-abandonment',         ...admin, getReAbandonmentAnalytics);

export default router;
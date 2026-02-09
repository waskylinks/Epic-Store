import express from 'express';
import { verifyUserAuth, roleBaseAccess } from '../middleware/user-auth.js';
import { adminAnalyticsLimiter } from '../middleware/rateLimiter.js';
import {
  getCheckoutAbandonmentStats,
  getAbandonedCheckoutsList,
  getRecoveryOpportunities,
  markRecoveryEmailSent
} from '../controller/checkout-analytics-controller.js';

const router = express.Router();

/**
 * Get checkout abandonment statistics
 * @route GET /api/v1/analytics/checkout/abandonment
 * @access Admin
 */
router.get(
  '/abandonment',
  verifyUserAuth,
  roleBaseAccess('admin'),
  adminAnalyticsLimiter,
  getCheckoutAbandonmentStats
);

/**
 * Get list of abandoned checkouts
 * @route GET /api/v1/analytics/checkout/abandoned-list
 * @access Admin
 */
router.get(
  '/abandoned-list',
  verifyUserAuth,
  roleBaseAccess('admin'),
  adminAnalyticsLimiter,
  getAbandonedCheckoutsList
);

/**
 * Get recovery opportunities
 * @route GET /api/v1/analytics/checkout/recovery-opportunities
 * @access Admin
 */
router.get(
  '/recovery-opportunities',
  verifyUserAuth,
  roleBaseAccess('admin'),
  adminAnalyticsLimiter,
  getRecoveryOpportunities
);

/**
 * Mark recovery email sent
 * @route POST /api/v1/analytics/checkout/:checkoutId/mark-recovery-sent
 * @access Admin
 */
router.post(
  '/:checkoutId/mark-recovery-sent',
  verifyUserAuth,
  roleBaseAccess('admin'),
  markRecoveryEmailSent
);

export default router;
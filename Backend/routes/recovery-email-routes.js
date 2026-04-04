import express from 'express';
import { verifyUserAuth, roleBaseAccess } from '../middleware/user-auth.js';
import {
  sendRecoveryEmailHandler,
  getRecoveryStatusHandler,
  getSendListHandler,
  getRecoveryAnalyticsHandler,
  resolveOutcomeHandler,
} from '../controller/recovery-email-controller.js';

const router = express.Router();

// All recovery routes require authentication.
// redeemRecoveryTokenHandler stays on the checkout router (/api/v1/checkout/recover)
// so existing frontend recovery links continue to work without change.
router.use(verifyUserAuth);

/**
 * Send a recovery email for an abandoned checkout.
 * @route  POST /api/v1/recovery/send
 * @body   { checkoutId: string }
 * @access Admin
 */
router.post('/send', roleBaseAccess('admin', 'superAdmin'), sendRecoveryEmailHandler);

/**
 * Get recovery email status for a specific checkout.
 * Used by send page right panel and RecoveryEmailButton polling.
 * @route  GET /api/v1/recovery/status/:checkoutId
 * @access Admin
 */
router.get('/status/:checkoutId', roleBaseAccess('admin', 'superAdmin'), getRecoveryStatusHandler);

/**
 * Get paginated abandoned carts with recovery email state.
 * Powers the send page left panel.
 * @route  GET /api/v1/recovery/send-list
 * @query  page, limit, outcome, sortBy, minValue, search, hours
 * @access Admin
 */
router.get('/send-list', roleBaseAccess('admin', 'superAdmin'), getSendListHandler);

/**
 * Get recovery email analytics.
 * Powers the analytics page KPIs, funnel, and ROI table.
 * @route  GET /api/v1/recovery/analytics
 * @query  timeframe | (startDate + endDate)
 * @access Admin
 */
router.get('/analytics', roleBaseAccess('admin', 'superAdmin'), getRecoveryAnalyticsHandler);

/**
 * Manually resolve a recovery email campaign outcome.
 * Guards against overwriting terminal states.
 * @route  POST /api/v1/recovery/resolve/:checkoutId
 * @body   { outcome: string }
 * @access Admin
 */
router.post('/resolve/:checkoutId', roleBaseAccess('admin', 'superAdmin'), resolveOutcomeHandler);

export default router;
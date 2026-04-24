import express from 'express';
import { verifyUserAuth, roleBaseAccess } from '../middleware/user-auth.js';
import { adminAnalyticsLimiter, adminLimiter } from '../middleware/rateLimiter.js';
import {
  getRecoveryStatusHandler,
  getSendListHandler,
  getRecoveryAnalyticsHandler,
  resolveOutcomeHandler,
} from '../controller/recovery-email-controller.js';

const router = express.Router();

router.use(verifyUserAuth);

router.get('/status/:checkoutId',   roleBaseAccess('admin', 'superAdmin'), adminAnalyticsLimiter, getRecoveryStatusHandler);
router.get('/send-list',            roleBaseAccess('admin', 'superAdmin'), adminAnalyticsLimiter, getSendListHandler);
router.get('/analytics',            roleBaseAccess('admin', 'superAdmin'), adminAnalyticsLimiter, getRecoveryAnalyticsHandler);
router.post('/resolve/:checkoutId', roleBaseAccess('admin', 'superAdmin'), adminLimiter,          resolveOutcomeHandler);

export default router;
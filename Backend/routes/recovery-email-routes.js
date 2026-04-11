import express from 'express';
import { verifyUserAuth, roleBaseAccess } from '../middleware/user-auth.js';
import {
  getRecoveryStatusHandler,
  getSendListHandler,
  getRecoveryAnalyticsHandler,
  resolveOutcomeHandler,
} from '../controller/recovery-email-controller.js';

const router = express.Router();

router.use(verifyUserAuth);

// GET /api/v1/recovery/status/:checkoutId
router.get('/status/:checkoutId', roleBaseAccess('admin', 'superAdmin'), getRecoveryStatusHandler);

// GET /api/v1/recovery/send-list
router.get('/send-list', roleBaseAccess('admin', 'superAdmin'), getSendListHandler);

// GET /api/v1/recovery/analytics
router.get('/analytics', roleBaseAccess('admin', 'superAdmin'), getRecoveryAnalyticsHandler);

// POST /api/v1/recovery/resolve/:checkoutId
router.post('/resolve/:checkoutId', roleBaseAccess('admin', 'superAdmin'), resolveOutcomeHandler);

export default router;
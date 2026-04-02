import express from 'express';
import { verifyUserAuth, roleBaseAccess } from "../middleware/user-auth.js";
import { adminAnalyticsLimiter } from '../middleware/rateLimiter.js'
import { 
    sendSingleRecoveryEmail, 
    sendBulkRecoveryEmailsController,
 } from '../controller/recovery-email-controller.js'

 const router = express.Router();

 router.post (
    '/bulk-send',
    verifyUserAuth,
    roleBaseAccess('admin', 'superAdmin'),
    adminAnalyticsLimiter,
    sendBulkRecoveryEmailsController
 );

 router.post (
    '/:id/send',
    verifyUserAuth,
    roleBaseAccess('admin', 'superAdmin'),
    adminAnalyticsLimiter,
    sendSingleRecoveryEmail
 );

 export default router;
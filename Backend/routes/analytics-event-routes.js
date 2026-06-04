import express from 'express';
import { verifyUserAuth } from '../middleware/user-auth.js';
import { ingestAnalyticsEvent } from '../controller/analyticsEventController.js';

const router = express.Router();

/**
 * POST /api/v1/analytics/event
 *
 * Client-side event ingestion endpoint. Called by eventBridge.js sendEvent()
 * during normal shopping flows — any authenticated user may POST here.
 * No roleBaseAccess guard — this is NOT an admin endpoint.
 */
router.post('/event', verifyUserAuth, ingestAnalyticsEvent);

export default router;
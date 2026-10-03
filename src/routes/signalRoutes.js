import express from 'express';
import { getSignals } from '../controllers/signalController.js';
import { verifyJWT } from '../middleware/authMiddleware.js';
import { checkSubscriptionMiddleware } from '../middleware/subscriptionMiddleware.js';

const router = express.Router();

// GET /api/signals - Protected by both JWT authentication AND active subscription check
router.get('/', verifyJWT, checkSubscriptionMiddleware, getSignals);

export default router;
// src/routes/brokerRoutes.js
import express from 'express';
import { getEADashboardStats, connectBrokerAccount } from '../controllers/brokerController.js';
import { verifyJWT } from '../middleware/authMiddleware.js';

const router = express.Router();

// GET /api/broker/ea-stats - Fetches user EA access and live balance/equity metrics
router.get('/ea-stats', verifyJWT, getEADashboardStats);

// POST /api/broker/connect - Provisions MetaApi container and links user broker account
router.post('/connect', verifyJWT, connectBrokerAccount);

export default router;
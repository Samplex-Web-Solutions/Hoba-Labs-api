// src/routes/brokerRoutes.js
import express from 'express';
import { 
  getEADashboardStats, 
  connectBrokerAccount, 
  searchBrokerServers 
} from '../controllers/brokerController.js';
import { verifyJWT } from '../middleware/authMiddleware.js';

const router = express.Router();

// GET /api/broker/ea-stats - Fetches user EA access and live balance/equity metrics
router.get('/ea-stats', verifyJWT, getEADashboardStats);

// POST /api/broker/connect - Establishes TickerAll broker session and links user account
router.post('/connect', verifyJWT, connectBrokerAccount);

// GET /api/broker/servers - Searches broker servers for autocomplete
router.get('/servers', verifyJWT, searchBrokerServers);

export default router;
import express from 'express';
import { getSignals } from '../controllers/signalController.js';
import { verifyJWT } from '../middleware/authMiddleware.js';

const router = express.Router();

// GET /api/signals - Protected route
router.get('/', verifyJWT, getSignals);

export default router;
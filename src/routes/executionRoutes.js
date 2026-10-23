import express from 'express';
import { fetchActiveGoldSignals } from '../controllers/executionController.js';

const router = express.Router();

// Endpoint polled by the Client MQL5 EA
router.get('/gold-signals', fetchActiveGoldSignals);

export default router;
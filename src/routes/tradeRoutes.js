import express from 'express';
import { handleMasterBroadcast } from '../controllers/tradeController.js';

const router = express.Router();

// Master EA broadcast endpoint for multi-user trade execution
router.post('/broadcast', handleMasterBroadcast);

export default router;
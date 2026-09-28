import express from 'express';
import { processIccSignal } from '../controllers/iccController.js'; // <-- Added .js extension

const router = express.Router();

router.post('/evaluate', processIccSignal);

export default router;
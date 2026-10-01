import express from 'express';
import { handlePaystackWebhook } from '../controllers/webhookController.js';

const router = express.Router();

router.post('/paystack', handlePaystackWebhook);

export default router;
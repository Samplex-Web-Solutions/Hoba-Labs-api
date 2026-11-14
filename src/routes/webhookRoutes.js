import express from 'express';
import { handlePaystackWebhook } from '../controllers/webhookController.js';
import { handleCryptoWebhook } from '../controllers/webhookController.js';


const router = express.Router();

router.post('/paystack', handlePaystackWebhook);
router.post('/crypto', handleCryptoWebhook);

export default router;
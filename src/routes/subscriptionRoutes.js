import express from 'express';
import { 
  getPlansAndConfig, 
  initializeSubscriptionPayment 
} from '../controllers/subscriptionController.js';
import { verifyJWT } from '../middleware/authMiddleware.js';

const router = express.Router();

// Route to fetch plans & exchange rate
router.get('/plans', getPlansAndConfig);

// Route to initialize Paystack checkout (requires user session auth)
router.post('/initialize', verifyJWT, initializeSubscriptionPayment);

export default router;
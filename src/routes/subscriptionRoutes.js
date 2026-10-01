import express from 'express';
import { 
  getPlansAndConfig, 
  initializeSubscriptionPayment, 
  verifySubscriptionPayment 
} from '../controllers/subscriptionController.js';
import { verifyJWT } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/plans', getPlansAndConfig);
router.post('/initialize', verifyJWT, initializeSubscriptionPayment);
router.get('/verify/:reference', verifyJWT, verifySubscriptionPayment); // <--- Added verification route

export default router;
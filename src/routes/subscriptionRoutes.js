import express from 'express';
import { 
  getPlansAndConfig, 
  initializeSubscriptionPayment, 
  verifySubscriptionPayment,
  getSubscriptionHistory 
} from '../controllers/subscriptionController.js';
import { verifyJWT } from '../middleware/authMiddleware.js';
import { initializeCryptoPayment } from '../controllers/subscriptionController.js';


const router = express.Router();

router.get('/plans', getPlansAndConfig);
router.post('/initialize', verifyJWT, initializeSubscriptionPayment);
router.get('/verify/:reference', verifyJWT, verifySubscriptionPayment);
router.get('/history', verifyJWT, getSubscriptionHistory);
router.post('/initialize-crypto', verifyJWT, initializeCryptoPayment);

export default router;
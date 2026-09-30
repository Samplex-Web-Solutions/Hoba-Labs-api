import express from 'express';
import rateLimit from 'express-rate-limit';
import {
  registerUser,
  loginUser,
  syncTelegramUser,
  telegramLogin,
  telegramWebAppLogin,
  linkTelegramAccount,
  saveOnboardingPreferences
} from '../controllers/authController.js';
import {
  verifyTelegramWebAppData,
  verifyInternalService,
  verifyJWT,
  attachUserIfPresent,
} from '../middleware/authMiddleware.js';
import { upgradeSubscription } from '../controllers/subscriptionController.js';
import subscriptionRoutes from './subscriptionRoutes.js'; // Clean ES import

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later.' }
});

// Web Portal Auth Routes
router.post('/register', authLimiter, registerUser);
router.post('/login', authLimiter, loginUser);
router.post('/onboarding', verifyJWT, saveOnboardingPreferences);

// Telegram Mini App Routes
router.post('/telegram-sync', verifyTelegramWebAppData, syncTelegramUser);
router.post('/telegram-webapp-login', verifyTelegramWebAppData, telegramWebAppLogin);
router.post('/link-telegram', authLimiter, attachUserIfPresent, linkTelegramAccount);
router.post('/telegram-login', verifyInternalService, telegramLogin);

// Subscription custom routes
// subscription custom routes
router.post('/upgrade', verifyJWT, upgradeSubscription);

// Mount subscription routes properly under /subscription prefix
router.use('/subscription', subscriptionRoutes);

export default router;
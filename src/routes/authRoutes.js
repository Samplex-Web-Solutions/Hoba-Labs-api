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
import { verifyTelegramWebAppData, verifyInternalService } from '../middleware/authMiddleware.js';
// ^ Adjust this path if your middleware folder is actually named/located differently —
// on a case-sensitive server (Linux), the folder name and case must match exactly.

const router = express.Router();

// Basic brute-force protection on anything that checks a password or account identity.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later.' }
});

// Web Portal Auth Routes
router.post('/register', authLimiter, registerUser);
router.post('/login', authLimiter, loginUser);
router.post('/onboarding', saveOnboardingPreferences);

// Telegram Mini App Routes (frontend, initData verified)
router.post('/telegram-sync', verifyTelegramWebAppData, syncTelegramUser);
router.post('/telegram-webapp-login', verifyTelegramWebAppData, telegramWebAppLogin);
router.post('/link-telegram', authLimiter, linkTelegramAccount);

router.post('/telegram-login', verifyInternalService, telegramLogin);

export default router;

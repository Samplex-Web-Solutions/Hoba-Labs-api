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
  attachUserIfPresent
} from '../middleware/authMiddleware.js';
// ^ Adjust this path if your middleware folder is actually named/located differently —
// on a case-sensitive server (Linux), the folder name and case must match exactly.

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

// Telegram Mini App Routes (frontend, initData verified)
router.post('/telegram-sync', verifyTelegramWebAppData, syncTelegramUser);
router.post('/telegram-webapp-login', verifyTelegramWebAppData, telegramWebAppLogin);

// Works whether or not the caller already has a session — see linkTelegramAccount
router.post('/link-telegram', authLimiter, attachUserIfPresent, linkTelegramAccount);

// Internal-only route — called by bot.js (server-to-server), never by public clients
router.post('/telegram-login', verifyInternalService, telegramLogin);

export default router;

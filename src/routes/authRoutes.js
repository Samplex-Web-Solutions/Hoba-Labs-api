import express from 'express';
import { registerUser, loginUser, saveOnboardingPreferences } from '../controllers/authController.js';

const router = express.Router();

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/onboarding', saveOnboardingPreferences);

export default router;
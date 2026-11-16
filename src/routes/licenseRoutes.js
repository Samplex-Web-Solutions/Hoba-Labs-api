// src/routes/licenseRoutes.js
import express from 'express';
import { redeemEALicense } from '../controllers/licenseController.js';
import { verifyJWT } from '../middleware/authMiddleware.js';

const router = express.Router();

// POST /api/license/redeem - Validates key and unlocks user EA access strictly 1-to-1
router.post('/redeem', verifyJWT, redeemEALicense);

export default router;
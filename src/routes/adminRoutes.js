// src/routes/adminRoutes.js
import express from 'express';
import { verifyJWT } from '../middleware/authMiddleware.js'; // Updated from verifyAuth to verifyJWT
import { verifyAdmin } from '../middleware/adminMiddleware.js';
import { 
  getAllUsersAdmin, 
  updateUserEaAccess, 
  getAdminPlatformStats 
} from '../controllers/adminController.js';

const router = express.Router();

// Apply auth and admin verification middleware to all admin endpoints
router.use(verifyJWT, verifyAdmin);

router.get('/users', getAllUsersAdmin);
router.patch('/users/:targetUserId/ea-access', updateUserEaAccess);
router.get('/stats', getAdminPlatformStats);

export default router;
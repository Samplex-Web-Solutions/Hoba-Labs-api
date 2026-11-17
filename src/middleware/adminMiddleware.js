// src/middleware/adminMiddleware.js
import { supabase } from '../config/supabase.js';

export async function verifyAdmin(req, res, next) {
  try {
    const userId = req.userId; // Provided by your base auth middleware

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized access.' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('is_admin, email')
      .eq('id', userId)
      .single();

    if (error || !user || !user.is_admin) {
      console.warn(`[ADMIN_SECURITY]: Unauthorized admin access attempt by user ID ${userId}`);
      return res.status(403).json({ success: false, error: 'Access denied. Administrator privileges required.' });
    }

    // Attach admin info if needed and proceed
    req.adminEmail = user.email;
    next();
  } catch (err) {
    console.error('[ADMIN_MIDDLEWARE_ERROR]:', err.message);
    return res.status(500).json({ success: false, error: 'Internal server security check failed.' });
  }
}
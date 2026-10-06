import { supabase } from '../config/supabase.js';

/**
 * Middleware to verify that the authenticated user has an active or trialing subscription.
 * Relies on req.userId populated by the preceding verifyJWT middleware.
 */
export const checkSubscriptionMiddleware = async (req, res, next) => {
    try {
        const userId = req.userId;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized: No user session found' });
        }

        // Fetch user subscription status directly from the users table
        const { data: user, error } = await supabase
            .from('users')
            .select('id, subscription_status, subscription_plan')
            .eq('id', userId)
            .single();

        if (error || !user) {
            return res.status(403).json({ error: 'Forbidden: User record not found' });
        }

        // Normalize status check to handle case variations ('Active', 'active', 'Trialing', 'trialing')
        const status = (user.subscription_status || '').trim().toLowerCase();
        const validStatuses = ['active', 'trialing'];

        if (!validStatuses.includes(status)) {
            return res.status(403).json({ 
                error: 'Subscription Required', 
                message: 'Your account requires an active or trialing subscription to access live institutional trading signals.' 
            });
        }

        // Attach user info to request for controller use if needed
        req.currentUser = user;
        next();
    } catch (err) {
        console.error('[SUBSCRIPTION_MIDDLEWARE_ERROR]:', err.message);
        return res.status(500).json({ error: 'Internal server error verifying subscription status' });
    }
};
import { supabase } from '../config/supabase.js';

/**
 * Middleware to verify that the authenticated user has an active or trialing subscription.
 */
export const checkSubscriptionMiddleware = async (req, res, next) => {
    try {
        const userId = req.userId;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized: No user session found' });
        }

        // Fetch user subscription status directly from the subscriptions table
        const { data: subscription, error } = await supabase
            .from('subscriptions')
            .select('status, plan_type, current_period_end, trial_ends_at')
            .eq('user_id', userId)
            .single();

        if (error || !subscription) {
            return res.status(403).json({ error: 'Forbidden: Subscription record not found' });
        }

        const status = (subscription.status || '').trim().toLowerCase();
        const validStatuses = ['active', 'trialing'];

        if (!validStatuses.includes(status)) {
            return res.status(403).json({ 
                error: 'Subscription Required', 
                message: 'Your account requires an active or trialing subscription to access live institutional trading signals.' 
            });
        }

        req.currentSubscription = subscription;
        next();
    } catch (err) {
        console.error('[SUBSCRIPTION_MIDDLEWARE_ERROR]:', err.message);
        return res.status(500).json({ error: 'Internal server error verifying subscription status' });
    }
};
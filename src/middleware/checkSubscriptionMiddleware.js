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

        const { data: subscription, error } = await supabase
            .from('subscriptions')
            .select('id, status, plan_type, current_period_end, trial_ends_at')
            .eq('user_id', userId)
            .single();

        if (error || !subscription) {
            return res.status(403).json({ error: 'Forbidden: Subscription record not found' });
        }

        const status = (subscription.status || '').trim().toLowerCase();
        const now = new Date();

        // 1. Determine active expiry threshold date
        const expiryDate = status === 'trialing' 
            ? (subscription.trial_ends_at ? new Date(subscription.trial_ends_at) : null)
            : (subscription.current_period_end ? new Date(subscription.current_period_end) : null);

        // 2. If expiry date exists and has passed, automatically update database status to 'expired'
        if (expiryDate && expiryDate < now) {
            if (status !== 'expired') {
                await supabase
                    .from('subscriptions')
                    .update({ 
                        status: 'expired', 
                        updated_at: now.toISOString() 
                    })
                    .eq('user_id', userId);
            }

            return res.status(403).json({ 
                error: 'Subscription Expired', 
                message: 'Your subscription or trial period has ended. Please upgrade to continue accessing signals.' 
            });
        }

        const validStatuses = ['active', 'trialing'];
        if (!validStatuses.includes(status)) {
            return res.status(403).json({ 
                error: 'Subscription Required', 
                message: 'Your account requires an active subscription to access trading signals.' 
            });
        }

        req.currentSubscription = subscription;
        next();
    } catch (err) {
        console.error('[SUBSCRIPTION_MIDDLEWARE_ERROR]:', err.message);
        return res.status(500).json({ error: 'Internal server error verifying subscription status' });
    }
};
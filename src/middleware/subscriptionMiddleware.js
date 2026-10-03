import { supabase } from '../config/supabase.js';

export async function checkSubscriptionMiddleware(req, res, next) {
  try {
    const userId = req.userId; 

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized: No user context' });
    }

    // Fetch subscription using your updated upsert/update schema
    const { data: sub, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error || !sub) {
      return res.status(403).json({ 
        success: false, 
        message: 'No active subscription found. Please subscribe to access this feature.' 
      });
    }

    const now = new Date();
    const periodEnd = new Date(sub.current_period_end);
    const trialEnd = sub.trial_ends_at ? new Date(sub.trial_ends_at) : null;

    // Check if either the paid period or the trial is still valid
    const isActive = periodEnd > now || (trialEnd && trialEnd > now);

    if (!isActive) {
      // Automatically update database status to expired if it isn't already
      if (sub.status !== 'expired') {
        await supabase
          .from('subscriptions')
          .update({ status: 'expired' })
          .eq('user_id', userId);

        await supabase
          .from('users')
          .update({ subscription_status: 'Expired' })
          .eq('id', userId);
      }

      return res.status(403).json({ 
        success: false, 
        message: 'Your subscription has expired. Please renew your plan to continue.' 
      });
    }

    // User is active! Proceed to the protected controller
    next();
  } catch (err) {
    console.error('Subscription middleware error:', err);
    return res.status(500).json({ success: false, message: 'Server error validating subscription' });
  }
}
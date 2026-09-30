import { supabase } from '../config/supabase.js';

/**
 * Credits the referrer with a $3 bonus when their referred user activates a paid subscription.
 * @param {string} userId - The ID of the user who just subscribed
 */
export async function processReferralReward(userId) {
  try {
    // 1. Check if this user was referred by someone
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('referred_by')
      .eq('id', userId)
      .single();

    if (userError || !user || !user.referred_by) return;

    const referrerId = user.referred_by;

    // 2. Prevent duplicate rewards for the same referred user
    const { data: existingReward } = await supabase
      .from('referral_earnings')
      .select('id')
      .eq('referrer_id', referrerId)
      .eq('referred_user_id', userId)
      .single();

    if (existingReward) {
      console.log(`[REFERRAL]: Reward already issued for user ${userId} to referrer ${referrerId}`);
      return;
    }

    // 3. Insert $3 referral earning record
    const { error: insertError } = await supabase
      .from('referral_earnings')
      .insert([{
        referrer_id: referrerId,
        referred_user_id: userId,
        amount: 3.00,
        status: 'PENDING'
      }]);

    if (insertError) throw insertError;

    console.log(`[REFERRAL_SUCCESS]: Credited $3 to referrer ${referrerId} for subscriber ${userId}`);
  } catch (err) {
    console.error('[REFERRAL_ERROR]: Failed to process referral reward:', err.message);
  }
}
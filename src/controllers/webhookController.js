import { supabase } from '../config/supabase.js';
import { processReferralReward } from '../utils/processReward.js';
import crypto from 'crypto';

export const handlePaystackWebhook = async (req, res) => {
  try {
    // 1. Verify Paystack signature for security
    const hash = crypto
      .createHmac('sha512', process.env.VITE_PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      return res.status(401).json({ error: 'Unauthorized webhook signature' });
    }

    const event = req.body;

    // 2. Listen for successful charge events
    if (event.event === 'charge.success') {
      const transactionData = event.data;
      const reference = transactionData.reference; // Format: HOBA-{PLANKEY}-{TIMESTAMP}
      const metadata = transactionData.metadata;
      const customer = transactionData.customer;

      const refParts = reference.split('-');
      if (refParts.length < 2) {
        console.error('[WEBHOOK_ERROR]: Invalid transaction reference format.');
        return res.sendStatus(200);
      }
      const planKey = refParts[1].toLowerCase();

      // 3. Fetch plan details and duration dynamically from Supabase
      const { data: plan, error: planError } = await supabase
        .from('subscription_plans')
        .select('*')
        .eq('plan_key', planKey)
        .single();

      if (planError || !plan) {
        console.error(`[WEBHOOK_ERROR]: Plan not found in database: ${planKey}`);
        return res.sendStatus(200);
      }

      // 4. Find user by metadata user_id, or fallback to email / phone matching
      let userId = metadata?.user_id;

      if (!userId && customer?.email) {
        const { data: userByEmail } = await supabase
          .from('users')
          .select('id')
          .eq('email', customer.email.toLowerCase().trim())
          .single();
        if (userByEmail) userId = userByEmail.id;
      }

      if (!userId && customer?.phone) {
        const { data: userByPhone } = await supabase
          .from('users')
          .select('id')
          .eq('phone', customer.phone.trim())
          .single();
        if (userByPhone) userId = userByPhone.id;
      }

      if (!userId) {
        console.error(`[WEBHOOK_ERROR]: Could not resolve user for transaction: ${reference}`);
        return res.sendStatus(200);
      }

      // 5. Calculate subscription expiry date dynamically using plan.days from database
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + plan.days);

      // 6. Update or insert into subscriptions table
      await supabase
        .from('subscriptions')
        .upsert([{
          user_id: userId,
          status: 'active',
          plan_type: planKey,
          expires_at: expiresAt.toISOString(),
          trial_ends_at: null
        }], { onConflict: 'user_id' });

      // 7. Update user profile status & plan
      await supabase
        .from('users')
        .update({
          subscription_status: 'Active',
          subscription_plan: planKey,
          subscription_amount: transactionData.amount / 100
        })
        .eq('id', userId);

      // 8. Trigger automated referral reward securely server-side
      await processReferralReward(userId);

      console.log(`[PAYMENT_SUCCESS]: User ${userId} successfully upgraded to ${plan.name} (${plan.days} days) via Paystack webhook.`);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[WEBHOOK_CRITICAL_ERROR]:', err.message);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
};
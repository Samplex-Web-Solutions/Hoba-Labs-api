import { supabase } from '../config/supabase.js';
import { processReferralReward } from '../utils/processReward.js';
import crypto from 'crypto';

export const handlePaystackWebhook = async (req, res) => {
  try {
    const hash = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      return res.status(401).json({ error: 'Unauthorized webhook signature' });
    }

    const event = req.body;

    if (event.event === 'charge.success') {
      const transactionData = event.data;
      const reference = transactionData.reference; 
      const metadata = transactionData.metadata;
      const customer = transactionData.customer;

      const refParts = reference.split('-');
      if (refParts.length < 2) {
        console.error('[WEBHOOK_ERROR]: Invalid transaction reference format.');
        return res.sendStatus(200);
      }
      const planKey = refParts[1].toLowerCase();

      const { data: plan, error: planError } = await supabase
        .from('subscription_plans')
        .select('*')
        .eq('plan_key', planKey)
        .single();

      if (planError || !plan) {
        console.error(`[WEBHOOK_ERROR]: Plan not found in database: ${planKey}`);
        return res.sendStatus(200);
      }

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

      const periodStart = new Date();
      const periodEnd = new Date();
      periodEnd.setDate(periodEnd.getDate() + plan.days);

      const amountPaidUSD = transactionData.amount / 100;

      // 1. Update primary active subscription
      await supabase
        .from('subscriptions')
        .upsert([{
          user_id: userId,
          status: 'active',
          plan_type: planKey,
          amount: amountPaidUSD,
          current_period_end: periodEnd.toISOString(),
          trial_ends_at: null,
          updated_at: periodStart.toISOString()
        }], { onConflict: 'user_id' });

      // 2. Log historical entry for user tracking & dashboard history
      await supabase
        .from('subscription_history')
        .insert([{
          user_id: userId,
          plan_key: planKey,
          amount: amountPaidUSD,
          status: 'success',
          reference: reference,
          payment_method: 'paystack',
          period_start: periodStart.toISOString(),
          period_end: periodEnd.toISOString()
        }]);

      await processReferralReward(userId);

      console.log(`[PAYMENT_SUCCESS]: User ${userId} upgraded to ${plan.name}. Historical log created.`);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[WEBHOOK_CRITICAL_ERROR]:', err.message);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
};
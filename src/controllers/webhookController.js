import { supabase } from '../config/supabase.js';
import { processReferralReward } from '../utils/processReward.js';
import crypto from 'crypto';

export const handlePaystackWebhook = async (req, res) => {
  try {
    // Use rawBody buffer if available for exact cryptographic match, fallback to JSON.stringify
    const payloadString = req.rawBody || JSON.stringify(req.body);
    
    const hash = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
      .update(payloadString)
      .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      console.error('[SECURITY_WARNING]: Invalid Paystack webhook signature received.');
      return res.status(401).json({ error: 'Unauthorized webhook signature' });
    }

    const event = req.body;

    if (event.event === 'charge.success') {
      const transactionData = event.data;
      const reference = transactionData.reference; 
      const metadata = transactionData.metadata;
      const customer = transactionData.customer;

      // 1. Idempotency Check: If history entry with this reference already exists and is success, skip processing
      const { data: existingHistory } = await supabase
        .from('subscription_history')
        .select('id, status')
        .eq('reference', reference)
        .single();

      if (existingHistory && existingHistory.status === 'success') {
        return res.status(200).json({ received: true, note: 'Already processed' });
      }

      // 2. Resolve plan_key safely from metadata or reference fallback
      let planKey = metadata?.plan_key?.toLowerCase();
      if (!planKey) {
        const refParts = reference.split('-');
        if (refParts.length >= 3) {
          planKey = refParts.slice(1, refParts.length - 1).join('_').toLowerCase();
        }
      }

      const { data: plan, error: planError } = await supabase
        .from('subscription_plans')
        .select('*')
        .eq('plan_key', planKey)
        .single();

      if (planError || !plan) {
        console.error(`[WEBHOOK_ERROR]: Plan not found in database: ${planKey}`);
        return res.status(200).json({ received: true, error: 'Plan not found' });
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
        return res.status(200).json({ received: true, error: 'User not resolved' });
      }

      const periodStart = new Date();
      const periodEnd = new Date();
      periodEnd.setDate(periodEnd.getDate() + plan.days);

      const amountPaidUSD = transactionData.amount / 100;

      // 3. Upsert subscription record
      const { data: existingSub } = await supabase
        .from('subscriptions')
        .select('id, trial_ends_at')
        .eq('user_id', userId)
        .single();

      const subPayload = {
        user_id: userId,
        status: 'active',
        plan_type: planKey,
        amount: amountPaidUSD,
        current_period_end: periodEnd.toISOString(),
        trial_ends_at: existingSub?.trial_ends_at || periodEnd.toISOString(),
        updated_at: periodStart.toISOString()
      };

      if (existingSub) {
        await supabase
          .from('subscriptions')
          .update(subPayload)
          .eq('user_id', userId);
      } else {
        await supabase
          .from('subscriptions')
          .insert([subPayload]);
      }

      // 4. Record or update history atomically
      if (!existingHistory) {
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
      } else {
        await supabase
          .from('subscription_history')
          .update({ status: 'success' })
          .eq('reference', reference);
      }

      // 5. Process referral reward safely once
      await processReferralReward(userId);

      console.log(`[PAYMENT_SUCCESS]: User ${userId} upgraded to ${plan.name} (${planKey}) via Webhook.`);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[WEBHOOK_CRITICAL_ERROR]:', err.message);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
};

export const handleCryptoWebhook = async (req, res) => {
  try {
    const receivedSig = req.headers['x-nowpayments-sig'];
    const ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET;

    if (!receivedSig) {
      console.error('[SECURITY_WARNING]: Missing NOWPayments signature header.');
      return res.status(401).json({ error: 'Missing NOWPayments signature header' });
    }

    // 1. Sort incoming JSON payload keys alphabetically for HMAC-SHA512 calculation required by NOWPayments
    const payloadObject = req.body;
    const sortedData = Object.keys(payloadObject)
      .sort()
      .reduce((obj, key) => {
        obj[key] = payloadObject[key];
        return obj;
      }, {});

    // 2. Compute HMAC-SHA512 hash using your IPN secret
    const hmac = crypto.createHmac('sha512', ipnSecret);
    hmac.update(JSON.stringify(sortedData));
    const calculatedSig = hmac.digest('hex');

    if (receivedSig !== calculatedSig) {
      console.error('[SECURITY_WARNING]: Invalid NOWPayments signature mismatch.');
      return res.status(401).json({ error: 'Unauthorized signature' });
    }

    const event = req.body;
    const paymentStatus = event.payment_status; // e.g., 'finished', 'confirmed'
    const orderId = event.order_id; // Format: HOBA-CRYPTO-[PLAN_KEY]-[USER_ID]-[TIMESTAMP]

    if (paymentStatus === 'finished' || paymentStatus === 'confirmed') {
      const parts = orderId ? orderId.split('-') : [];
      if (parts.length < 5) {
        console.error('[CRYPTO_WEBHOOK_ERROR]: Malformed order_id structure:', orderId);
        return res.status(200).json({ received: true, error: 'Malformed order ID' });
      }

      const planKey = parts[2]?.toLowerCase();
      const userId = parts[3];

      if (!userId || !planKey) {
        console.error('[CRYPTO_WEBHOOK_ERROR]: Could not resolve user or plan from order_id:', orderId);
        return res.status(200).json({ received: true, error: 'User or plan not resolved' });
      }

      // Idempotency check: verify if history log already processed this payment id
      const paymentId = String(event.payment_id);
      const { data: existingHistory } = await supabase
        .from('subscription_history')
        .select('id, status')
        .eq('reference', paymentId)
        .single();

      if (existingHistory && existingHistory.status === 'success') {
        return res.status(200).json({ received: true, note: 'Already processed' });
      }

      // Fetch plan configuration
      const { data: plan, error: planError } = await supabase
        .from('subscription_plans')
        .select('*')
        .eq('plan_key', planKey)
        .single();

      if (planError || !plan) {
        console.error(`[CRYPTO_WEBHOOK_ERROR]: Plan not found in database: ${planKey}`);
        return res.status(200).json({ received: true, error: 'Plan not found' });
      }

      const periodStart = new Date();
      const periodEnd = new Date();
      periodEnd.setDate(periodEnd.getDate() + plan.days);

      const amountPaidUSD = Number(event.price_amount || plan.amount);

      // Upsert subscription record
      const { data: existingSub } = await supabase
        .from('subscriptions')
        .select('id, trial_ends_at')
        .eq('user_id', userId)
        .single();

      const subPayload = {
        user_id: userId,
        status: 'active',
        plan_type: planKey,
        amount: amountPaidUSD,
        current_period_end: periodEnd.toISOString(),
        trial_ends_at: existingSub?.trial_ends_at || periodEnd.toISOString(),
        updated_at: periodStart.toISOString()
      };

      if (existingSub) {
        await supabase.from('subscriptions').update(subPayload).eq('user_id', userId);
      } else {
        await supabase.from('subscriptions').insert([subPayload]);
      }

      // Record successful transaction history atomically
      if (!existingHistory) {
        await supabase.from('subscription_history').insert([{
          user_id: userId,
          plan_key: planKey,
          amount: amountPaidUSD,
          status: 'success',
          reference: paymentId,
          payment_method: 'crypto',
          period_start: periodStart.toISOString(),
          period_end: periodEnd.toISOString()
        }]);
      } else {
        await supabase.from('subscription_history').update({ status: 'success' }).eq('reference', paymentId);
      }

      await processReferralReward(userId);
      console.log(`[CRYPTO_SUCCESS]: User ${userId} upgraded to ${plan.name} (${planKey}) via Crypto (Payment ID: ${paymentId}).`);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[CRYPTO_WEBHOOK_CRITICAL_ERROR]:', err.message);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
};








// import { supabase } from '../config/supabase.js';
// import { processReferralReward } from '../utils/processReward.js';
// import crypto from 'crypto';

// export const handlePaystackWebhook = async (req, res) => {
//   try {
//     // Use rawBody buffer if available for exact cryptographic match, fallback to JSON.stringify
//     const payloadString = req.rawBody || JSON.stringify(req.body);
    
//     const hash = crypto
//       .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
//       .update(payloadString)
//       .digest('hex');

//     if (hash !== req.headers['x-paystack-signature']) {
//       console.error('[SECURITY_WARNING]: Invalid Paystack webhook signature received.');
//       return res.status(401).json({ error: 'Unauthorized webhook signature' });
//     }

//     const event = req.body;

//     if (event.event === 'charge.success') {
//       const transactionData = event.data;
//       const reference = transactionData.reference; 
//       const metadata = transactionData.metadata;
//       const customer = transactionData.customer;

//       // 1. Idempotency Check: If history entry with this reference already exists and is success, skip processing
//       const { data: existingHistory } = await supabase
//         .from('subscription_history')
//         .select('id, status')
//         .eq('reference', reference)
//         .single();

//       if (existingHistory && existingHistory.status === 'success') {
//         return res.status(200).json({ received: true, note: 'Already processed' });
//       }

//       // 2. Resolve plan_key safely from metadata or reference fallback
//       let planKey = metadata?.plan_key?.toLowerCase();
//       if (!planKey) {
//         const refParts = reference.split('-');
//         if (refParts.length >= 3) {
//           planKey = refParts.slice(1, refParts.length - 1).join('_').toLowerCase();
//         }
//       }

//       const { data: plan, error: planError } = await supabase
//         .from('subscription_plans')
//         .select('*')
//         .eq('plan_key', planKey)
//         .single();

//       if (planError || !plan) {
//         console.error(`[WEBHOOK_ERROR]: Plan not found in database: ${planKey}`);
//         return res.status(200).json({ received: true, error: 'Plan not found' });
//       }

//       let userId = metadata?.user_id;

//       if (!userId && customer?.email) {
//         const { data: userByEmail } = await supabase
//           .from('users')
//           .select('id')
//           .eq('email', customer.email.toLowerCase().trim())
//           .single();
//         if (userByEmail) userId = userByEmail.id;
//       }

//       if (!userId && customer?.phone) {
//         const { data: userByPhone } = await supabase
//           .from('users')
//           .select('id')
//           .eq('phone', customer.phone.trim())
//           .single();
//         if (userByPhone) userId = userByPhone.id;
//       }

//       if (!userId) {
//         console.error(`[WEBHOOK_ERROR]: Could not resolve user for transaction: ${reference}`);
//         return res.status(200).json({ received: true, error: 'User not resolved' });
//       }

//       const periodStart = new Date();
//       const periodEnd = new Date();
//       periodEnd.setDate(periodEnd.getDate() + plan.days);

//       const amountPaidUSD = transactionData.amount / 100;

//       // 3. Upsert subscription record
//       const { data: existingSub } = await supabase
//         .from('subscriptions')
//         .select('id, trial_ends_at')
//         .eq('user_id', userId)
//         .single();

//       const subPayload = {
//         user_id: userId,
//         status: 'active',
//         plan_type: planKey,
//         amount: amountPaidUSD,
//         current_period_end: periodEnd.toISOString(),
//         trial_ends_at: existingSub?.trial_ends_at || periodEnd.toISOString(),
//         updated_at: periodStart.toISOString()
//       };

//       if (existingSub) {
//         await supabase
//           .from('subscriptions')
//           .update(subPayload)
//           .eq('user_id', userId);
//       } else {
//         await supabase
//           .from('subscriptions')
//           .insert([subPayload]);
//       }

//       // 4. Record or update history atomically
//       if (!existingHistory) {
//         await supabase
//           .from('subscription_history')
//           .insert([{
//             user_id: userId,
//             plan_key: planKey,
//             amount: amountPaidUSD,
//             status: 'success',
//             reference: reference,
//             payment_method: 'paystack',
//             period_start: periodStart.toISOString(),
//             period_end: periodEnd.toISOString()
//           }]);
//       } else {
//         await supabase
//           .from('subscription_history')
//           .update({ status: 'success' })
//           .eq('reference', reference);
//       }

//       // 5. Process referral reward safely once
//       await processReferralReward(userId);

//       console.log(`[PAYMENT_SUCCESS]: User ${userId} upgraded to ${plan.name} (${planKey}) via Webhook.`);
//     }

//     return res.status(200).json({ received: true });
//   } catch (err) {
//     console.error('[WEBHOOK_CRITICAL_ERROR]:', err.message);
//     return res.status(500).json({ error: 'Webhook processing failed' });
//   }
// };








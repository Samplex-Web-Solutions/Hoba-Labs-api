// src/controllers/webhookController.js
import { supabase } from '../config/supabase.js';
import { processReferralReward } from '../utils/processReward.js';
import { generateLicenseKey } from '../utils/KeyGenerator.js';
import { sendLicenseEmail } from '../services/email/emailService.js';
import crypto from 'crypto';

export const handlePaystackWebhook = async (req, res) => {
  try {
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

      const { data: existingHistory } = await supabase
        .from('subscription_history')
        .select('id, status')
        .eq('reference', reference)
        .single();

      if (existingHistory && existingHistory.status === 'success') {
        return res.status(200).json({ received: true, note: 'Already processed' });
      }

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
      let dbUser = null;

      if (!userId && customer?.email) {
        const { data: userByEmail } = await supabase
          .from('users')
          .select('id, email, first_name')
          .eq('email', customer.email.toLowerCase().trim())
          .single();
        if (userByEmail) {
          userId = userByEmail.id;
          dbUser = userByEmail;
        }
      } else if (userId) {
        const { data: userById } = await supabase
          .from('users')
          .select('id, email, first_name')
          .eq('id', userId)
          .single();
        if (userById) dbUser = userById;
      }

      if (!userId && customer?.phone) {
        const { data: userByPhone } = await supabase
          .from('users')
          .select('id, email, first_name')
          .eq('phone', customer.phone.trim())
          .single();
        if (userByPhone) {
          userId = userByPhone.id;
          dbUser = userByPhone;
        }
      }

      if (!userId) {
        console.error(`[WEBHOOK_ERROR]: Could not resolve user for transaction: ${reference}`);
        return res.status(200).json({ received: true, error: 'User not resolved' });
      }

      const periodStart = new Date();
      const periodEnd = new Date();
      periodEnd.setDate(periodEnd.getDate() + plan.days);

      const amountPaidUSD = transactionData.amount / 100;

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

      // GENERATE KEY & EMAIL ONLY (Requires manual key redemption to set ea_access = true)
      if (planKey.includes('ea')) {
        const newLicenseKey = generateLicenseKey();
        const { error: keyError } = await supabase
          .from('license_keys')
          .insert({
            user_id: userId,
            key_code: newLicenseKey,
            status: 'ACTIVE',
            plan_type: planKey,
            expires_at: periodEnd.toISOString()
          });

        if (keyError) {
          console.error('[WEBHOOK_ERROR]: Failed to insert license key:', keyError.message);
        } else if (dbUser && dbUser.email) {
          try {
            await sendLicenseEmail(dbUser.email, dbUser.first_name, newLicenseKey, periodEnd);
            console.log(`[LICENSE_EMAIL]: License key ${newLicenseKey} emailed to ${dbUser.email}`);
          } catch (emailErr) {
            console.error('[EMAIL_ERROR]: Failed to send license email:', emailErr.message);
          }
        }
      } else {
        console.log(`[SUBSCRIPTION_SUCCESS]: User ${userId} subscribed to signal plan (${planKey}). EA access remains locked.`);
      }

      await processReferralReward(userId);

      console.log(`[PAYMENT_SUCCESS]: User ${userId} upgraded to ${plan.name} (${planKey}) via Paystack Webhook.`);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[WEBHOOK_CRITICAL_ERROR]:', err.message);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
};

export const handleCryptoWebhook = async (req, res) => {
  try {
    const receivedSig = req.headers['x-nowpayments-sig'] || req.headers['X-NOWPAYMENTS-SIG'];
    const ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET;

    if (!receivedSig) {
      console.error('[SECURITY_WARNING]: Missing NOWPayments signature header.');
      return res.status(401).json({ error: 'Missing NOWPayments signature header' });
    }

    const payloadObject = req.body;
    const sortedData = Object.keys(payloadObject)
      .sort()
      .reduce((obj, key) => {
        obj[key] = payloadObject[key];
        return obj;
      }, {});

    const hmac = crypto.createHmac('sha512', ipnSecret);
    hmac.update(JSON.stringify(sortedData));
    const calculatedSig = hmac.digest('hex');

    if (receivedSig !== calculatedSig) {
      console.error('[SECURITY_WARNING]: Invalid NOWPayments signature mismatch.');
      return res.status(401).json({ error: 'Unauthorized signature' });
    }

    const event = req.body;
    const paymentStatus = event.payment_status; 
    const orderId = event.order_id; 

    if (paymentStatus === 'finished' || paymentStatus === 'confirmed') {
      const orderMatch = orderId.match(/^HOBA-CRYPTO-(.+)-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})-(\d+)$/);

      let planKey, userId;

      if (orderMatch) {
        planKey = orderMatch[1].toLowerCase();
        userId = orderMatch[2];
      } else {
        console.error('[CRYPTO_WEBHOOK_ERROR]: Malformed order_id structure:', orderId);
        return res.status(200).json({ received: true, error: 'Malformed order ID' });
      }
      
      if (!userId || !planKey) {
        console.error('[CRYPTO_WEBHOOK_ERROR]: Could not resolve user or plan from order_id:', orderId);
        return res.status(200).json({ received: true, error: 'User or plan not resolved' });
      }

      const paymentId = String(event.payment_id);

      const { data: existingHistory } = await supabase
        .from('subscription_history')
        .select('id, status')
        .eq('reference', paymentId)
        .single();

      if (existingHistory && existingHistory.status === 'success') {
        return res.status(200).json({ received: true, note: 'Already processed' });
      }

      const { data: dbUser } = await supabase
        .from('users')
        .select('id, email, first_name')
        .eq('id', userId)
        .single();

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

      // GENERATE KEY & EMAIL ONLY (Requires manual key redemption to set ea_access = true)
      if (planKey.includes('ea')) {
        const newLicenseKey = generateLicenseKey();
        const { error: keyError } = await supabase
          .from('license_keys')
          .insert({
            user_id: userId,
            key_code: newLicenseKey,
            status: 'ACTIVE',
            plan_type: planKey,
            expires_at: periodEnd.toISOString()
          });

        if (keyError) {
          console.error('[CRYPTO_WEBHOOK_ERROR]: Failed to insert license key:', keyError.message);
        } else if (dbUser && dbUser.email) {
          try {
            await sendLicenseEmail(dbUser.email, dbUser.first_name, newLicenseKey, periodEnd);
            console.log(`[CRYPTO_LICENSE_EMAIL]: License key ${newLicenseKey} emailed to ${dbUser.email}`);
          } catch (emailErr) {
            console.error('[CRYPTO_EMAIL_ERROR]: Failed to send license email:', emailErr.message);
          }
        }
      } else {
        console.log(`[CRYPTO_SUBSCRIPTION_SUCCESS]: User ${userId} subscribed to signal plan (${planKey}). EA access remains locked.`);
      }

      await processReferralReward(userId);
      console.log(`🚀 [CRYPTO_SUCCESS]: User ${userId} upgraded to ${plan.name} (${planKey}) via Crypto!`);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[CRYPTO_WEBHOOK_CRITICAL_ERROR]:', err.message);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
};
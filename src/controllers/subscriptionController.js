import { supabase } from '../config/supabase.js';
import { processReferralReward } from '../utils/processReward.js';
import axios from 'axios';

export async function getPlansAndConfig(req, res) {
  try {
    const { data: plans, error: plansError } = await supabase
      .from('subscription_plans')
      .select('*');

    const { data: settings, error: settingsError } = await supabase
      .from('app_settings')
      .select('*');

    if (plansError || settingsError) throw new Error('Database fetch error');

    const exchangeRateSetting = settings.find(s => s.key === 'naira_exchange_rate');
    const exchangeRate = exchangeRateSetting ? Number(exchangeRateSetting.value) : 1500;

    const formattedPlans = plans.map(plan => ({
      ...plan,
      naira_price: Number(plan.amount) * exchangeRate
    }));

    return res.status(200).json({
      success: true,
      exchangeRate,
      plans: formattedPlans
    });
  } catch (err) {
    console.error('Error fetching subscription data:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

export async function initializeSubscriptionPayment(req, res) {
  try {
    const { plan_key } = req.body;
    const userId = req.userId;

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('email, phone, id, first_name')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const customerEmail = user.email || (user.phone 
      ? `user_${user.phone.replace(/[^0-9]/g, '')}@hobalabs.internal` 
      : `user_${userId.substring(0, 8)}@hobalabs.internal`);

    const { data: plan, error: planError } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('plan_key', plan_key)
      .single();

    if (planError || !plan) {
      return res.status(400).json({ success: false, message: 'Invalid subscription plan' });
    }

    const { data: settings } = await supabase
      .from('app_settings')
      .select('*')
      .eq('key', 'naira_exchange_rate')
      .single();

    const exchangeRate = settings ? Number(settings.value) : 1400;
    const totalNaira = Number(plan.amount) * exchangeRate;
    const amountInKobo = Math.round(totalNaira * 100);

    // Dynamic reference containing plan_key e.g., HOBA-EA_MONTHLY-1776... or HOBA-SIGNAL_MONTHLY-...
    const paystackResponse = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email: customerEmail,
        amount: amountInKobo,
        reference: `HOBA-${plan.plan_key.toUpperCase()}-${Date.now()}`,
        callback_url: `${process.env.FRONTEND_URL}/dashboard?payment=verified`,
        metadata: {
          user_id: userId,
          phone: user.phone,
          plan_key: plan.plan_key
        }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return res.status(200).json({
      success: true,
      authorization_url: paystackResponse.data.data.authorization_url,
      reference: paystackResponse.data.data.reference
    });

  } catch (err) {
    console.error('Paystack initialization error:', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: 'Failed to initialize payment' });
  }
}

export async function initializeCryptoPayment(req, res) {
  try {
    const { plan_key } = req.body;
    const userId = req.userId;

    // 1. Fetch user details for logging or reference tracking
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('email, phone, id')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // 2. Fetch the selected subscription plan from database
    const { data: plan, error: planError } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('plan_key', plan_key)
      .single();

    if (planError || !plan) {
      return res.status(400).json({ success: false, message: 'Invalid subscription plan' });
    }

    // Strict order_id format required to parse user_id and plan_key back in the webhook:
    // HOBA-CRYPTO-[plan_key]-[user_id]-[timestamp]
    const orderId = `HOBA-CRYPTO-${plan.plan_key.toLowerCase()}-${userId}-${Date.now()}`;
    const amountUsd = Number(plan.amount).toFixed(2); // e.g., "10.00"

    // 3. Call NOWPayments Invoice API
    const npResponse = await axios.post(
      `${process.env.NOWPAYMENTS_API_URL}/invoice`,
      {
        price_amount: amountUsd,
        price_currency: 'usd',
        pay_currency: '', // Leave empty to let users choose any currency on the hosted widget (as shown in your screenshot)
        ipn_callback_url: `${process.env.BACKEND_URL}/api/webhook/crypto`,
        order_id: orderId,
        order_description: `Hoba Labs Subscription: ${plan.name}`,
        success_url: `${process.env.FRONTEND_URL}/dashboard?payment=crypto_success`,
        cancel_url: `${process.env.FRONTEND_URL}/dashboard?payment=cancelled`,
      },
      {
        headers: {
          'x-api-key': process.env.NOWPAYMENTS_API_KEY,
          'Content-Type': 'application/json',
        },
      }
    );

    return res.status(200).json({
      success: true,
      invoice_url: npResponse.data.invoice_url,
      id: npResponse.data.id,
    });

  } catch (err) {
    console.error('NOWPayments init error:', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: 'Failed to initialize crypto payment session' });
  }
}

export async function verifySubscriptionPayment(req, res) {
  try {
    const { reference } = req.params;
    const userId = req.userId;

    // 1. Check if history already marked successful (prevents redundant processing if webhook beat it)
    const { data: existingHistory } = await supabase
      .from('subscription_history')
      .select('*')
      .eq('reference', reference)
      .single();

    if (existingHistory && existingHistory.status === 'success') {
      return res.status(200).json({
        success: true,
        message: 'Subscription already verified and active'
      });
    }

    const paystackVerifyResponse = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
        }
      }
    );

    const txData = paystackVerifyResponse.data.data;

    if (txData.status !== 'success') {
      return res.status(400).json({ success: false, message: 'Transaction not successful' });
    }

    let planKey = txData.metadata?.plan_key?.toLowerCase();
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
      return res.status(400).json({ success: false, message: 'Plan configuration not found' });
    }

    const periodStart = new Date();
    const periodEnd = new Date();
    periodEnd.setDate(periodEnd.getDate() + plan.days);

    const amountPaid = txData.amount / 100;

    const { data: existingSub } = await supabase
      .from('subscriptions')
      .select('id, trial_ends_at')
      .eq('user_id', userId)
      .single();

    const subPayload = {
      user_id: userId,
      status: 'active',
      plan_type: planKey,
      amount: amountPaid,
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
          amount: amountPaid,
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

    await processReferralReward(userId);

    return res.status(200).json({
      success: true,
      message: 'Subscription verified and activated successfully'
    });

  } catch (err) {
    console.error('Verification error:', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: 'Failed to verify transaction' });
  }
}

export async function getSubscriptionHistory(req, res) {
  try {
    const userId = req.userId;

    const { data: history, error } = await supabase
      .from('subscription_history')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return res.status(200).json({
      success: true,
      history
    });
  } catch (err) {
    console.error('Fetch history error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch subscription history' });
  }
}
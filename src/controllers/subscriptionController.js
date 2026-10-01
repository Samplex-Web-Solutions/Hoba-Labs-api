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

// Initialize Paystack Payment Securely on Backend
export async function initializeSubscriptionPayment(req, res) {
  try {
    const { plan_key } = req.body;
    const userId = req.userId; // Provided by verifyJWT middleware

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

    const exchangeRate = settings ? Number(settings.value) : 1500;
    const totalNaira = Number(plan.amount) * exchangeRate;
    const amountInKobo = Math.round(totalNaira * 100);

    const paystackResponse = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email: customerEmail,
        amount: amountInKobo,
        reference: `HOBA-${plan.plan_key.toUpperCase()}-${Date.now()}`,
        callback_url: `${process.env.FRONTEND_URL}/dashboard?payment=verified`,
        metadata: {
          user_id: userId,
          phone: user.phone
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

// Verify Paystack Transaction Manually (Fallback if webhook is delayed)
export async function verifySubscriptionPayment(req, res) {
  try {
    const { reference } = req.params;
    const userId = req.userId;

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

    const refParts = reference.split('-');
    if (refParts.length < 2) {
      return res.status(400).json({ success: false, message: 'Invalid reference format' });
    }
    const planKey = refParts[1].toLowerCase();

    const { data: plan } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('plan_key', planKey)
      .single();

    if (!plan) {
      return res.status(400).json({ success: false, message: 'Plan not found' });
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + plan.days);

    await supabase
      .from('subscriptions')
      .upsert([{
        user_id: userId,
        status: 'active',
        plan_type: planKey,
        expires_at: expiresAt.toISOString(),
        trial_ends_at: null
      }], { onConflict: 'user_id' });

    await supabase
      .from('users')
      .update({
        subscription_status: 'Active',
        subscription_plan: planKey,
        subscription_amount: txData.amount / 100
      })
      .eq('id', userId);

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
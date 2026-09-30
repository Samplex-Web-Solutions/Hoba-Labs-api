import { supabase } from '../config/supabase.js'; // matching your project's supabase import
import axios from 'axios';

// 1. Get all subscription plans & current exchange rate
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

// 2. Initialize Paystack Payment Securely on Backend
export async function initializeSubscriptionPayment(req, res) {
  try {
    const { plan_key } = req.body;
    const userId = req.user.id; 
    const email = req.user.email;

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
        email,
        amount: amountInKobo,
        reference: `HOBA-${plan.plan_key.toUpperCase()}-${Date.now()}`,
        callback_url: `${process.env.FRONTEND_URL}/dashboard?payment=verified`
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

// Optional placeholder if called elsewhere
export async function upgradeSubscription(req, res) {
  return res.status(501).json({ message: 'Use Paystack initialization endpoint instead.' });
}
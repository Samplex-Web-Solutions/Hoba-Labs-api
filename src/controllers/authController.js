import { supabase } from '../config/supabase.js';
import bcrypt from 'bcrypt';

// --- REGISTER CONTROLLER ---
export const registerUser = async (req, res) => {
  try {
    const { firstName, lastName, phone, password } = req.body;

    if (!firstName || !lastName || !phone || !password) {
      return res.status(400).json({ error: 'All fields are required.' });
    }

    // Check if user with this WhatsApp phone number already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('phone', phone)
      .single();

    if (existingUser) {
      return res.status(400).json({ error: 'User with this WhatsApp phone number already exists.' });
    }

    // Hash password securely
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Insert user into Supabase table
    const { data, error } = await supabase
      .from('users')
      .insert([
        {
          first_name: firstName,
          last_name: lastName,
          phone: phone,
          password_hash: passwordHash,
          subscription_status: 'Trialing',
          subscription_plan: 'Free Trial',
          subscription_amount: 0.00,
          onboarding_completed: false,
        }
      ])
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: data.id,
        firstName: data.first_name,
        lastName: data.last_name,
        phone: data.phone,
        subscriptionPlan: data.subscription_plan,
        subscriptionAmount: data.subscription_amount,
        onboarding_completed: data.onboarding_completed
      }
    });
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ error: 'Internal server error during registration.' });
  }
};

// --- LOGIN CONTROLLER ---
export const loginUser = async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ error: 'Phone number and password are required.' });
    }

    // Find user by phone number
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('phone', phone)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid phone number or password.' });
    }

    // Verify password against stored bcrypt hash
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid phone number or password.' });
    }

    return res.status(200).json({
      message: 'Login successful',
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
        subscriptionPlan: user.subscription_plan,
        subscriptionAmount: user.subscription_amount,
        onboarding_completed: user.onboarding_completed
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal server error during login.' });
  }
};

// --- ONBOARDING PREFERENCES CONTROLLER ---
export const saveOnboardingPreferences = async (req, res) => {
  try {
    const { userId, experience, markets, timeframes } = req.body;

    const { data, error } = await supabase
      .from('users')
      .update({
        experience_level: experience,
        preferred_markets: markets,
        execution_style: timeframes,
        onboarding_completed: true,
        updated_at: new Date()
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({
      message: 'Onboarding preferences saved successfully',
      user: data
    });
  } catch (err) {
    console.error('Onboarding update error:', err);
    return res.status(500).json({ error: 'Failed to save onboarding preferences.' });
  }
};
import { supabase } from '../config/supabase.js';
import bcrypt from 'bcrypt';
import { signToken } from '../utils/token.js';
import { calculateTrialEndDate } from '../utils/dataHelper.js';

// Helper to generate a brand-aligned referral code starting with "HOBA-"
const generateReferralCode = (firstName) => {
  const cleanName = (firstName || 'TRADER').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  return `HOBA-${cleanName}${randomNum}`;
};

const generateClientId = async () => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const randomNum = Math.floor(100000 + Math.random() * 900000);
    const candidate = `HOBA-${randomNum}`;

    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('client_id', candidate)
      .single();

    if (!existing) return candidate;
  }
  throw new Error('Could not generate a unique client id, please retry.');
};

const buildUserResponse = (user) => ({
  id: user.id,
  firstName: user.first_name,
  lastName: user.last_name,
  email: user.email,
  phone: user.phone,
  telegramId: user.telegram_id,
  subscriptionPlan: user.subscription_plan,
  onboarding_completed: user.onboarding_completed,
  referralCode: user.referral_code
});

// --- 1. WEB REGISTRATION ---
export const registerUser = async (req, res) => {
  try {
    const { firstName, lastName, email, phone, password, refCode } = req.body;

    if (!firstName || !lastName || !email || !phone || !password) {
      return res.status(400).json({ error: 'All fields including email are required.' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    // Check if user already exists by phone or email
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .or(`phone.eq.${phone},email.eq.${email.toLowerCase()}`)
      .single();

    if (existingUser) {
      return res.status(400).json({ error: 'A user with this phone number or email already exists.' });
    }

    // Resolve referrer if refCode is provided
    let referredById = null;
    if (refCode) {
      const { data: referrer } = await supabase
        .from('users')
        .select('id')
        .eq('referral_code', refCode.trim().toUpperCase())
        .single();
      
      if (referrer) {
        referredById = referrer.id;
      }
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    const client_id = await generateClientId();
    const referral_code = generateReferralCode(firstName);

    const { data, error } = await supabase
      .from('users')
      .insert([
        {
          first_name: firstName,
          last_name: lastName,
          email: email.toLowerCase().trim(),
          phone: phone,
          password_hash: passwordHash,
          client_id: client_id,
          referral_code: referral_code,
          referred_by: referredById,
          subscription_status: 'Trialing',
          subscription_plan: 'Free Trial',
          subscription_amount: 0.00,
          onboarding_completed: false,
        }
      ])
      .select()
      .single();

    if (error) throw error;

    // Create companion subscription record with 7 business days trial
    const trialEndsAt = calculateTrialEndDate(7);
    const { error: subError } = await supabase
      .from('subscriptions')
      .insert([{
        user_id: data.id,
        status: 'trialing',
        plan_type: 'monthly',
        trial_ends_at: trialEndsAt.toISOString()
      }]);

    if (subError) console.error('Failed to create initial subscription record:', subError);

    return res.status(201).json({
      success: true,
      message: 'User registered successfully',
      user: buildUserResponse(data),
      token: signToken(data.id)
    });
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ error: 'Internal server error during registration.' });
  }
};

// --- 2. WEB LOGIN (Email or Phone + Password) ---
export const loginUser = async (req, res) => {
  try {
    const { loginIdentifier, password } = req.body; // Can be email or phone

    if (!loginIdentifier || !password) {
      return res.status(400).json({ error: 'Email/Phone and password are required.' });
    }

    const isEmail = loginIdentifier.includes('@');
    
    const query = supabase.from('users').select('*');
    if (isEmail) {
      query.eq('email', loginIdentifier.toLowerCase().trim());
    } else {
      query.eq('phone', loginIdentifier.trim());
    }

    const { data: user, error } = await query.single();

    if (error || !user || !user.password_hash) {
      return res.status(401).json({ error: 'Invalid credentials or user not found.' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials or user not found.' });
    }

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      user: buildUserResponse(user),
      token: signToken(user.id)
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal server error during login.' });
  }
};

// --- 3. TELEGRAM MINI APP SYNC ---
export const syncTelegramUser = async (req, res) => {
  try {
    const { id: telegram_id, username, first_name, last_name } = req.telegramUser;

    let { data: existingUser } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegram_id)
      .single();

    if (!existingUser) {
      const client_id = await generateClientId();
      const referral_code = generateReferralCode(first_name);

      const { data: newUser, error: insertError } = await supabase
        .from('users')
        .insert([{
          telegram_id,
          username,
          first_name,
          last_name,
          client_id,
          referral_code,
          subscription_status: 'Trialing',
          subscription_plan: 'Free Trial',
          onboarding_completed: false
        }])
        .select()
        .single();

      if (insertError) throw insertError;
      existingUser = newUser;

      const trialEndsAt = calculateTrialEndDate(7);
      await supabase
        .from('subscriptions')
        .insert([{
          user_id: existingUser.id,
          status: 'trialing',
          plan_type: 'monthly',
          trial_ends_at: trialEndsAt.toISOString()
        }]);
    }

    return res.status(200).json({
      success: true,
      message: 'Telegram user synced successfully',
      user: buildUserResponse(existingUser),
      token: signToken(existingUser.id)
    });
  } catch (err) {
    console.error('Telegram sync error:', err);
    return res.status(500).json({ error: 'Failed to sync Telegram user.' });
  }
};

// --- 4a. TELEGRAM LOGIN — INTERNAL ONLY ---
export const telegramLogin = async (req, res) => {
  try {
    const { telegram_id } = req.body;

    if (!telegram_id) {
      return res.status(400).json({ success: false, error: 'Telegram ID is required.' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegram_id)
      .single();

    if (error || !user) {
      return res.status(404).json({
        success: false,
        needsLinking: true,
        message: 'Telegram account not linked. Please sign in with your web credentials once to sync.'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Telegram authentication successful',
      user: buildUserResponse(user)
    });
  } catch (err) {
    console.error('Telegram login error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error during Telegram login.' });
  }
};

// --- 4b. TELEGRAM LOGIN — FROM THE MINI APP FRONTEND ---
export const telegramWebAppLogin = async (req, res) => {
  try {
    const telegram_id = req.telegramUser?.id;

    if (!telegram_id) {
      return res.status(401).json({ success: false, error: 'Unverified Telegram session.' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegram_id)
      .single();

    if (error || !user) {
      return res.status(404).json({
        success: false,
        needsLinking: true,
        message: 'Telegram account not linked. Please sign in with your web credentials once to sync.'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Telegram authentication successful',
      user: buildUserResponse(user),
      token: signToken(user.id)
    });
  } catch (err) {
    console.error('Telegram web app login error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error during Telegram login.' });
  }
};

// --- 5. LINK TELEGRAM ACCOUNT ---
export const linkTelegramAccount = async (req, res) => {
  try {
    const { telegram_id, loginIdentifier, password } = req.body;

    if (!telegram_id) {
      return res.status(400).json({ success: false, error: 'Telegram ID is required.' });
    }

    let user;

    if (req.userId) {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', req.userId)
        .single();

      if (error || !data) {
        return res.status(404).json({ success: false, error: 'Account not found for current session.' });
      }
      user = data;
    } else {
      if (!loginIdentifier || !password) {
        return res.status(400).json({
          success: false,
          error: 'Email/Phone and password are required to link Telegram without an active session.'
        });
      }

      const isEmail = loginIdentifier.includes('@');
      const query = supabase.from('users').select('*');
      if (isEmail) {
        query.eq('email', loginIdentifier.toLowerCase().trim());
      } else {
        query.eq('phone', loginIdentifier.trim());
      }

      const { data, error: fetchError } = await query.single();

      if (fetchError || !data) {
        return res.status(404).json({ success: false, error: 'No account found with this credential. Please register on the web first.' });
      }

      const isPasswordValid = await bcrypt.compare(password, data.password_hash);
      if (!isPasswordValid) {
        return res.status(401).json({ success: false, error: 'Invalid password.' });
      }
      user = data;
    }

    const { data: updatedUser, error: updateError } = await supabase
      .from('users')
      .update({
        telegram_id: telegram_id,
        username: username || user.username
      })
      .eq('id', user.id)
      .select()
      .single();

    if (updateError) throw updateError;

    return res.status(200).json({
      success: true,
      message: 'Telegram account successfully linked!',
      user: buildUserResponse(updatedUser),
      token: signToken(updatedUser.id)
    });
  } catch (err) {
    console.error('Telegram link error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error during account linking.' });
  }
};

// --- 6. ONBOARDING PREFERENCES ---
export const saveOnboardingPreferences = async (req, res) => {
  try {
    const { experience_level, preferred_markets, execution_style } = req.body;

    const { data, error } = await supabase
      .from('users')
      .update({
        experience_level,
        preferred_markets,
        execution_style,
        onboarding_completed: true
      })
      .eq('id', req.userId)
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({
      success: true,
      message: 'Onboarding completed successfully',
      user: buildUserResponse(data)
    });
  } catch (err) {
    console.error('Onboarding save error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};
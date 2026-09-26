import { supabase } from '../config/supabase.js';
import bcrypt from 'bcrypt';

const generateClientId = async () => {
  // Retry a few times on the rare chance of a collision, instead of letting
  // the insert fail with an opaque unique-constraint error.
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

// Shared lookup used by both the internal (bot) and web-app (verified) login paths,
// so the "what does a successful login response look like" logic lives in one place.
const buildUserResponse = (user) => ({
  id: user.id,
  firstName: user.first_name,
  lastName: user.last_name,
  phone: user.phone,
  telegramId: user.telegram_id,
  subscriptionPlan: user.subscription_plan,
  onboarding_completed: user.onboarding_completed
});

// --- 1. WEB REGISTRATION ---
export const registerUser = async (req, res) => {
  try {
    const { firstName, lastName, phone, password } = req.body;

    if (!firstName || !lastName || !phone || !password) {
      return res.status(400).json({ error: 'All fields are required.' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('phone', phone)
      .single();

    if (existingUser) {
      return res.status(400).json({ error: 'User with this phone number already exists.' });
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    const client_id = await generateClientId();

    const { data, error } = await supabase
      .from('users')
      .insert([
        {
          first_name: firstName,
          last_name: lastName,
          phone: phone,
          password_hash: passwordHash,
          client_id: client_id,
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
        onboarding_completed: data.onboarding_completed
      }
    });
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ error: 'Internal server error during registration.' });
  }
};

// --- 2. WEB LOGIN (Phone + Password) ---
export const loginUser = async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ error: 'Phone number and password are required.' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('phone', phone)
      .single();

    if (error || !user || !user.password_hash) {
      return res.status(401).json({ error: 'Invalid phone number or password.' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid phone number or password.' });
    }

    return res.status(200).json({
      message: 'Login successful',
      user: buildUserResponse(user)
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal server error during login.' });
  }
};

// --- 3. TELEGRAM MINI APP SYNC (verified via initData middleware) ---
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
      const { data: newUser, error: insertError } = await supabase
        .from('users')
        .insert([{
          telegram_id,
          username,
          first_name,
          last_name,
          client_id,
          subscription_status: 'Trialing',
          subscription_plan: 'Free Trial',
          onboarding_completed: false
        }])
        .select()
        .single();

      if (insertError) throw insertError;
      existingUser = newUser;
    }

    return res.status(200).json({
      success: true,
      message: 'Telegram user synced successfully',
      user: existingUser
    });
  } catch (err) {
    console.error('Telegram sync error:', err);
    return res.status(500).json({ error: 'Failed to sync Telegram user.' });
  }
};

// --- 4a. TELEGRAM LOGIN — INTERNAL ONLY ---
// Called by bot.js (server-to-server, protected by verifyInternalService).
// telegram_id here comes from the bot's own Telegraf context, which Telegram
// itself has already verified — never expose this route to public clients.
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
// Same result shape as telegramLogin, but the telegram_id is taken from
// req.telegramUser (populated by verifyTelegramWebAppData), never from the
// request body, so a client can't substitute someone else's id.
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
      user: buildUserResponse(user)
    });
  } catch (err) {
    console.error('Telegram web app login error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error during Telegram login.' });
  }
};

// --- 5. LINK TELEGRAM ACCOUNT ---
export const linkTelegramAccount = async (req, res) => {
  try {
    const { phone, password, telegram_id, username } = req.body;

    if (!phone || !password || !telegram_id) {
      return res.status(400).json({ success: false, error: 'Phone, password, and Telegram ID are required.' });
    }

    const { data: user, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('phone', phone)
      .single();

    if (fetchError || !user) {
      return res.status(404).json({ success: false, error: 'No account found with this phone number. Please register on the web first.' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({ success: false, error: 'Invalid password.' });
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
      user: buildUserResponse(updatedUser)
    });
  } catch (err) {
    console.error('Telegram link error:', err);
    return res.status(500).json({ success: false, error: 'Internal server error during account linking.' });
  }
};

// --- 6. ONBOARDING PREFERENCES ---
export const saveOnboardingPreferences = async (req, res) => {
  try {
    const { userId, experience_level, preferred_markets, execution_style } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID is required.' });
    }

    const { data, error } = await supabase
      .from('users')
      .update({
        experience_level,
        preferred_markets,
        execution_style,
        onboarding_completed: true
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({
      success: true,
      message: 'Onboarding completed successfully',
      user: data
    });
  } catch (err) {
    console.error('Onboarding save error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

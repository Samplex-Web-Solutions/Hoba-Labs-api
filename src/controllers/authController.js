import { supabase } from '../config/supabase.js';
import bcrypt from 'bcrypt';
import { signToken } from '../utils/token.js';
import { calculateTrialEndDate } from '../utils/dataHelper.js';

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

      // Create companion subscription record for Telegram user
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
      user: existingUser,
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
    const { telegram_id, username, phone, password } = req.body;

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
      if (!phone || !password) {
        return res.status(400).json({
          success: false,
          error: 'Phone and password are required to link Telegram without an active session.'
        });
      }

      const { data, error: fetchError } = await supabase
        .from('users')
        .select('*')
        .eq('phone', phone)
        .single();

      if (fetchError || !data) {
        return res.status(404).json({ success: false, error: 'No account found with this phone number. Please register on the web first.' });
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












// import { supabase } from '../config/supabase.js';
// import bcrypt from 'bcrypt';
// import { signToken } from '../utils/token.js';

// const generateClientId = async () => {
//   for (let attempt = 0; attempt < 5; attempt++) {
//     const randomNum = Math.floor(100000 + Math.random() * 900000);
//     const candidate = `HOBA-${randomNum}`;

//     const { data: existing } = await supabase
//       .from('users')
//       .select('id')
//       .eq('client_id', candidate)
//       .single();

//     if (!existing) return candidate;
//   }
//   throw new Error('Could not generate a unique client id, please retry.');
// };

// const buildUserResponse = (user) => ({
//   id: user.id,
//   firstName: user.first_name,
//   lastName: user.last_name,
//   phone: user.phone,
//   telegramId: user.telegram_id,
//   subscriptionPlan: user.subscription_plan,
//   onboarding_completed: user.onboarding_completed
// });

// // --- 1. WEB REGISTRATION ---
// export const registerUser = async (req, res) => {
//   try {
//     const { firstName, lastName, phone, password } = req.body;

//     if (!firstName || !lastName || !phone || !password) {
//       return res.status(400).json({ error: 'All fields are required.' });
//     }

//     if (password.length < 8) {
//       return res.status(400).json({ error: 'Password must be at least 8 characters.' });
//     }

//     const { data: existingUser } = await supabase
//       .from('users')
//       .select('id')
//       .eq('phone', phone)
//       .single();

//     if (existingUser) {
//       return res.status(400).json({ error: 'User with this phone number already exists.' });
//     }

//     const saltRounds = 10;
//     const passwordHash = await bcrypt.hash(password, saltRounds);
//     const client_id = await generateClientId();

//     const { data, error } = await supabase
//       .from('users')
//       .insert([
//         {
//           first_name: firstName,
//           last_name: lastName,
//           phone: phone,
//           password_hash: passwordHash,
//           client_id: client_id,
//           subscription_status: 'Trialing',
//           subscription_plan: 'Free Trial',
//           subscription_amount: 0.00,
//           onboarding_completed: false,
//         }
//       ])
//       .select()
//       .single();

//     if (error) throw error;

//     return res.status(201).json({
//       success: true,
//       message: 'User registered successfully',
//       user: buildUserResponse(data),
//       token: signToken(data.id)
//     });
//   } catch (err) {
//     console.error('Registration error:', err);
//     return res.status(500).json({ error: 'Internal server error during registration.' });
//   }
// };

// // --- 2. WEB LOGIN (Phone + Password) ---
// export const loginUser = async (req, res) => {
//   try {
//     const { phone, password } = req.body;

//     if (!phone || !password) {
//       return res.status(400).json({ error: 'Phone number and password are required.' });
//     }

//     const { data: user, error } = await supabase
//       .from('users')
//       .select('*')
//       .eq('phone', phone)
//       .single();

//     if (error || !user || !user.password_hash) {
//       return res.status(401).json({ error: 'Invalid phone number or password.' });
//     }

//     const isPasswordValid = await bcrypt.compare(password, user.password_hash);
//     if (!isPasswordValid) {
//       return res.status(401).json({ error: 'Invalid phone number or password.' });
//     }

//     return res.status(200).json({
//       success: true,
//       message: 'Login successful',
//       user: buildUserResponse(user),
//       token: signToken(user.id)
//     });
//   } catch (err) {
//     console.error('Login error:', err);
//     return res.status(500).json({ error: 'Internal server error during login.' });
//   }
// };

// // --- 3. TELEGRAM MINI APP SYNC (verified via initData middleware) ---
// export const syncTelegramUser = async (req, res) => {
//   try {
//     const { id: telegram_id, username, first_name, last_name } = req.telegramUser;

//     let { data: existingUser } = await supabase
//       .from('users')
//       .select('*')
//       .eq('telegram_id', telegram_id)
//       .single();

//     if (!existingUser) {
//       const client_id = await generateClientId();
//       const { data: newUser, error: insertError } = await supabase
//         .from('users')
//         .insert([{
//           telegram_id,
//           username,
//           first_name,
//           last_name,
//           client_id,
//           subscription_status: 'Trialing',
//           subscription_plan: 'Free Trial',
//           onboarding_completed: false
//         }])
//         .select()
//         .single();

//       if (insertError) throw insertError;
//       existingUser = newUser;
//     }

//     return res.status(200).json({
//       success: true,
//       message: 'Telegram user synced successfully',
//       user: existingUser,
//       token: signToken(existingUser.id)
//     });
//   } catch (err) {
//     console.error('Telegram sync error:', err);
//     return res.status(500).json({ error: 'Failed to sync Telegram user.' });
//   }
// };

// // --- 4a. TELEGRAM LOGIN — INTERNAL ONLY (called by bot.js, not public clients) ---
// export const telegramLogin = async (req, res) => {
//   try {
//     const { telegram_id } = req.body;

//     if (!telegram_id) {
//       return res.status(400).json({ success: false, error: 'Telegram ID is required.' });
//     }

//     const { data: user, error } = await supabase
//       .from('users')
//       .select('*')
//       .eq('telegram_id', telegram_id)
//       .single();

//     if (error || !user) {
//       return res.status(404).json({
//         success: false,
//         needsLinking: true,
//         message: 'Telegram account not linked. Please sign in with your web credentials once to sync.'
//       });
//     }

//     return res.status(200).json({
//       success: true,
//       message: 'Telegram authentication successful',
//       user: buildUserResponse(user)
//     });
//   } catch (err) {
//     console.error('Telegram login error:', err);
//     return res.status(500).json({ success: false, error: 'Internal server error during Telegram login.' });
//   }
// };

// // --- 4b. TELEGRAM LOGIN — FROM THE MINI APP FRONTEND (verified via initData) ---
// export const telegramWebAppLogin = async (req, res) => {
//   try {
//     const telegram_id = req.telegramUser?.id;

//     if (!telegram_id) {
//       return res.status(401).json({ success: false, error: 'Unverified Telegram session.' });
//     }

//     const { data: user, error } = await supabase
//       .from('users')
//       .select('*')
//       .eq('telegram_id', telegram_id)
//       .single();

//     if (error || !user) {
//       return res.status(404).json({
//         success: false,
//         needsLinking: true,
//         message: 'Telegram account not linked. Please sign in with your web credentials once to sync.'
//       });
//     }

//     return res.status(200).json({
//       success: true,
//       message: 'Telegram authentication successful',
//       user: buildUserResponse(user),
//       token: signToken(user.id)
//     });
//   } catch (err) {
//     console.error('Telegram web app login error:', err);
//     return res.status(500).json({ success: false, error: 'Internal server error during Telegram login.' });
//   }
// };

// // --- 5. LINK TELEGRAM ACCOUNT ---
// // Two ways to reach this route:
// //  a) Already logged in (attachUserIfPresent found a valid JWT) — just needs telegram_id.
// //  b) Not logged in — must prove identity with phone + password, same as before.
// export const linkTelegramAccount = async (req, res) => {
//   try {
//     const { telegram_id, username, phone, password } = req.body;

//     if (!telegram_id) {
//       return res.status(400).json({ success: false, error: 'Telegram ID is required.' });
//     }

//     let user;

//     if (req.userId) {
//       // Path (a): trust the verified session, not anything the client claims.
//       const { data, error } = await supabase
//         .from('users')
//         .select('*')
//         .eq('id', req.userId)
//         .single();

//       if (error || !data) {
//         return res.status(404).json({ success: false, error: 'Account not found for current session.' });
//       }
//       user = data;
//     } else {
//       // Path (b): no session — verify identity the old-fashioned way.
//       if (!phone || !password) {
//         return res.status(400).json({
//           success: false,
//           error: 'Phone and password are required to link Telegram without an active session.'
//         });
//       }

//       const { data, error: fetchError } = await supabase
//         .from('users')
//         .select('*')
//         .eq('phone', phone)
//         .single();

//       if (fetchError || !data) {
//         return res.status(404).json({ success: false, error: 'No account found with this phone number. Please register on the web first.' });
//       }

//       const isPasswordValid = await bcrypt.compare(password, data.password_hash);
//       if (!isPasswordValid) {
//         return res.status(401).json({ success: false, error: 'Invalid password.' });
//       }
//       user = data;
//     }

//     const { data: updatedUser, error: updateError } = await supabase
//       .from('users')
//       .update({
//         telegram_id: telegram_id,
//         username: username || user.username
//       })
//       .eq('id', user.id)
//       .select()
//       .single();

//     if (updateError) throw updateError;

//     return res.status(200).json({
//       success: true,
//       message: 'Telegram account successfully linked!',
//       user: buildUserResponse(updatedUser),
//       token: signToken(updatedUser.id)
//     });
//   } catch (err) {
//     console.error('Telegram link error:', err);
//     return res.status(500).json({ success: false, error: 'Internal server error during account linking.' });
//   }
// };

// // --- 6. ONBOARDING PREFERENCES ---
// // userId now comes from the verified JWT (req.userId), never the request body.
// export const saveOnboardingPreferences = async (req, res) => {
//   try {
//     const { experience_level, preferred_markets, execution_style } = req.body;

//     const { data, error } = await supabase
//       .from('users')
//       .update({
//         experience_level,
//         preferred_markets,
//         execution_style,
//         onboarding_completed: true
//       })
//       .eq('id', req.userId)
//       .select()
//       .single();

//     if (error) throw error;

//     return res.status(200).json({
//       success: true,
//       message: 'Onboarding completed successfully',
//       user: buildUserResponse(data)
//     });
//   } catch (err) {
//     console.error('Onboarding save error:', err);
//     return res.status(500).json({ success: false, error: err.message });
//   }
// };

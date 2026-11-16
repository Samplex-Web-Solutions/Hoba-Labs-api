import { supabase } from '../config/supabase.js';
import { generateLicenseKey } from '../utils/KeyGenerator.js';
import { sendLicenseEmail } from '../services/email/emailService.js';

// Admin manually issues key to user
export async function adminIssueKey(req, res) {
  try {
    const { userId, daysValid } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const expiry = new Date();
    expiry.setDate(expiry.getDate() + (daysValid || 30));

    const newKey = generateLicenseKey();

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('email, first_name')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { error: keyError } = await supabase.from('license_keys').insert({
      user_id: userId,
      key_code: newKey,
      status: 'ACTIVE',
      expires_at: expiry.toISOString()
    });

    if (keyError) {
      console.error('[ADMIN_ERROR] Failed to insert key:', keyError.message);
      return res.status(500).json({ error: 'Failed to generate license key' });
    }

    await supabase.from('users').update({ ea_access: true }).eq('id', userId);

    if (user.email) {
      try {
        await sendLicenseEmail(user.email, user.first_name, newKey, expiry);
      } catch (emailErr) {
        console.error('[ADMIN_EMAIL_ERROR] Failed to send email:', emailErr.message);
      }
    }

    return res.json({ success: true, key: newKey, expires_at: expiry.toISOString() });
  } catch (err) {
    console.error('[ADMIN_CRITICAL_ERROR]', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// Admin toggle EA access ON/OFF
export async function adminToggleEAAccess(req, res) {
  try {
    const { userId, eaAccess } = req.body;

    if (!userId || typeof eaAccess !== 'boolean') {
      return res.status(400).json({ error: 'userId and boolean eaAccess are required' });
    }

    const { error } = await supabase
      .from('users')
      .update({ ea_access: eaAccess })
      .eq('id', userId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!eaAccess) {
      // Also disconnect broker execution if access is disabled
      await supabase
        .from('broker_accounts')
        .update({ connection_status: 'DISCONNECTED' })
        .eq('user_id', userId);
    }

    return res.json({ success: true, userId, ea_access: eaAccess });
  } catch (err) {
    console.error('[ADMIN_CRITICAL_ERROR]', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
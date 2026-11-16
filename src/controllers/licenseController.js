// src/controllers/licenseController.js
import { supabase } from '../config/supabase.js';

export async function redeemEALicense(req, res) {
  try {
    const { key_code } = req.body;
    const userId = req.userId; // from verifyJWT middleware

    if (!key_code) {
      return res.status(400).json({ success: false, message: 'License key is required.' });
    }

    const trimmedKey = key_code.trim().toUpperCase();

    // 1. Fetch key from database
    const { data: keyData, error: keyError } = await supabase
      .from('license_keys')
      .select('*')
      .eq('key_code', trimmedKey)
      .single();

    if (keyError || !keyData) {
      return res.status(404).json({ success: false, message: 'Invalid license key.' });
    }

    // 2. Enforce 1-to-1 binding check
    if (keyData.status === 'USED' || (keyData.user_id && keyData.user_id !== userId)) {
      return res.status(403).json({ 
        success: false, 
        message: 'This license key has already been redeemed by another account.' 
      });
    }

    if (keyData.status === 'EXPIRED' || new Date(keyData.expires_at) < new Date()) {
      return res.status(400).json({ success: false, message: 'This license key has expired.' });
    }

    // 3. Bind key strictly to this user and mark as USED
    const { error: updateKeyError } = await supabase
      .from('license_keys')
      .update({
        user_id: userId,
        status: 'USED'
      })
      .eq('id', keyData.id);

    if (updateKeyError) throw updateKeyError;

    // 4. Enable EA Access for the user
    const { error: updateUserError } = await supabase
      .from('users')
      .update({ ea_access: true })
      .eq('id', userId);

    if (updateUserError) throw updateUserError;

    return res.status(200).json({
      success: true,
      message: 'License key redeemed successfully! You can now connect your broker account.',
      expires_at: keyData.expires_at
    });

  } catch (err) {
    console.error('[LICENSE_REDEEM_ERROR]:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to redeem license key.' });
  }
}
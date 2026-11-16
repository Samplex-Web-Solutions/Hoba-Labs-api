// src/controllers/brokerController.js
import { supabase } from '../config/supabase.js';
import { provisionUserMetaApiAccount, linkSubscriberAccount } from '../services/metaApi/metaApi.js';
/**
 * GET /api/broker/ea-stats
 * Fetches user EA access status and real-time/cached broker account stats (Balance, Equity, Floating PnL)
 */
export async function getEADashboardStats(req, res) {
  try {
    const userId = req.userId; // Provided by verifyJWT middleware

    // 1. Check user EA access flag
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('ea_access')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (!user.ea_access) {
      return res.status(200).json({
        success: true,
        hasEaAccess: false,
        account: null,
        stats: {
          balance: 0.00,
          equity: 0.00,
          floating_pnl: 0.00,
          connection_status: 'DISCONNECTED'
        }
      });
    }

    // 2. Fetch linked broker account details from broker_accounts table
    const { data: account, error: accountError } = await supabase
      .from('broker_accounts')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (accountError || !account) {
      return res.status(200).json({
        success: true,
        hasEaAccess: true,
        account: null,
        stats: {
          balance: 0.00,
          equity: 0.00,
          floating_pnl: 0.00,
          connection_status: 'DISCONNECTED'
        }
      });
    }

    return res.status(200).json({
      success: true,
      hasEaAccess: true,
      account,
      stats: {
        balance: Number(account.balance || 0),
        equity: Number(account.equity || 0),
        floating_pnl: Number(account.floating_pnl || 0),
        connection_status: account.connection_status || 'DISCONNECTED'
      }
    });

  } catch (err) {
    console.error('[EA_STATS_ERROR]:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch EA dashboard stats.' });
  }
}

/**
 * POST /api/broker/connect
 * Provisions MetaApi container and links it to the user's broker_accounts table
 */
export async function connectBrokerAccount(req, res) {
  try {
    const userId = req.userId;
    const { login, password, server } = req.body;

    if (!login || !password || !server) {
      return res.status(400).json({ success: false, error: 'Missing required broker credentials (login, password, server).' });
    }

    // Fetch user email for MetaApi account naming
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('email, client_id')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ success: false, error: 'User profile not found.' });
    }

    console.log(`[CONNECT]: Provisioning MetaApi account for user ${user.email}...`);

    // 1. Provision account container on MetaApi
    const metaApiAccountId = await provisionUserMetaApiAccount(user.email, login, password, server);

    // 2. Save or update broker account record in database
    const { data: existingAccount } = await supabase
      .from('broker_accounts')
      .select('id')
      .eq('user_id', userId)
      .single();

    const brokerPayload = {
      user_id: userId,
      broker_name: server.split('-')[0] || 'MetaTrader5',
      server_name: server,
      account_login: String(login),
      encrypted_password: password, // Note: ensure encryption matches your setup or store securely
      metaapi_account_id: metaApiAccountId,
      connection_status: 'CONNECTED',
      updated_at: new Date().toISOString()
    };

    if (existingAccount) {
      await supabase
        .from('broker_accounts')
        .update(brokerPayload)
        .eq('user_id', userId);
    } else {
      await supabase
        .from('broker_accounts')
        .insert([brokerPayload]);
    }

    // Also sync to active user_broker_accounts table if your broadcast worker relies on it
    await supabase
      .from('user_broker_accounts')
      .upsert({
        user_id: userId,
        broker_account_id: metaApiAccountId,
        is_active: true
      }, { onConflict: 'user_id' });

    console.log(`[CONNECT]: Successfully linked account ${metaApiAccountId} to user ${userId}`);

    return res.status(200).json({
      success: true,
      message: 'Broker account successfully connected and provisioned!',
      metaApiAccountId
    });

  } catch (error) {
    console.error('[CONNECT_ERROR]:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to provision broker account.'
    });
  }
}
// src/controllers/brokerController.js
import { supabase } from '../config/supabase.js';
import axios from 'axios';

const TICKERALL_BASE_URL = 'https://api.tickerall.com';

/**
 * GET /api/broker/ea-stats
 * Fetches user EA access status and broker account stats
 */
export async function getEADashboardStats(req, res) {
  try {
    const userId = req.userId;

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
 * Establishes a TickerAll broker session and links it to the user's account
 */
export async function connectBrokerAccount(req, res) {
  try {
    const userId = req.userId;
    const { login, password, server, broker = 'mt5' } = req.body;

    if (!login || !password || !server) {
      return res.status(400).json({ success: false, error: 'Missing required broker credentials (login, password, server).' });
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('email, client_id')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ success: false, error: 'User profile not found.' });
    }

    console.log(`[CONNECT]: Establishing TickerAll session for user ${user.email}...`);

    // Call TickerAll API to start session
    const response = await axios.post(
      `${TICKERALL_BASE_URL}/v1/sessions`,
      {
        broker: broker.toLowerCase(),
        server: server,
        account: Number(login),
        password: password,
        terminalType: 'MOBILE'
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.TICKERALL_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    const sessionData = response.data;
    const tickerallAccountId = sessionData.accountId || sessionData.id;

    if (!tickerallAccountId) {
      throw new Error('TickerAll did not return a valid account ID.');
    }

    // Save or update broker account record in database
    const { data: existingAccount } = await supabase
      .from('broker_accounts')
      .select('id')
      .eq('user_id', userId)
      .single();

    const brokerPayload = {
      user_id: userId,
      broker_name: server.split('-')[0] || 'MetaTrader',
      server_name: server,
      account_login: String(login),
      encrypted_password: password,
      tickerall_account_id: tickerallAccountId,
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

    // Sync to user_broker_accounts table for broadcast mapping
    await supabase
      .from('user_broker_accounts')
      .upsert({
        user_id: userId,
        broker_account_id: tickerallAccountId,
        is_active: true
      }, { onConflict: 'user_id' });

    console.log(`[CONNECT]: Successfully linked TickerAll account ${tickerallAccountId} to user ${userId}`);

    return res.status(200).json({
      success: true,
      message: 'Broker account successfully connected via TickerAll!',
      tickerallAccountId
    });

  } catch (error) {
    console.error('[TICKERALL_CONNECT_ERROR]:', error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      error: error.response?.data?.message || error.message || 'Failed to connect broker account.'
    });
  }
}

export async function searchBrokerServers(req, res) {
  try {
    const { query, platform } = req.query;

    if (!query || query.trim().length < 2) {
      return res.status(200).json({ success: true, servers: [] });
    }

    const searchTerm = query.trim();

    // Query Supabase for matching company names or exact server strings
    let dbQuery = supabase
      .from('broker_servers')
      .select('company_name, server_name, platform, type')
      .or(`company_name.ilike.%${searchTerm}%,server_name.ilike.%${searchTerm}%`)
      .order('type', { ascending: true }) // Put prop firms / main servers first
      .limit(15);

    if (platform) {
      dbQuery = dbQuery.eq('platform', platform.toLowerCase());
    }

    const { data: servers, error } = await dbQuery;

    if (error) throw error;

    return res.status(200).json({
      success: true,
      query: searchTerm,
      servers: servers || []
    });
  } catch (err) {
    console.error('[BROKER_SERVER_SEARCH_ERROR]:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to search broker servers' });
  }
}
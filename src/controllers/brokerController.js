// src/controllers/brokerController.js
import { supabase } from '../config/supabase.js';
import axios from 'axios';
import { 
  getTickerAllAccountInformation, 
  getTickerAllOpenPositions 
} from '../services/tickerallService.js';

const TICKERALL_BASE_URL = 'https://api.tickerall.com';

export async function getEADashboardStats(req, res) {
  try {
    const userId = req.userId;

    // 1. Fetch user data to check EA access status
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('ea_access')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const hasEaAccess = user.ea_access || false;

    // If EA access is locked or disabled, return default response
    if (!hasEaAccess) {
      return res.status(200).json({
        success: true,
        hasEaAccess: false,
        stats: { balance: 0, equity: 0, floating_pnl: 0, connection_status: 'LOCKED' },
        account: null,
        activePositions: []
      });
    }

    // 2. Fetch user's connected broker account record
    const { data: account, error: accError } = await supabase
      .from('broker_accounts')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (accError || !account) {
      return res.status(200).json({
        success: true,
        hasEaAccess: true,
        stats: { balance: 0, equity: 0, floating_pnl: 0, connection_status: 'DISCONNECTED' },
        account: null,
        activePositions: []
      });
    }

    // 3. Query live metrics from TickerAll using stored tickerall_account_id
    let liveMetrics = { balance: 0, equity: 0, profit: 0 };
    let activePositions = [];

    if (account.tickerall_account_id) {
      try {
        const [accountInfo, positions] = await Promise.all([
          getTickerAllAccountInformation(account.tickerall_account_id),
          getTickerAllOpenPositions(account.tickerall_account_id)
        ]);

        if (accountInfo) {
          liveMetrics = accountInfo;
        }
        if (positions) {
          activePositions = positions;
        }
      } catch (tickerErr) {
        console.warn('[TICKERALL_SYNC_WARN]: Live sync failed, fallback to zero metrics');
      }
    }

    return res.status(200).json({
      success: true,
      hasEaAccess: true,
      stats: {
        balance: liveMetrics.balance || 0,
        equity: liveMetrics.equity || 0,
        floating_pnl: liveMetrics.profit || liveMetrics.floating_pnl || 0,
        connection_status: account.connection_status || 'CONNECTED',
      },
      account: {
        account_login: account.account_login,
        server_name: account.server_name,
        broker_type: 'mt5'
      },
      activePositions
    });

  } catch (err) {
    console.error('[EA_STATS_ERROR]:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch EA stats' });
  }
}

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

    let dbQuery = supabase
      .from('broker_servers')
      .select('company_name, server_name, platform, type')
      .or(`company_name.ilike.%${searchTerm}%,server_name.ilike.%${searchTerm}%`)
      .order('type', { ascending: true })
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
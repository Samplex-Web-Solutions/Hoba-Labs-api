// src/services/tickerallService.js
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import crypto from 'crypto';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    realtime: {
      transport: ws,
    },
  }
);

const TICKERALL_BASE_URL = 'https://api.tickerall.com';

const apiClient = axios.create({
  baseURL: TICKERALL_BASE_URL,
  headers: {
    'Authorization': `Bearer ${process.env.TICKERALL_API_KEY}`,
    'Content-Type': 'application/json'
  },
  timeout: 30000
});

/**
 * Connect/Provision a broker account session on TickerAll
 */
export async function startBrokerSession({ broker, server, account, password }) {
  try {
    const response = await apiClient.post('/v1/sessions', {
      broker: broker || 'mt5', // 'mt4' or 'mt5'
      server: server,
      account: Number(account),
      password: password,
      terminalType: 'MOBILE'
    });

    const accountId = response.data.accountId || response.data.id;
    console.log(`[TICKERALL_SESSION]: Successfully established session. ID: ${accountId}`);
    return accountId;
  } catch (error) {
    console.error('[TICKERALL_SESSION_ERROR]:', error.response?.data || error.message);
    throw new Error(error.response?.data?.message || 'Failed to establish TickerAll broker session.');
  }
}

/**
 * Execute an order on a TickerAll account with idempotency protection
 */
export async function executeTickerAllOrder(accountId, orderDetails) {
  const idempotencyKey = crypto.randomUUID();

  try {
    const response = await apiClient.post(`/v1/accounts/${accountId}/orders`, {
      symbol: orderDetails.symbol,
      type: orderDetails.type,
      volume: orderDetails.volume,
      price: orderDetails.price ? Number(orderDetails.price) : undefined,
      stopLoss: orderDetails.stopLoss ? Number(orderDetails.stopLoss) : undefined,
      takeProfit: orderDetails.takeProfit ? Number(orderDetails.takeProfit) : undefined
    }, {
      headers: {
        'Idempotency-Key': idempotencyKey
      }
    });

    return {
      success: true,
      order: response.data
    };
  } catch (error) {
    console.error('[TICKERALL_ORDER_ERROR]:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.message || error.message
    };
  }
}

/**
 * Link or upsert subscriber account mapping in Supabase
 */
export async function linkSubscriberAccount(userId, brokerAccountId) {
  const { error } = await supabase
    .from('user_broker_accounts')
    .upsert({
      user_id: userId,
      broker_account_id: brokerAccountId,
      is_active: true,
      updated_at: new Date().toISOString()
    }, { onConflict: ['user_id'] });

  if (error) {
    throw new Error(`Supabase linking failed: ${error.message}`);
  }
}
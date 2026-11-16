// src/controllers/tradeController.js
import { supabase } from '../config/supabase.js';
import axios from 'axios';
import crypto from 'crypto';
import { fetchTodayCalendar } from '../services/news/newsService.js'; 

const TICKERALL_BASE_URL = 'https://api.tickerall.com';

/**
 * High-Impact USD News Filter using calendar data
 */
async function isNewsBlocked() {
  try {
    const events = await fetchTodayCalendar('high');
    const now = new Date();
    const BUFFER_MINUTES = 30;

    for (const event of events) {
      if (event.currency && event.currency.toUpperCase() === 'USD') {
        const eventTime = new Date(event.date || event.time);
        const diffMinutes = (now.getTime() - eventTime.getTime()) / (1000 * 60);

        if (diffMinutes >= -BUFFER_MINUTES && diffMinutes <= BUFFER_MINUTES) {
          console.log(`[NEWS_FILTER]: Trade blocked due to high-impact USD news: ${event.title || 'Economic Event'} at ${eventTime.toISOString()}`);
          return true;
        }
      }
    }
    return false;
  } catch (err) {
    console.error('[NEWS_FILTER_CHECK_ERROR]:', err.message);
    return false; // Fail open with warning if API hiccups
  }
}

/**
 * Helper to process and execute trade via TickerAll for an individual active subscriber
 */
async function executeTradeForSubscriber(subscriber, signalData) {
  const { userId, tickerallAccountId } = subscriber;
  const { symbol, tickerAllActionType, cleanType, entryPrice, stopLossPrice, takeProfitPrice } = signalData;

  const idempotencyKey = crypto.randomUUID();

  try {
    // 1. Strict Validation: Check User EA Access & Active Subscription
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('ea_access')
      .eq('id', userId)
      .single();

    if (userError || !user || !user.ea_access) {
      console.warn(`[SUBSCRIBER_SKIP]: EA access disabled or user not found for ID: ${userId}`);
      return { userId, success: false, reason: 'EA access disabled' };
    }

    const { data: sub, error: subError } = await supabase
      .from('subscriptions')
      .select('status, plan_type')
      .eq('user_id', userId)
      .single();

    if (subError || !sub || sub.status !== 'active') {
      console.warn(`[SUBSCRIBER_SKIP]: Inactive subscription status for user: ${userId}`);
      return { userId, success: false, reason: 'Inactive subscription' };
    }

    const isEaPlan = sub.plan_type.includes('ea') || sub.plan_type.includes('bundle');
    if (!isEaPlan) {
      console.warn(`[SUBSCRIBER_SKIP]: Plan does not include EA execution for user: ${userId}`);
      return { userId, success: false, reason: 'Non-EA subscription plan' };
    }

    console.log(`[TRADE_DISPATCH]: Placing ${tickerAllActionType} on ${symbol} for TickerAll account ${tickerallAccountId} (User: ${userId})`);

    // 2. Execute Order via TickerAll REST API
    const response = await axios.post(
      `${TICKERALL_BASE_URL}/v1/accounts/${tickerallAccountId}/orders`,
      {
        symbol: symbol,
        type: tickerAllActionType,
        volume: 0.10, // Adjust dynamic lot calculation if needed
        price: Number(entryPrice),
        stopLoss: Number(stopLossPrice),
        takeProfit: takeProfitPrice ? Number(takeProfitPrice) : undefined
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.TICKERALL_API_KEY}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey
        },
        timeout: 15000
      }
    );

    const orderResult = response.data;
    const orderId = orderResult.orderId || orderResult.id || idempotencyKey;

    // 3. Log Trade Success to Supabase
    await supabase.from('trade_logs').insert({
      user_id: userId,
      broker_account_id: tickerallAccountId,
      symbol,
      order_type: cleanType,
      lot_size: 0.10,
      entry_price: Number(entryPrice),
      stop_loss: Number(stopLossPrice),
      take_profit: takeProfitPrice ? Number(takeProfitPrice) : 0,
      status: 'PENDING',
      metaapi_order_id: String(orderId)
    });

    return { userId, success: true, orderId };

  } catch (err) {
    const errorMsg = err.response?.data?.message || err.message;
    console.error(`[SUBSCRIBER_EXECUTION_ERROR] for user ${userId}:`, errorMsg);
    
    // Log failure state
    await supabase.from('trade_logs').insert({
      user_id: userId,
      symbol,
      order_type: cleanType,
      lot_size: 0,
      status: 'FAILED',
      error_message: errorMsg
    });

    return { userId, success: false, error: errorMsg };
  }
}

/**
 * POST /api/trades/broadcast
 * Receives Local PC EA signals, validates admin secret, checks news, and fans out execution to active subscribers only.
 */
export async function handleMasterBroadcast(req, res) {
  try {
    const { adminSecret, symbol = 'XAUUSD', orderType, entryPrice, stopLossPrice, takeProfitPrice } = req.body;

    // 1. Authenticate the Master EA broadcast request
    if (!adminSecret || adminSecret !== process.env.ADMIN_SECRET_KEY) {
      console.warn("[SECURITY]: Unauthorized broadcast attempt detected with invalid key.");
      return res.status(401).json({ error: 'Unauthorized broadcast: Invalid or missing admin secret key.' });
    }

    if (!orderType || !entryPrice || !stopLossPrice) {
      return res.status(400).json({ error: 'Missing required parameters: orderType, entryPrice, stopLossPrice' });
    }

    // 2. Enforce High-Impact News Filter globally
    const newsBlocked = await isNewsBlocked();
    if (newsBlocked) {
      console.log(`[BROADCAST_BLOCKED]: High-impact USD news buffer active.`);
      return res.status(423).json({ 
        success: false, 
        error: 'Master broadcast blocked: High-impact USD news buffer active (30m pre/post).' 
      });
    }

    // 3. Map Order Type for TickerAll format
    let tickerAllActionType;
    const cleanType = orderType.toUpperCase();
    if (cleanType === 'BUY_LIMIT') tickerAllActionType = 'BUY_LIMIT';
    else if (cleanType === 'SELL_LIMIT') tickerAllActionType = 'SELL_LIMIT';
    else if (cleanType === 'BUY_STOP') tickerAllActionType = 'BUY_STOP';
    else if (cleanType === 'SELL_STOP') tickerAllActionType = 'SELL_STOP';
    else {
      return res.status(400).json({ error: 'Invalid orderType. Must be BUY_LIMIT, SELL_LIMIT, BUY_STOP, or SELL_STOP.' });
    }

    // 4. Fetch all active connected broker accounts from Supabase
    const { data: subscribers, error: subError } = await supabase
      .from('user_broker_accounts')
      .select('user_id, broker_account_id')
      .eq('is_active', true);

    if (subError) {
      console.error('[SUPABASE_FETCH_ERROR]: Failed to fetch active subscribers:', subError.message);
      return res.status(500).json({ error: 'Database error fetching active subscribers.' });
    }

    if (!subscribers || subscribers.length === 0) {
      return res.status(200).json({ 
        success: true, 
        message: 'Master signal received, but no active subscriber broker accounts found.' 
      });
    }

    console.log(`[BROADCAST_FANOUT]: Dispatches incoming signal to ${subscribers.length} connected subscriber accounts...`);

    const formattedSubscribers = subscribers.map(sub => ({
      userId: sub.user_id,
      tickerallAccountId: sub.broker_account_id
    }));

    const signalData = {
      symbol,
      tickerAllActionType,
      cleanType,
      entryPrice,
      stopLossPrice,
      takeProfitPrice
    };

    // 5. Fan out trade execution asynchronously across all eligible subscribers
    const executionPromises = formattedSubscribers.map(sub => executeTradeForSubscriber(sub, signalData));
    
    Promise.all(executionPromises).then(results => {
      const successes = results.filter(r => r.success).length;
      console.log(`[BROADCAST_COMPLETE]: Successfully executed trade for ${successes}/${results.length} subscribers.`);
    });

    return res.status(200).json({
      success: true,
      message: `Master broadcast received and fanned out to ${subscribers.length} accounts.`,
      activeSubscribersCount: subscribers.length
    });

  } catch (err) {
    console.error('[MASTER_BROADCAST_ERROR]:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to process master broadcast signal.' });
  }
}
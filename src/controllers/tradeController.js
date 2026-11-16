import { supabase } from '../config/supabase.js';
import { getConnectedMetaApiAccount } from '../services/metaApi/metaapiService.js';
import { calculateLotSize } from '../utils/lotSizeCalculator.js';
import { fetchTodayCalendar } from '../services/news/newsService.js'; 

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
 * Helper to process and execute trade for an individual user/subscriber instance
 */
async function executeTradeForSubscriber(subscriber, signalData) {
  const { userId, brokerAccountId } = subscriber;
  const { symbol, metaApiActionType, cleanType, entryPrice, stopLossPrice, takeProfitPrice, stopLossPips } = signalData;

  try {
    // 1. Check User EA Access & Risk Configuration from database
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('ea_access, risk_percentage')
      .eq('id', userId)
      .single();

    if (userError || !user || !user.ea_access) {
      console.warn(`[SUBSCRIBER_SKIP]: EA access disabled or user not found for ID: ${userId}`);
      return { userId, success: false, reason: 'EA access disabled' };
    }

    // 2. Connect to MetaApi Cloud Instance & Get Broker Account Info
    const { connection, brokerAcc } = await getConnectedMetaApiAccount(userId);
    const accountInfo = await connection.getAccountInformation();
    const currentEquity = accountInfo.equity;

    // 3. Calculate Dynamic Lot Size based on subscriber's account equity and risk profile
    const riskPercentage = user.risk_percentage || 1.00;
    const lotSize = calculateLotSize(currentEquity, riskPercentage, stopLossPips, symbol);
    
    console.log(`[TRADE_DISPATCH]: Placing ${metaApiActionType} of ${lotSize} lots on ${symbol} at entry ${entryPrice} for user ${userId}`);

    // 4. Execute Pending Limit Order on MetaApi
    const result = await connection.createOrder(
      symbol,
      metaApiActionType,
      lotSize,
      Number(entryPrice),
      Number(stopLossPrice),
      takeProfitPrice ? Number(takeProfitPrice) : null,
      {
        comment: 'Hoba Labs Master Broadcast EA',
        clientId: `hoba_${Date.now()}_${userId.substring(0, 6)}`
      }
    );

    // 5. Log Trade Success to Supabase
    await supabase.from('trade_logs').insert({
      user_id: userId,
      broker_account_id: brokerAcc.id || brokerAccountId,
      symbol,
      order_type: cleanType,
      lot_size: lotSize,
      entry_price: Number(entryPrice),
      stop_loss: Number(stopLossPrice),
      take_profit: takeProfitPrice ? Number(takeProfitPrice) : 0,
      status: 'PENDING',
      metaapi_order_id: result.orderId || result.stringCode
    });

    return { userId, success: true, orderId: result.orderId || result.stringCode };

  } catch (err) {
    console.error(`[SUBSCRIBER_EXECUTION_ERROR] for user ${userId}:`, err.message);
    
    // Log failure state
    await supabase.from('trade_logs').insert({
      user_id: userId,
      symbol,
      order_type: cleanType,
      lot_size: 0,
      status: 'FAILED',
      error_message: err.message
    });

    return { userId, success: false, error: err.message };
  }
}

/**
 * POST /api/trades/broadcast
 * Receives Master EA signals, validates admin secret, checks news, and fans out execution to all subscribers.
 */
export async function handleMasterBroadcast(req, res) {
  try {
    const { adminSecret, symbol = 'XAUUSD', orderType, stopLossPips, entryPrice, stopLossPrice, takeProfitPrice } = req.body;

    // 1. Authenticate the Master EA broadcast request
    if (!adminSecret || adminSecret !== process.env.ADMIN_SECRET_KEY) {
      console.warn("[SECURITY]: Unauthorized broadcast attempt detected with invalid key.");
      return res.status(401).json({ error: 'Unauthorized broadcast: Invalid or missing admin secret key.' });
    }

    if (!orderType || !entryPrice || !stopLossPrice) {
      return res.status(400).json({ error: 'Missing required parameters: orderType, entryPrice, stopLossPrice' });
    }

    // 2. Enforce High-Impact News Filter globally for the broadcast
    const newsBlocked = await isNewsBlocked();
    if (newsBlocked) {
      console.log(`[BROADCAST_BLOCKED]: High-impact USD news buffer active.`);
      return res.status(423).json({ 
        success: false, 
        error: 'Master broadcast blocked: High-impact USD news buffer active (30m pre/post).' 
      });
    }

    // 3. Map Order Type for Limit Orders
    let metaApiActionType;
    const cleanType = orderType.toUpperCase();
    if (cleanType === 'BUY_LIMIT') metaApiActionType = 'ORDER_TYPE_BUY_LIMIT';
    else if (cleanType === 'SELL_LIMIT') metaApiActionType = 'ORDER_TYPE_SELL_LIMIT';
    else if (cleanType === 'BUY_STOP') metaApiActionType = 'ORDER_TYPE_BUY_STOP';
    else if (cleanType === 'SELL_STOP') metaApiActionType = 'ORDER_TYPE_SELL_STOP';
    else {
      return res.status(400).json({ error: 'Invalid orderType. Must be BUY_LIMIT, SELL_LIMIT, BUY_STOP, or SELL_STOP.' });
    }

    // 4. Fetch all active user accounts / subscribers from Supabase
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

    console.log(`[BROADCAST_FANOUT]: Dispatches incoming signal to ${subscribers.length} active subscriber accounts...`);

    // Normalize subscriber object keys to match helper expectations
    const formattedSubscribers = subscribers.map(sub => ({
      userId: sub.user_id,
      brokerAccountId: sub.broker_account_id
    }));

    const signalData = {
      symbol,
      metaApiActionType,
      cleanType,
      entryPrice,
      stopLossPrice,
      takeProfitPrice,
      stopLossPips
    };

    // 5. Fan out trade execution asynchronously across all subscribers
    // We map promises so all requests fire concurrently without blocking the HTTP response
    const executionPromises = formattedSubscribers.map(sub => executeTradeForSubscriber(sub, signalData));
    
    // Await background completion or let it process asynchronously
    Promise.all(executionPromises).then(results => {
      const successes = results.filter(r => r.success).length;
      console.log(`[BROADCAST_COMPLETE]: Successfully executed trade for ${successes}/${results.length} subscribers.`);
    });

    // Immediate acknowledgment back to the Master EA running on your laptop
    return res.status(200).json({
      success: true,
      message: `Master broadcast received and fanned out to ${subscribers.length} active accounts.`,
      activeSubscribersCount: subscribers.length
    });

  } catch (err) {
    console.error('[MASTER_BROADCAST_ERROR]:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to process master broadcast signal.' });
  }
}
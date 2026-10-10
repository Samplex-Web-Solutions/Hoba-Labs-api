import { supabase } from '../../config/supabase.js';
import axios from 'axios';

const BACKEND_URL = process.env.BACKEND_URL;
const INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET;

function isMarketOpen() {
  const now = new Date();
  const day = now.getUTCDay();
  const hour = now.getUTCHours();
  const minute = now.getUTCMinutes();
  
  if (day === 6) return false;
  if (day === 0 && hour < 22) return false;
  if (day === 5 && (hour > 22 || (hour === 22 && minute >= 0))) return false;

  return true;
}

async function getCurrentMarketPrice(pair) {
  try {
    const cleanPair = pair.toUpperCase().replace('/', '');
    const response = await axios.get(`https://biquote.io/api/${cleanPair}`);
    const tickData = response.data;
    const price = tickData?.mid || tickData?.price || tickData?.last || tickData?.close || tickData?.bid;
    return price ? parseFloat(price) : null;
  } catch (err) {
    return null;
  }
}

async function sendTelegramBroadcast(message) {
  try {
    const { data: activeSubs } = await supabase
      .from('subscriptions')
      .select(`users!subscriptions_user_id_fkey ( telegram_id )`)
      .in('status', ['active', 'trialing']);

    if (!activeSubs || activeSubs.length === 0) return;

    const chatIds = [...new Set(activeSubs.map(sub => sub.users?.telegram_id).filter(id => id))];

    for (const chatId of chatIds) {
      await axios.post(
        `${BACKEND_URL}/api/telegram/broadcast`,
        { chat_id: chatId, message },
        { headers: { 'x-internal-secret': INTERNAL_SERVICE_SECRET } }
      ).catch(() => { });
    }
  } catch (err) {}
}

export async function monitorOpenTrades() {
  try {
    if (!isMarketOpen()) return;

    const { data: signals, error } = await supabase
      .from('signals')
      .select('*')
      .in('status', ['PENDING', 'TRIGGERED']);

    if (error || !signals || signals.length === 0) return;

    for (const signal of signals) {
      const currentPrice = await getCurrentMarketPrice(signal.pair);
      if (!currentPrice || isNaN(currentPrice) || currentPrice <= 0) continue;

      const cleanPair = signal.pair.toUpperCase();
      const isGold = cleanPair.includes('XAU');
      const isJpy = cleanPair.includes('JPY');
      const pipMultiplier = isGold ? 10 : isJpy ? 100 : 10000;

      const isBullish = signal.direction === 'BULLISH' || signal.direction === 'BUY';
      const riskPips = Math.abs(signal.entry_price - signal.stop_loss) * pipMultiplier;

      const createdAt = new Date(signal.created_at).getTime();
      const now = Date.now();
      const ageInMinutes = (now - createdAt) / (1000 * 60);
      const hoursElapsed = ageInMinutes / 60;

      // Expire stale setups older than 4 hours
      if (signal.status === 'PENDING' && hoursElapsed > 4) {
        await supabase.from('signals').update({ status: 'MISSED', outcome: 'EXPIRED' }).eq('id', signal.id);
        await sendTelegramBroadcast(`⌛ <b>SETUP EXPIRED</b>\nPair: <code>${signal.pair}</code>\nTime expired before fill. Remove pending order.`);
        continue;
      }

      // ----------------------------------------------------
      // 1. PENDING ORDER MANAGEMENT
      // ----------------------------------------------------
      if (signal.status === 'PENDING') {
        if (ageInMinutes < 1) continue;

        const orderType = signal.order_type || (isBullish ? 'BUY_LIMIT' : 'SELL_LIMIT');
        const filled =
          orderType === 'BUY_LIMIT'  ? currentPrice <= signal.entry_price :
          orderType === 'SELL_LIMIT' ? currentPrice >= signal.entry_price :
          orderType === 'BUY_STOP'   ? currentPrice >= signal.entry_price :
                                       currentPrice <= signal.entry_price; // SELL_STOP

        if (filled) {
          await supabase.from('signals').update({ status: 'TRIGGERED' }).eq('id', signal.id);

          const filledMsg = `
<b>ORDER FILLED</b>
━━━━━━━━━━━━━━━━━━━
📈 <b>HOBA LABS</b>
━━━━━━━━━━━━━━━━━━━
<b>Pair:</b>   <code>${signal.pair}</code>
<b>Order:</b>  ${orderType.replace('_', ' ')}
<b>Entry:</b>  <code>${signal.entry_price}</code>
━━━━━━━━━━━━━━━━━━━
<i>Your pending order is now active.</i>
          `.trim();

          await sendTelegramBroadcast(filledMsg);
          continue;
        }

        // Cancel if price reached SL or TP without ever filling the order
        const hitSlFirst = isBullish ? currentPrice <= signal.stop_loss : currentPrice >= signal.stop_loss;
        const hitTpFirst = isBullish ? currentPrice >= signal.take_profit : currentPrice <= signal.take_profit;

        if (hitSlFirst || hitTpFirst) {
          await supabase.from('signals').update({ status: 'MISSED', outcome: 'CANCELLED' }).eq('id', signal.id);
          await sendTelegramBroadcast(`⌛ <b>ORDER CANCELLED</b>\nPair: <code>${signal.pair}</code>\nSetup invalidated before entry. Remove the pending order.`);
          continue;
        }
      }

      // ----------------------------------------------------
      // 2. TRIGGERED TRADE MANAGEMENT (TP / SL / BE)
      // ----------------------------------------------------
      else if (signal.status === 'TRIGGERED') {
        const currentProfitPips = isBullish
          ? (currentPrice - signal.entry_price) * pipMultiplier
          : (signal.entry_price - currentPrice) * pipMultiplier;

        const maxProfit = Math.max(signal.max_profit_pips || 0, currentProfitPips);

        const hitTp = isBullish ? currentPrice >= signal.take_profit : currentPrice <= signal.take_profit;
        if (hitTp) {
          await supabase.from('signals').update({
            status: 'COMPLETED', outcome: 'TP', exit_price: signal.take_profit, pips_gained: signal.tp_pips
          }).eq('id', signal.id);

          await sendTelegramBroadcast(`🎯 <b>PROFIT HIT! (+${signal.tp_pips} Pips)</b>\nPair: <code>${signal.pair}</code>`);
          continue;
        }

        const hitSl = isBullish ? currentPrice <= signal.stop_loss : currentPrice >= signal.stop_loss;
        if (hitSl) {
          await supabase.from('signals').update({
            status: 'COMPLETED', outcome: 'SL', exit_price: signal.stop_loss, pips_gained: -signal.sl_pips
          }).eq('id', signal.id);

          await sendTelegramBroadcast(`💔 <b>STOP LOSS HIT (-${signal.sl_pips} Pips)</b>\nPair: <code>${signal.pair}</code>`);
          continue;
        }

        if (currentProfitPips >= riskPips && !signal.notified_one_to_one) {
          await supabase.from('signals').update({ notified_one_to_one: true, max_profit_pips: maxProfit }).eq('id', signal.id);
          await sendTelegramBroadcast(`💡 <b>ADVISOR: SET BREAK-EVEN</b>\nPair: <code>${signal.pair}</code> reached 1:1 risk-reward. Protect capital!`);
          continue;
        }

        if (maxProfit > (signal.max_profit_pips || 0)) {
          await supabase.from('signals').update({ max_profit_pips: maxProfit }).eq('id', signal.id);
        }
      }
    }
  } catch (err) {
    console.error('[TRADE_MONITOR_WORKER_ERROR]:', err.message);
  }
}
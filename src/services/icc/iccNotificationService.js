import { supabase } from '../../config/supabase.js';
import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';

dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

/**
 * Persists generated signals to Supabase and broadcasts alerts only to users with active/trialing subscriptions and a valid telegram_id.
 * @param {Object} signal 
 */
async function dispatchAndLogSignal(signal) {
  try {
    // 1. Log signal to Supabase signals table
    const { data: signalData, error: signalError } = await supabase
      .from('signals')
      .insert([{
        pair: signal.pair,
        direction: signal.bias,
        entry_price: signal.entryPrice,
        stop_loss: signal.stopLoss,
        take_profit: signal.takeProfit,
        aoi_id: signal.aoiId,
        status: 'PENDING'
      }])
      .select();

    if (signalError) throw signalError;

    // 2. Query subscriptions table and join with users using foreign key relation (subscriptions.user_id = users.id)
    const { data: activeSubs, error: subError } = await supabase
      .from('subscriptions')
      .select(`
        status,
        trial_ends_at,
        current_period_end,
        users!subscriptions_user_id_fkey (
          telegram_id,
          username
        )
      `)
      .in('status', ['active', 'trialing']);

    if (subError) throw subError;

    if (!activeSubs || activeSubs.length === 0) {
      console.log(`Signal logged, no active subscriptions found.`);
      return true;
    }

    // 3. Extract unique, non-null Telegram IDs from the joined user records
    const targetChatIds = [...new Set(
      activeSubs
        .map(sub => sub.users?.telegram_id)
        .filter(id => id !== null && id !== undefined)
    )];

    if (targetChatIds.length === 0) {
      console.log(`Subscriptions found, but none of the subscribers have linked their Telegram IDs yet.`);
      return true;
    }

    // 4. Format Telegram Alert Message
    // Format a gorgeous, high-impact Telegram Alert Message
    const isBullish = signal.bias === 'BULLISH';
    const directionEmoji = isBullish ? '🟢 <b>BUY SETUP</b>' : '🔴 <b>SELL SETUP</b>';
    const accentLine = '━━━━━━━━━━━━━━━━━━━';

    const message = `
    <b>NEW SIGNAL ALERT</B>
    ${accentLine}
    ${accentLine}
🚀 <b>HOBA LABS</b> 🚀
${accentLine}
<b>Asset / Pair:</b>  <code>${signal.pair}</code>
<b>Direction:</b>     ${directionEmoji}
<b>Setup Type:</b>    <code>ICC</code>
${accentLine}
🎯 <b>ENTRY DETAILS</b>
• <b>Entry Price:</b>  <code>${signal.entryPrice}</code>
• <b>Stop Loss:</b>    <code>${signal.stopLoss}</code>
• <b>Take Profit:</b>  <code>${signal.takeProfit}</code>
${accentLine}
 <i>Status: Verified Member</i>
    `.trim();

    // 5. Broadcast to each subscribed user concurrently
    const broadcastPromises = targetChatIds.map(async (telegramId) => {
      try {
        await bot.telegram.sendMessage(telegramId, message, { parse_mode: 'HTML' });
      } catch (err) {
        console.error(`[TELEGRAM_SEND_ERROR]: Failed to send to ${telegramId}:`, err.message);
      }
    });

    await Promise.all(broadcastPromises);

    console.log(`Signal sent to ${targetChatIds.length} subscriber(s) for ${signal.pair}`);
    return true;

  } catch (error) {
    console.error(`Failed to log or broadcast signal`, error.message);
    return false;
  }
}

export { dispatchAndLogSignal };
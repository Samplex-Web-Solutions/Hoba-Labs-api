import { supabase } from '../../config/supabase.js';
import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';

dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

/**
 * Persists generated signals to Supabase and broadcasts alerts with pending order tags.
 * Only sends broadcasts to subscribers whose active/trialing period has NOT expired.
 * @param {Object} signal 
 */
async function dispatchAndLogSignal(signal) {
  try {
    const { data: signalData, error: signalError } = await supabase
      .from('signals')
      .insert([{
        pair: signal.pair,
        direction: signal.bias,
        order_type: signal.order_type,
        entry_price: signal.entry_price,
        stop_loss: signal.stop_loss,
        take_profit: signal.take_profit,
        risk_reward: signal.riskRewardRatio,
        sl_pips: signal.slPips,
        tp_pips: signal.tpPips,
        aoi_id: signal.aoiId,
        status: 'PENDING',
        max_profit_pips: 0,
        notified_one_to_one: false
      }])
      .select()
      .single();

    if (signalError) throw signalError;

    const signalId = signalData.id;

    // Fetch active or trialing subscriptions along with expiry dates
    const { data: activeSubs, error: subError } = await supabase
      .from('subscriptions')
      .select(`
        status,
        current_period_end,
        trial_ends_at,
        users!subscriptions_user_id_fkey (
          telegram_id,
          username
        )
      `)
      .in('status', ['active', 'trialing']);

    if (subError) throw subError;
    if (!activeSubs || activeSubs.length === 0) return true;

    // Filter out subscriptions whose time window has fully elapsed
    const now = new Date();
    const validSubs = activeSubs.filter(sub => {
      const expiry = sub.current_period_end || sub.trial_ends_at;
      if (!expiry) return false;
      return new Date(expiry) > now;
    });

    if (validSubs.length === 0) return true;

    const targetChatIds = [...new Set(
      validSubs
        .map(sub => sub.users?.telegram_id)
        .filter(id => id !== null && id !== undefined)
    )];

    if (targetChatIds.length === 0) return true;

    const isBullish = signal.bias === 'BULLISH';
    const orderLabel = signal.order_type.replace('_', ' '); // e.g., "BUY LIMIT"
    const directionEmoji = isBullish ? `🟢 <b>${orderLabel}</b>` : `🔴 <b>${orderLabel}</b>`;
    const accentLine = '━━━━━━━━━━━━━━━━━━━';

    const message = `
<b>NEW SIGNAL ALERT</b>
${accentLine}
📈 <b>HOBA LABS</b> 
${accentLine}
<b>Asset / Pair:</b>  <code>${signal.pair}</code>
<b>Type:</b>          ${directionEmoji}
<b>Risk:Reward:</b>   <code>${signal.riskRewardRatio}</code>
${accentLine}
🎯 <b>PENDING EXECUTION TARGETS</b>
• <b>Entry:</b>        <code>${signal.entry_price}</code> (pending order)
• <b>Stop Loss:</b>    <code>${signal.stop_loss}</code> (${signal.slPips} pips)
• <b>Take Profit:</b>  <code>${signal.take_profit}</code> (${signal.tpPips} pips)
${accentLine}
<i>Status: ✅ Verified Member</i>
    `.trim();

    const replyMarkup = {
      inline_keyboard: [
        [{ text: '🧮 Calculate Risk for this Setup', callback_data: `calc_select_${signalId}` }],
        [{ text: '🏠 Back to Main Menu', callback_data: 'back_to_menu' }]
      ]
    };

    const broadcastPromises = targetChatIds.map(async (telegramId) => {
      try {
        await bot.telegram.sendMessage(telegramId, message, { 
          parse_mode: 'HTML',
          reply_markup: replyMarkup
        });
      } catch (err) {
        console.error(`[TELEGRAM_SEND_ERROR]: Failed to send to ${telegramId}:`, err.message);
      }
    });

    await Promise.all(broadcastPromises);
    console.log(`Signal with order type ${signal.order_type} sent to ${targetChatIds.length} verified subscriber(s) for ${signal.pair}`);
    return true;

  } catch (error) {
    console.error(`Failed to log or broadcast signal`, error.message);
    return false;
  }
}

export { dispatchAndLogSignal };
import { supabase } from '../../config/supabase.js';
import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';

dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

/**
 * Persists generated signals (including Pips & RR) to Supabase and broadcasts alerts with interactive Risk Calculator buttons.
 * @param {Object} signal 
 */
async function dispatchAndLogSignal(signal) {
  try {
    // 1. Log signal with Pips and RR to Supabase signals table and return the inserted row (including id)
    const { data: signalData, error: signalError } = await supabase
      .from('signals')
      .insert([{
        pair: signal.pair,
        direction: signal.bias,
        entry_price: signal.entryPrice,
        stop_loss: signal.stopLoss,
        take_profit: signal.takeProfit,
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

    // 2. Query subscriptions table and join with users
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

    const targetChatIds = [...new Set(
      activeSubs
        .map(sub => sub.users?.telegram_id)
        .filter(id => id !== null && id !== undefined)
    )];

    if (targetChatIds.length === 0) {
      console.log(`Subscriptions found, but none of the subscribers have linked their Telegram IDs yet.`);
      return true;
    }

    // 3. Format Telegram Alert Message with Pips & RR
    const isBullish = signal.bias === 'BULLISH';
    const directionEmoji = isBullish ? '🟢 <b>BUY SETUP</b>' : '🔴 <b>SELL SETUP</b>';
    const accentLine = '━━━━━━━━━━━━━━━━━━━';

    const message = `
<b>NEW SIGNAL ALERT</b>
${accentLine}
📈 <b>HOBA LABS</b> 
${accentLine}
<b>Asset / Pair:</b>  <code>${signal.pair}</code>
<b>Direction:</b>     ${directionEmoji}
<b>Risk:Reward:</b>   <code>${signal.riskRewardRatio}</code>
${accentLine}
🎯 <b>EXECUTION TARGETS</b>
• <b>Entry Price:</b>  <code>${signal.entryPrice}</code>
• <b>Stop Loss:</b>    <code>${signal.stopLoss}</code> (${signal.slPips} pips)
• <b>Take Profit:</b>  <code>${signal.takeProfit}</code> (${signal.tpPips} pips)
• <b>Risk Reward:</b>  <code>${signal.riskRewardRatio}</code>
${accentLine}
<i>Status: ✅ Verified Member</i>
    `.trim();

    // 4. Attach Inline Keyboard with Risk Calculator button for this exact signal
    const replyMarkup = {
      inline_keyboard: [
        [{ text: '🧮 Calculate Risk for this Setup', callback_data: `calc_select_${signalId}` }],
        [{ text: '🏠 Back to Main Menu', callback_data: 'back_to_menu' }]
      ]
    };

    // 5. Broadcast concurrently
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

    console.log(`Signal with Pips/RR and Risk Calculator button sent to ${targetChatIds.length} subscriber(s) for ${signal.pair}`);
    return true;

  } catch (error) {
    console.error(`Failed to log or broadcast signal`, error.message);
    return false;
  }
}

export { dispatchAndLogSignal };













// import { supabase } from '../../config/supabase.js';
// import { Telegraf } from 'telegraf';
// import dotenv from 'dotenv';

// dotenv.config();

// const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// /**
//  * Persists generated signals (including Pips & RR) to Supabase and broadcasts alerts.
//  * @param {Object} signal 
//  */
// async function dispatchAndLogSignal(signal) {
//   try {
//     // 1. Log signal with Pips and RR to Supabase signals table
//     const { data: signalData, error: signalError } = await supabase
//       .from('signals')
//       .insert([{
//         pair: signal.pair,
//         direction: signal.bias,
//         entry_price: signal.entryPrice,
//         stop_loss: signal.stopLoss,
//         take_profit: signal.takeProfit,
//         risk_reward: signal.riskRewardRatio,
//         sl_pips: signal.slPips,
//         tp_pips: signal.tpPips,
//         aoi_id: signal.aoiId,
//         status: 'PENDING'
//       }])
//       .select();

//     if (signalError) throw signalError;

//     // 2. Query subscriptions table and join with users
//     const { data: activeSubs, error: subError } = await supabase
//       .from('subscriptions')
//       .select(`
//         status,
//         trial_ends_at,
//         current_period_end,
//         users!subscriptions_user_id_fkey (
//           telegram_id,
//           username
//         )
//       `)
//       .in('status', ['active', 'trialing']);

//     if (subError) throw subError;

//     if (!activeSubs || activeSubs.length === 0) {
//       console.log(`Signal logged, no active subscriptions found.`);
//       return true;
//     }

//     const targetChatIds = [...new Set(
//       activeSubs
//         .map(sub => sub.users?.telegram_id)
//         .filter(id => id !== null && id !== undefined)
//     )];

//     if (targetChatIds.length === 0) {
//       console.log(`Subscriptions found, but none of the subscribers have linked their Telegram IDs yet.`);
//       return true;
//     }

//     // 3. Format Telegram Alert Message with Pips & RR
//     const isBullish = signal.bias === 'BULLISH';
//     const directionEmoji = isBullish ? '🟢 <b>BUY SETUP</b>' : '🔴 <b>SELL SETUP</b>';
//     const accentLine = '━━━━━━━━━━━━━━━━━━━';

//     const message = `
// <b>NEW SIGNAL ALERT</b>
// ${accentLine}
// 📈 <b>HOBA LABS</b> 
// ${accentLine}
// <b>Asset / Pair:</b>  <code>${signal.pair}</code>
// <b>Direction:</b>     ${directionEmoji}
// <b>Risk:Reward:</b>   <code>${signal.riskRewardRatio}</code>
// ${accentLine}
// 🎯 <b>EXECUTION TARGETS</b>
// • <b>Entry Price:</b>  <code>${signal.entryPrice}</code>
// • <b>Stop Loss:</b>    <code>${signal.stopLoss}</code> (${signal.slPips} pips)
// • <b>Take Profit:</b>  <code>${signal.takeProfit}</code> (${signal.tpPips} pips)
// • <b>Risk Reward:</b>  <code>${signal.riskRewardRatio}</code>
// ${accentLine}
// <i>Status: ✅ Verified Member</i>
//     `.trim();

//     // 4. Broadcast concurrently
//     const broadcastPromises = targetChatIds.map(async (telegramId) => {
//       try {
//         await bot.telegram.sendMessage(telegramId, message, { parse_mode: 'HTML' });
//       } catch (err) {
//         console.error(`[TELEGRAM_SEND_ERROR]: Failed to send to ${telegramId}:`, err.message);
//       }
//     });

//     await Promise.all(broadcastPromises);

//     console.log(`Signal with Pips/RR sent to ${targetChatIds.length} subscriber(s) for ${signal.pair}`);
//     return true;

//   } catch (error) {
//     console.error(`Failed to log or broadcast signal`, error.message);
//     return false;
//   }
// }

// export { dispatchAndLogSignal };
import { supabase } from '../../config/supabase.js';
import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';

dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

/**
 * Persists generated signals to Supabase and broadcasts alerts only to users with active subscriptions.
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

    // 2. Fetch active subscriptions joined with users where telegram_id is not null
    const nowIso = new Date().toISOString();
    const { data: activeSubs, error: subError } = await supabase
      .from('subscriptions')
      .select(`
        status,
        trial_ends_at,
        expires_at,
        users!inner (
          telegram_id
        )
      `)
      .in('status', ['active', 'trialing'])
      .not('users.telegram_id', 'is', null);

    if (subError) throw subError;

    // Filter valid subscriptions by checking future trial or expiration dates
    const validSubs = (activeSubs || []).filter(sub => {
      const trialValid = sub.trial_ends_at && new Date(sub.trial_ends_at) > new Date(nowIso);
      const expiresValid = sub.expires_at && new Date(sub.expires_at) > new Date(nowIso);
      return trialValid || expiresValid;
    });

    if (validSubs.length === 0) {
      console.log(`[ICC_DISPATCH]: Signal logged, but no active or trialing Telegram subscribers found.`);
      return true;
    }

    // Extract unique Telegram IDs
    const targetChatIds = [...new Set(
      validSubs
        .map(sub => sub.users?.telegram_id)
        .filter(Boolean)
    )];

    // 3. Format Telegram Alert Message
    const emoji = signal.bias === 'BULLISH' ? '🟢 BUY (LONG)' : '🔴 SELL (SHORT)';
    const message = `
🚨 *ICC STRATEGY SIGNAL GENERATED* 🚨

*Asset:* ${signal.pair}
*Direction:* ${emoji}
*Entry Price:* ${signal.entryPrice}
*Stop Loss:* ${signal.stopLoss}
*Take Profit:* ${signal.takeProfit}
*Zone ID:* ${signal.aoiId}

_Engine Status: Broadcasted to Premium Members_
    `.trim();

    // 4. Broadcast to each subscribed user concurrently
    const broadcastPromises = targetChatIds.map(async (telegramId) => {
      try {
        await bot.telegram.sendMessage(telegramId, message, { parse_mode: 'Markdown' });
      } catch (err) {
        console.error(`[TELEGRAM_SEND_ERROR]: Failed to send to ${telegramId}:`, err.message);
      }
    });

    await Promise.all(broadcastPromises);

    console.log(`[ICC_DISPATCH_SUCCESS]: Signal broadcasted to ${targetChatIds.length} active subscriber(s) for ${signal.pair}`);
    return true;

  } catch (error) {
    console.error(`[ICC_DISPATCH_ERROR]: Failed to log or broadcast signal`, error.message);
    return false;
  }
}

export { dispatchAndLogSignal };
import dotenv from 'dotenv';
import { Telegraf, Markup } from 'telegraf';
import axios from 'axios';
import { supabase } from '../config/supabase.js';
import { monitorOpenTrades } from '../services/monitor/tradeMonitorService.js';
import { fetchTodayCalendar } from '../services/news/newsService.js';

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const BACKEND_URL = process.env.BACKEND_URL;
const FRONTEND_URL = process.env.FRONTEND_URL;
const INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET;

if (!token) {
  console.error('❌ TELEGRAM_BOT_TOKEN is missing in your .env field!');
}
if (!INTERNAL_SERVICE_SECRET) {
  console.error('❌ INTERNAL_SERVICE_SECRET is missing — the bot will not be able to call the backend.');
}

const bot = new Telegraf(token);

// Temporary session store for interactive Risk Calculator steps
const userCalcSessions = new Map();

// --- Reusable Main Menu Inline Keyboard ---
const getMainMenuKeyboard = () => {
  return Markup.inlineKeyboard([
    [Markup.button.webApp('📊 Open Dashboard', `${FRONTEND_URL}/dashboard`)],
    [Markup.button.callback('🧮 Risk Calculator', 'calc_start')],
    [Markup.button.callback('📈 Latest Signals', 'view_signals'), Markup.button.callback('📅 Economic Calendar', 'view_calendar')],
    [Markup.button.callback('👤 Check Subscription', 'check_subscription'), Markup.button.callback('📜 Sub History', 'sub_history')]
  ]);
};

// --- Reusable Back to Menu Keyboard ---
const getBackToMenuKeyboard = () => {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🏠 Back to Main Menu', 'back_to_menu')]
  ]);
};

// --- /start Command ---
bot.start(async (ctx) => {
  const telegramId = ctx.from?.id;
  const firstName = ctx.from?.first_name || 'Trader';
  const username = ctx.from?.username || '';

  if (!telegramId) return;

  try {
    const response = await axios.post(
      `${BACKEND_URL}/api/auth/telegram-login`,
      { telegram_id: telegramId },
      { headers: { 'x-internal-secret': INTERNAL_SERVICE_SECRET } }
    );

    if (response.data.success) {
      await ctx.reply(
        `Welcome back, ${firstName}! 🚀\n\nManage your trading account below:`,
        getMainMenuKeyboard()
      );
    }
  } catch (err) {
    await ctx.reply(
      `Welcome to Hoba Labs, ${firstName}! 🛡️\n\nTo use this platform, you must first link your web account.`,
      Markup.inlineKeyboard([
        [Markup.button.webApp('🔗 Link Web Account', `${FRONTEND_URL}/link-telegram?telegram_id=${telegramId}&username=${username}`)]
      ])
    );
  }
});

// --- Economic Calendar Handler ---
const handleEconomicCalendar = async (ctx) => {
  try {
    await ctx.reply('📅 Fetching today\'s economic calendar releases...');
    const events = await fetchTodayCalendar();

    if (!events || events.length === 0) {
      return ctx.reply('📭 No economic events scheduled for today.', getBackToMenuKeyboard());
    }

    const topEvents = events.slice(0, 6);

    for (let i = 0; i < topEvents.length; i++) {
      const ev = topEvents[i];
      const country = ev.countryCode || 'GL';
      const currency = ev.currency || '';
      const name = ev.name || 'Economic Release';
      const importance = (ev.importance || 'low').toUpperCase();
      const time = ev.time ? new Date(ev.time).toLocaleTimeString([], { timeStyle: 'short' }) : 'Scheduled';
      
      const forecast = ev.forecast !== null && ev.forecast !== undefined ? ev.forecast : 'N/A';
      const previous = ev.previous !== null && ev.previous !== undefined ? ev.previous : 'N/A';
      const actual = ev.actual !== null && ev.actual !== undefined ? ev.actual : 'Pending';

      const msg = `📅 *${country} (${currency}) — ${name}*\n\n` +
        `⭐ *Importance:* ${importance}\n` +
        `⏱️ *Time:* ${time}\n` +
        `📊 *Forecast:* ${forecast} | *Prev:* ${previous}\n` +
        `🎯 *Actual:* ${actual}`;

      if (i === topEvents.length - 1) {
        await ctx.replyWithMarkdown(msg, getBackToMenuKeyboard());
      } else {
        await ctx.replyWithMarkdown(msg);
      }
    }
  } catch (err) {
    console.error('[TELEGRAM_CALENDAR_ERROR]:', err);
    await ctx.reply('⚠️ Error fetching economic calendar. Please try again later.', getBackToMenuKeyboard());
  }
};

bot.command('calendar', handleEconomicCalendar);
bot.action('view_calendar', async (ctx) => {
  await ctx.answerCbQuery();
  await handleEconomicCalendar(ctx);
});

// --- Subscription Status Check Handler ---
const handleSubscriptionCheck = async (ctx) => {
  const telegramId = ctx.from.id.toString();

  try {
    const { data: subscriptions, error } = await supabase
      .from('subscriptions')
      .select('status, trial_ends_at, current_period_end, plan_type, amount, users!subscriptions_user_id_fkey ( id, telegram_id, username, email )')
      .in('status', ['active', 'trialing']);

    if (error || !subscriptions || subscriptions.length === 0) {
      return ctx.reply('❌ No active subscriptions found. Please use /start to link your account.', getBackToMenuKeyboard());
    }

    const userSub = subscriptions.find(sub => sub.users?.telegram_id?.toString() === telegramId);

    if (!userSub) {
      return ctx.reply('❌ No web account linked to this Telegram ID. Please use /start to link your account.', getBackToMenuKeyboard());
    }

    const status = (userSub.status || 'inactive').toLowerCase();
    const isActive = ['active', 'trialing'].includes(status);
    const expiryField = userSub.current_period_end || userSub.trial_ends_at;
    
    let expiryText = 'N/A';
    let diffDays = null;

    if (expiryField) {
      const expiryDate = new Date(expiryField);
      expiryText = expiryDate.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

      const now = new Date();
      const diffTime = expiryDate - now;
      diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      if (diffDays > 0) {
        expiryText += ` (${diffDays} day${diffDays === 1 ? '' : 's'} remaining)`;
      } else if (diffDays === 0) {
        expiryText += ` (Expires Today!)`;
      } else {
        expiryText += ` (Expired)`;
      }
    }

    const responseText = `*Account Status Summary*\n\n` +
      `• *Username:* @${userSub.users?.username || 'Linked'}\n` +
      `• *Plan:* ${(userSub.plan_type || 'Free Trial').toUpperCase()}\n` +
      `• *Amount:* $${Number(userSub.amount || 0).toFixed(2)}\n` +
      `• *Status:* ${status.toUpperCase()} ${isActive ? '🟢' : '🔴'}\n` +
      `• *Expires On:* ${expiryText}`;

    await ctx.replyWithMarkdown(responseText, getBackToMenuKeyboard());
  } catch (err) {
    console.error('[TELEGRAM_STATUS_ERROR]:', err);
    await ctx.reply('⚠️ Error fetching subscription status. Please try again later.', getBackToMenuKeyboard());
  }
};

bot.command('status', handleSubscriptionCheck);
bot.action('check_subscription', async (ctx) => {
  await ctx.answerCbQuery();
  await handleSubscriptionCheck(ctx);
});

// --- Subscription History Handler ---
const handleSubscriptionHistory = async (ctx) => {
  const telegramId = ctx.from.id.toString();

  try {
    const { data: userRecord, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('telegram_id', telegramId)
      .single();

    if (userError || !userRecord) {
      return ctx.reply('❌ No account linked to this Telegram ID. Please use /start to link.', getBackToMenuKeyboard());
    }

    const { data: historyList, error: histError } = await supabase
      .from('subscription_history')
      .select('*')
      .eq('user_id', userRecord.id)
      .order('created_at', { ascending: false });

    if (histError || !historyList || historyList.length === 0) {
      return ctx.reply('📭 No transaction or renewal history found for your account.', getBackToMenuKeyboard());
    }

    let historyMessage = `📜 *YOUR SUBSCRIPTION HISTORY*\n━━━━━━━━━━━━━━━━━━━\n\n`;

    historyList.forEach((item, index) => {
      const startDate = new Date(item.period_start).toLocaleDateString();
      const endDate = new Date(item.period_end).toLocaleDateString();
      historyMessage += `${index + 1}. *Plan:* \`${item.plan_type || item.plan_key || 'Standard'}\`\n` +
        `   • *Amount:* \`$${Number(item.amount).toFixed(2)}\`\n` +
        `   • *Status:* ${item.status.toUpperCase()} 🟢\n` +
        `   • *Period:* ${startDate} ➔ ${endDate}\n` +
        `   • *Ref:* \`${item.reference || 'N/A'}\`\n\n`;
    });

    await ctx.replyWithMarkdown(historyMessage, getBackToMenuKeyboard());
  } catch (err) {
    console.error('[TELEGRAM_HISTORY_ERROR]:', err);
    await ctx.reply('⚠️ Error fetching subscription history ledger.', getBackToMenuKeyboard());
  }
};

bot.command('history', handleSubscriptionHistory);
bot.action('sub_history', async (ctx) => {
  await ctx.answerCbQuery();
  await handleSubscriptionHistory(ctx);
});

// --- View Signals Handler ---
const handleViewSignals = async (ctx) => {
  const telegramId = ctx.from.id.toString();

  try {
    const { data: userRecord } = await supabase
      .from('users')
      .select('id')
      .eq('telegram_id', telegramId)
      .single();

    if (!userRecord) {
      return ctx.reply('🔒 Access Denied. Account not linked.', getBackToMenuKeyboard());
    }

    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('status')
      .eq('user_id', userRecord.id)
      .single();

    const status = (subscription?.status || '').toLowerCase();
    if (!['active', 'trialing'].includes(status)) {
      return ctx.reply('🔒 Access Denied. Your subscription is not active or has expired.', getBackToMenuKeyboard());
    }

    const { data: signals, error } = await supabase
      .from('signals')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(3);

    if (error || !signals || signals.length === 0) {
      return ctx.reply('📭 No active signals available at the moment.', getBackToMenuKeyboard());
    }

    for (let i = 0; i < signals.length; i++) {
      const sig = signals[i];
      const msg = `🚨 *${sig.pair}* — *${sig.direction}*\n\n` +
        `🎯 *Entry:* ${sig.entry_price}\n` +
        `🛑 *SL:* ${sig.stop_loss}\n` +
        `💰 *TP:* ${sig.take_profit}\n` +
        `⏱️ *Time:* ${new Date(sig.created_at).toLocaleString()}`;
      
      if (i === signals.length - 1) {
        await ctx.replyWithMarkdown(msg, getBackToMenuKeyboard());
      } else {
        await ctx.replyWithMarkdown(msg);
      }
    }
  } catch (err) {
    console.error('[TELEGRAM_SIGNALS_ERROR]:', err);
    await ctx.reply('⚠️ Error fetching recent signals.', getBackToMenuKeyboard());
  }
};

bot.command('signals', handleViewSignals);
bot.action('view_signals', async (ctx) => {
  await ctx.answerCbQuery();
  await handleViewSignals(ctx);
});

// ==========================================
// --- INTERACTIVE RISK CALCULATOR FLOW ---
// ==========================================

bot.action('calc_start', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data: signals, error } = await supabase
      .from('signals')
      .select('*')
      .eq('status', 'PENDING')
      .gte('created_at', today.toISOString())
      .order('created_at', { ascending: false });

    if (error || !signals || signals.length === 0) {
      return ctx.editMessageText(
        '📭 No pending signals available for today to calculate risk on.',
        getBackToMenuKeyboard()
      );
    }

    const buttons = signals.map(sig => [
      Markup.button.callback(
        `📊 ${sig.pair} (${sig.direction === 'BULLISH' || sig.direction === 'BUY' ? 'BUY' : 'SELL'}) — Entry: ${sig.entry_price}`,
        `calc_select_${sig.id}`
      )
    ]);
    buttons.push([Markup.button.callback('🏠 Back to Main Menu', 'back_to_menu')]);

    userCalcSessions.set(ctx.from.id, { step: 'SELECTING_SIGNAL' });

    await ctx.editMessageText(
      '🧮 *Hoba Labs Risk Calculator*\n\nSelect a pending signal below to calculate your risk & profit exposure:',
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
    );
  } catch (err) {
    console.error('[CALC_START_ERROR]:', err);
    await ctx.reply('⚠️ Error loading signals for calculator.', getBackToMenuKeyboard());
  }
});

bot.action(/^calc_select_(.+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const signalId = ctx.match[1];

    const { data: signal, error } = await supabase
      .from('signals')
      .select('*')
      .eq('id', signalId)
      .single();

    if (error || !signal) {
      return ctx.reply('❌ Selected signal not found.', getBackToMenuKeyboard());
    }

    userCalcSessions.set(ctx.from.id, {
      step: 'WAITING_ACCOUNT_SIZE',
      signal
    });

    await ctx.editMessageText(
      `📊 *Selected:* \`${signal.pair} (${signal.direction})\`\n` +
      `🎯 *Entry:* \`${signal.entry_price}\` | 🛑 *SL:* \`${signal.stop_loss}\` | 🎯 *TP:* \`${signal.take_profit}\`\n\n` +
      `1️⃣ Please type your **Account Size** in USD (e.g. \`5000\`):`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('« Cancel', 'calc_start')]]) }
    );
  } catch (err) {
    console.error('[CALC_SELECT_ERROR]:', err);
  }
});

bot.on('text', async (ctx, next) => {
  const userId = ctx.from.id;
  const session = userCalcSessions.get(userId);

  if (!session) return next();

  const textInput = ctx.message.text.trim();

  if (session.step === 'WAITING_ACCOUNT_SIZE') {
    const accountSize = parseFloat(textInput);
    if (isNaN(accountSize) || accountSize <= 0) {
      return ctx.reply('⚠️ Please enter Account size (e.g., 5000):');
    }

    session.accountSize = accountSize;
    session.step = 'WAITING_LOT_SIZE';
    userCalcSessions.set(userId, session);

    return ctx.reply(
      `💰 *Account Size Saved:* \`$${accountSize}\`\n\n` +
      `2️⃣ Please type your preferred **Lot Size** (e.g. \`0.01\`, \`0.1\`, or \`1.0\`):`,
      { parse_mode: 'Markdown' }
    );
  }

  if (session.step === 'WAITING_LOT_SIZE') {
    const lotSize = parseFloat(textInput);
    if (isNaN(lotSize) || lotSize <= 0) {
      return ctx.reply('⚠️ Please enter lot size (e.g., 0.1):');
    }

    const { signal, accountSize } = session;
    userCalcSessions.delete(userId);

    const cleanPair = signal.pair.toUpperCase();
    const isGold = cleanPair.includes('XAU');
    const isJpy = cleanPair.includes('JPY');
    const pipMultiplier = isGold ? 10 : isJpy ? 100 : 10000;

    // Calculate Pips
    const slPips = Math.abs(signal.entry_price - signal.stop_loss) * pipMultiplier;
    const tpPips = Math.abs(signal.take_profit - signal.entry_price) * pipMultiplier;

    let dollarPerPipPerStandardLot = isGold ? 1 : 10; 
    
    // Total Risk and Profit calculations
    const totalDollarRisk = slPips * lotSize * dollarPerPipPerStandardLot;
    const totalDollarProfit = tpPips * lotSize * dollarPerPipPerStandardLot;
    
    const riskPercentage = (totalDollarRisk / accountSize) * 100;
    const rewardPercentage = (totalDollarProfit / accountSize) * 100;
    const riskRewardRatio = (tpPips / (slPips || 1)).toFixed(2);

    const summaryMsg = `
🧮 <b>RISK & PROFIT CALCULATION RESULT</b>
━━━━━━━━━━━━━━━━━━━
📈 <b>Pair:</b> <code>${signal.pair} (${signal.direction})</code>
💰 <b>Account Size:</b> <code>$${accountSize.toLocaleString()}</code>
📊 <b>Lot Size:</b> <code>${lotSize}</code>
⚖️ <b>Risk : Reward:</b> <code>1 : ${riskRewardRatio}</code>
━━━━━━━━━━━━━━━━━━━
🛑 <b>Stop Loss:</b> <code>${slPips.toFixed(1)} Pips</code>
💵 <b>Total Dollar Risk:</b> <code>-$${totalDollarRisk.toFixed(2)} (${riskPercentage.toFixed(2)}%)</code>

🎯 <b>Take Profit:</b> <code>${tpPips.toFixed(1)} Pips</code>
🚀 <b>Potential Dollar Profit:</b> <code>+$${totalDollarProfit.toFixed(2)} (+${rewardPercentage.toFixed(2)}%)</code>
━━━━━━━━━━━━━━━━━━━
<i>Trade wisely and stick to your risk rules! 🛡️</i>
    `.trim();

    return ctx.reply(summaryMsg, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🧮 Calculate Another', 'calc_start')],
        [Markup.button.callback('🏠 Back to Main Menu', 'back_to_menu')]
      ])
    });
  }

  return next();
});

// --- Home / Main Menu Callback Handler ---
bot.action('back_to_menu', async (ctx) => {
  await ctx.answerCbQuery();
  userCalcSessions.delete(ctx.from.id);
  await ctx.reply(
    '🚀 *Hoba Labs Main Menu*\n\nChoose an option below:',
    {
      parse_mode: 'Markdown',
      ...getMainMenuKeyboard()
    }
  );
});

// Internal Broadcast Webhook helper
export async function sendDirectTelegramMessage(chatId, message) {
  try {
    await bot.telegram.sendMessage(chatId, message, { parse_mode: 'HTML' });
    return true;
  } catch (err) {
    return false;
  }
}

// Launch the bot & start background trade monitor worker
bot.launch().then(() => {
  console.log('🤖 Hoba Labs Telegram Bot is running with Risk/Reward Profit Calculator...');
  
  setInterval(() => {
    monitorOpenTrades();
  }, 60000);
  console.log('📈 Trade Monitor Worker initialized...');
}).catch((err) => {
  console.error('Telegram bot startup error:', err);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

export default bot;
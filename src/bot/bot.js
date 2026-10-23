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
// --- Subscription Status Check Handler ---
const handleSubscriptionCheck = async (ctx) => {
  const telegramId = ctx.from.id.toString();

  try {
    const { data: subscriptions, error } = await supabase
      .from('subscriptions')
      .select('id, status, trial_ends_at, current_period_end, plan_type, amount, users!subscriptions_user_id_fkey ( id, telegram_id, username, email )');

    if (error || !subscriptions || subscriptions.length === 0) {
      return ctx.reply('❌ No subscriptions found. Please use /start to link your account.', getBackToMenuKeyboard());
    }

    const userSub = subscriptions.find(sub => sub.users?.telegram_id?.toString() === telegramId);

    if (!userSub) {
      return ctx.reply('❌ No web account linked to this Telegram ID. Please use /start to link your account.', getBackToMenuKeyboard());
    }

    const expiryField = userSub.current_period_end || userSub.trial_ends_at;
    const expiryDate = expiryField ? new Date(expiryField) : null;
    const now = new Date();
    
    let status = (userSub.status || 'inactive').toLowerCase();
    let isTimeValid = expiryDate ? expiryDate > now : false;

    // Auto-sync status to expired in database if time has elapsed
    if (['active', 'trialing'].includes(status) && !isTimeValid) {
      status = 'expired';
      await supabase.from('subscriptions').update({ status: 'expired' }).eq('id', userSub.id);
    }

    const isActive = ['active', 'trialing'].includes(status) && isTimeValid;
    
    let expiryText = 'N/A';
    let diffDays = null;

    if (expiryDate) {
      expiryText = expiryDate.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
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

    // Uses <b> tags with HTML mode so usernames with underscores (@Zureck_Trade) won't break formatting
    const responseText = `<b>Account Status Summary</b>\n\n` +
      `• <b>Username:</b> @${userSub.users?.username || 'Linked'}\n` +
      `• <b>Plan:</b> ${(userSub.plan_type || 'Free Trial').toUpperCase()}\n` +
      `• <b>Amount:</b> $${Number(userSub.amount || 0).toFixed(2)}\n` +
      `• <b>Status:</b> ${status.toUpperCase()} ${isActive ? '🟢' : '🔴'}\n` +
      `• <b>Expires On:</b> ${expiryText}`;

    await ctx.reply(responseText, { parse_mode: 'HTML', ...getBackToMenuKeyboard() });
  } catch (err) {
    console.error('[TELEGRAM_STATUS_ERROR]:', err);
    await ctx.reply('⚠️ Error fetching subscription status. Please try again later.', getBackToMenuKeyboard());
  }
};

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
      return ctx.reply('📭 No transaction history found for your Account.', getBackToMenuKeyboard());
    }

    let historyMessage = `📜 *YOUR SUBSCRIPTION HISTORY*\n━━━━━━━━━━━━━━━━━━━\n\n`;

    historyList.forEach((item, index) => {
      const startDate = new Date(item.period_start).toLocaleDateString();
      const endDate = new Date(item.period_end).toLocaleDateString();
      historyMessage += `${index + 1}. *Plan:* \`${item.plan_type || item.plan_key || 'Standard'}\`\n` +
        `   • *Amount:* \`₦${Number(item.amount).toFixed(2)}\`\n` +
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

// --- View Signals Handler (Secured with Real-Time Expiry Check) ---
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
      .select('status, current_period_end, trial_ends_at')
      .eq('user_id', userRecord.id)
      .single();

    const status = (subscription?.status || '').toLowerCase();
    const expiryField = subscription?.current_period_end || subscription?.trial_ends_at;
    const isTimeValid = expiryField ? new Date(expiryField) > new Date() : false;

    if (!['active', 'trialing'].includes(status) || !isTimeValid) {
      return ctx.reply('🔒 Access Denied. Your subscription has expired or is inactive. Please renew your plan.', getBackToMenuKeyboard());
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
      `1️⃣ Please type your **Account Size** in USD (e.g. \`200\`):`,
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
      return ctx.reply('⚠️ Please enter a valid Account Size (e.g., 200):');
    }

    session.accountSize = accountSize;
    session.step = 'WAITING_RISK_PERCENT';
    userCalcSessions.set(userId, session);

    return ctx.reply(
      `💰 *Account Size Saved:* \`$${accountSize}\`\n\n` +
      `2️⃣ Please type your preferred **Risk Percentage** (e.g. \`1\` for 1%, or \`5\`):`,
      { parse_mode: 'Markdown' }
    );
  }

  if (session.step === 'WAITING_RISK_PERCENT') {
    const riskPercent = parseFloat(textInput);
    if (isNaN(riskPercent) || riskPercent <= 0 || riskPercent > 100) {
      return ctx.reply('⚠️ Please enter a valid risk percentage (e.g., 1 or 2):');
    }

    const { signal, accountSize } = session;
    userCalcSessions.delete(userId);

    const cleanPair = signal.pair.toUpperCase();
    const isGold = cleanPair.includes('XAU');
    const isJpy = cleanPair.includes('JPY');
    const pipMultiplier = isGold ? 10 : isJpy ? 100 : 10000;

    const slPips = Math.abs(signal.entry_price - signal.stop_loss) * pipMultiplier;
    const allowedRiskAmount = accountSize * (riskPercent / 100);
    const pipValuePerStandardLot = isGold ? 1 : 10; 

    let exactLots = allowedRiskAmount / (slPips * pipValuePerStandardLot * 10);
    let suggestedLot = Math.max(0.01, parseFloat(exactLots.toFixed(2)));

    const actualRiskAmount = suggestedLot * slPips * pipValuePerStandardLot * 10;
    const actualRiskPercent = (actualRiskAmount / accountSize) * 100;
    
    const profitAtTp = actualRiskAmount * 2.5;
    const profitAtBe = actualRiskAmount * 1.0;

    const isDangerous = actualRiskPercent > 2.0;

    const headerBlock = isDangerous
      ? `🟥 <b>DANGER:</b> ${suggestedLot} lot = ${actualRiskPercent.toFixed(1)}% risk. You will blow this account.\n\n✅ <b>Prop-Safe Suggestion:</b>`
      : `✅ <b>Prop-Safe Evaluation:</b>`;

    const accentLine = '━━━━━━━━━━━━━━━━━━━';

    const summaryMsg = `
${headerBlock}
${accentLine}
<b>Account:</b> $${accountSize} | <b>Risk:</b> ${riskPercent}% | <b>Lot:</b> <code>${suggestedLot}</code>
• <b>Loss if SL:</b> -$${actualRiskAmount.toFixed(2)} (${actualRiskPercent.toFixed(1)}%)
• <b>Profit if TP:</b> +$${profitAtTp.toFixed(2)} (2.5%)
• <b>Profit if BE:</b> +$${profitAtBe.toFixed(2)}
${accentLine}
Use ${suggestedLot} lot?
    `.trim();

    const advisorMsg = isDangerous
      ? `💡 <b>RISK ADVISOR:</b> Most funded accounts enforce strict drawdown rules. Risking more than 2% per trade on a $${accountSize} account leaves zero margin for error. Scale down your lot size to protect your capital.`
      : `💡 <b>RISK ADVISOR:</b> Clean risk profile. Sub-2% exposure aligns with institutional expectancy frameworks. Execute with discipline.`;

    await ctx.reply(summaryMsg, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback(`✅ Yes, use ${suggestedLot}`, `calc_start`),
          Markup.button.callback('🧮 Calculate again', 'calc_start')
        ],
        [Markup.button.callback('🏠 Back to Main Menu', 'back_to_menu')]
      ])
    });

    return ctx.reply(advisorMsg, { parse_mode: 'HTML' });
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
  console.log('🤖 Hoba Labs Telegram Bot is running with Prop-Safe Risk Calculator...');
  
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
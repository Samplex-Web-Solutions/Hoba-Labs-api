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

// --- /start command ---
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
        `Welcome back, ${firstName}! 🚀\n\nManage your trading account`,
        Markup.inlineKeyboard([
          [Markup.button.webApp('📊 Open Dashboard', `${FRONTEND_URL}/dashboard`)],
          [Markup.button.callback('📈 Latest Signals', 'view_signals')],
          [Markup.button.callback('📅 Economic Calendar', 'view_calendar')],
          [Markup.button.callback('👤 Check Subscription', 'check_subscription')]
        ])
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



// --- /calendar Command Handler ---
const handleEconomicCalendar = async (ctx) => {
    try {
        await ctx.reply('📅 Fetching today\'s economic calendar releases...');
        const events = await fetchTodayCalendar(); // Uses your today calendar service

        if (!events || events.length === 0) {
            return ctx.reply('📭 No economic events scheduled for today.');
        }

        // Limit to top 5-6 events so it doesn't spam the chat
        const topEvents = events.slice(0, 6);

        for (const ev of topEvents) {
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

            await ctx.replyWithMarkdown(msg);
        }
    } catch (err) {
        console.error('[TELEGRAM_CALENDAR_ERROR]:', err);
        await ctx.reply('⚠️ Error fetching economic calendar. Please try again later.');
    }
};

bot.command('calendar', handleEconomicCalendar);
bot.action('view_calendar', async (ctx) => {
    await ctx.answerCbQuery();
    await handleEconomicCalendar(ctx);
});

// --- Subscription Handler ---
const handleSubscriptionCheck = async (ctx) => {
    const telegramId = ctx.from.id.toString();

    try {
        // Query the subscriptions table and join the users table relation
        const { data: subscriptions, error } = await supabase
            .from('subscriptions')
            .select('status, trial_ends_at, current_period_end, plan_name, users!subscriptions_user_id_fkey ( telegram_id, username, email )')
            .in('status', ['active', 'trialing']);

        if (error || !subscriptions || subscriptions.length === 0) {
            return ctx.reply('❌ No active subscriptions found. Please use /start to link your account.');
        }

        // Find the subscription matching the current user's Telegram ID from the joined users table
        const userSub = subscriptions.find(sub => sub.users?.telegram_id?.toString() === telegramId);

        if (!userSub) {
            return ctx.reply('❌ No web account linked to this Telegram ID. Please use /start to link your account.');
        }

        const status = (userSub.status || 'inactive').toLowerCase();
        const isActive = ['active', 'trialing'].includes(status);
        
        // Determine expiration date (use current_period_end or fallback to trial_ends_at)
        const expiryField = userSub.current_period_end || userSub.trial_ends_at;
        
        let expiryText = 'N/A';
        let diffDays = null;

        if (expiryField) {
            const expiryDate = new Date(expiryField);
            expiryText = expiryDate.toLocaleString('en-US', {
                dateStyle: 'medium',
                timeStyle: 'short'
            });

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
            `• *Plan:* ${userSub.plan_name || 'Standard'}\n` +
            `• *Status:* ${status.toUpperCase()} ${isActive ? '🟢' : '🔴'}\n` +
            `• *Expires On:* ${expiryText}`;

        await ctx.replyWithMarkdown(responseText);
    } catch (err) {
        console.error('[TELEGRAM_STATUS_ERROR]:', err);
        await ctx.reply('⚠️ Error fetching subscription status. Please try again later.');
    }
};;

bot.command('status', handleSubscriptionCheck);
bot.action('check_subscription', async (ctx) => {
    await ctx.answerCbQuery();
    await handleSubscriptionCheck(ctx);
});

// --- View Signals Handler ---
const handleViewSignals = async (ctx) => {
    const telegramId = ctx.from.id.toString();

    try {
        const { data: user } = await supabase
            .from('users')
            .select('subscription_status')
            .eq('telegram_id', telegramId)
            .single();

        const status = (user?.subscription_status || '').toLowerCase();
        if (!['active', 'trialing'].includes(status)) {
            return ctx.reply('🔒 Access Denied. Your subscription is not active.');
        }

        const { data: signals, error } = await supabase
            .from('signals')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(3);

        if (error || !signals || signals.length === 0) {
            return ctx.reply('📭 No active signals available at the moment.');
        }

        for (const sig of signals) {
            const msg = ` *${sig.pair}* — *${sig.direction}*\n\n` +
                `🎯 *Entry:* ${sig.entry_price}\n` +
                `🛑 *SL:* ${sig.stop_loss}\n` +
                `💰 *TP:* ${sig.take_profit}\n` +
                `⏱️ *Time:* ${new Date(sig.created_at).toLocaleString()}`;
            
            await ctx.replyWithMarkdown(msg);
        }
    } catch (err) {
        console.error('[TELEGRAM_SIGNALS_ERROR]:', err);
        await ctx.reply('⚠️ Error fetching recent signals.');
    }
};

bot.command('signals', handleViewSignals);
bot.action('view_signals', async (ctx) => {
    await ctx.answerCbQuery();
    await handleViewSignals(ctx);
});

// Internal Broadcast Webhook helper (called by tradeMonitorService)
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
  console.log('🤖 Hoba Labs Telegram Bot is running...');
  
  // Start Trade Lifecycle Monitor Worker every 30 seconds
  setInterval(() => {
    monitorOpenTrades();
  }, 60000);
  console.log('📈 Trade Monitor Worker initialized with Biquote feed...');
}).catch((err) => {
  console.error('Telegram bot startup error:', err);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

export default bot;










// import dotenv from 'dotenv';
// import { Telegraf, Markup } from 'telegraf';
// import axios from 'axios';
// import { supabase } from '../config/supabase.js';

// dotenv.config();

// const token = process.env.TELEGRAM_BOT_TOKEN;
// const BACKEND_URL = process.env.BACKEND_URL;
// const FRONTEND_URL = process.env.FRONTEND_URL;
// const INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET;

// if (!token) {
//   console.error('❌ TELEGRAM_BOT_TOKEN is missing in your .env field!');
// }
// if (!INTERNAL_SERVICE_SECRET) {
//   console.error('❌ INTERNAL_SERVICE_SECRET is missing — the bot will not be able to call the backend.');
// }

// // Initialize Telegraf bot instance
// const bot = new Telegraf(token);

// // --- /start command ---
// bot.start(async (ctx) => {
//   const telegramId = ctx.from?.id;
//   const firstName = ctx.from?.first_name || 'Trader';
//   const username = ctx.from?.username || '';

//   if (!telegramId) return;

//   try {
//     // Check backend if this telegram_id is already linked
//     const response = await axios.post(
//       `${BACKEND_URL}/api/auth/telegram-login`,
//       { telegram_id: telegramId },
//       { headers: { 'x-internal-secret': INTERNAL_SERVICE_SECRET } }
//     );

//     if (response.data.success) {
//       await ctx.reply(
//         `Welcome back, ${firstName}! 🚀\n\nChoose an action below to manage your institutional trading account or view signals.`,
//         Markup.inlineKeyboard([
//           [Markup.button.webApp('📊 Open Dashboard', `${FRONTEND_URL}/dashboard`)],
//           [Markup.button.callback('📡 Latest Signals', 'view_signals')],
//           [Markup.button.callback('👤 Check Subscription', 'check_subscription')]
//         ])
//       );
//     }
//   } catch (err) {
//     // If not linked, prompt them to link their web account
//     await ctx.reply(
//       `Welcome to Hoba Labs, ${firstName}! 🛡️\n\nTo use this platform, you must first link your web account.`,
//       Markup.inlineKeyboard([
//         [Markup.button.webApp('🔗 Link Web Account', `${FRONTEND_URL}/link-telegram?telegram_id=${telegramId}&username=${username}`)]
//       ])
//     );
//   }
// });

// // --- Check Subscription Handler (with Expiration Date) ---
// const handleSubscriptionCheck = async (ctx) => {
//     const telegramId = ctx.from.id.toString();

//     try {
//         // Fetch subscription details including expiration column
//         // (Note: Adjust 'subscription_expires_at' if your database column has a different name like 'expires_at' or 'trial_ends_at')
//         const { data: user, error } = await supabase
//             .from('users')
//             .select('subscription_status, subscription_plan, email, subscription_expires_at')
//             .eq('telegram_id', telegramId)
//             .single();

//         if (error || !user) {
//             return ctx.reply('❌ No web account linked to this Telegram ID. Please use /start to link your account.');
//         }

//         const status = (user.subscription_status || 'inactive').toLowerCase();
//         const isActive = ['active', 'trialing'].includes(status);
        
//         let expiryText = 'N/A';
//         if (user.subscription_expires_at) {
//             const expiryDate = new Date(user.subscription_expires_at);
//             expiryText = expiryDate.toLocaleString('en-US', {
//                 dateStyle: 'medium',
//                 timeStyle: 'short'
//             });

//             // Calculate remaining days if active/trialing
//             const now = new Date();
//             const diffTime = expiryDate - now;
//             const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
//             if (diffDays > 0) {
//                 expiryText += ` (${diffDays} day${diffDays === 1 ? '' : 's'} remaining)`;
//             } else if (diffDays === 0) {
//                 expiryText += ` (Expires Today!)`;
//             } else {
//                 expiryText += ` (Expired)`;
//             }
//         }

//         const responseText = `*Account Status Summary*\n\n` +
//             `• *Email:* ${user.email || 'Linked'}\n` +
//             `• *Plan:* ${user.subscription_plan || 'Standard'}\n` +
//             `• *Status:* ${status.toUpperCase()} ${isActive ? '🟢' : '🔴'}\n` +
//             `• *Expires On:* ${expiryText}`;

//         await ctx.replyWithMarkdown(responseText);
//     } catch (err) {
//         console.error('[TELEGRAM_STATUS_ERROR]:', err);
//         await ctx.reply('⚠️ Error fetching subscription status. Please try again later.');
//     }
// };

// bot.command('status', handleSubscriptionCheck);
// bot.action('check_subscription', async (ctx) => {
//     await ctx.answerCbQuery();
//     await handleSubscriptionCheck(ctx);
// });

// // --- View Recent Signals Handler ---
// const handleViewSignals = async (ctx) => {
//     const telegramId = ctx.from.id.toString();

//     try {
//         const { data: user } = await supabase
//             .from('users')
//             .select('subscription_status')
//             .eq('telegram_id', telegramId)
//             .single();

//         const status = (user?.subscription_status || '').toLowerCase();
//         if (!['active', 'trialing'].includes(status)) {
//             return ctx.reply('🔒 Access Denied. Your subscription is not active.');
//         }

//         const { data: signals, error } = await supabase
//             .from('signals')
//             .select('*')
//             .order('created_at', { ascending: false })
//             .limit(3);

//         if (error || !signals || signals.length === 0) {
//             return ctx.reply('📭 No active signals available at the moment.');
//         }

//         for (const sig of signals) {
//             const msg = `🚨 *${sig.pair}* — *${sig.bias}*\n\n` +
//                 `🎯 *Entry:* ${sig.entryPrice}\n` +
//                 `🛑 *SL:* ${sig.stopLoss}\n` +
//                 `💰 *TP:* ${sig.takeProfit}\n` +
//                 `⏱️ *Time:* ${new Date(sig.created_at).toLocaleString()}`;
            
//             await ctx.replyWithMarkdown(msg);
//         }
//     } catch (err) {
//         console.error('[TELEGRAM_SIGNALS_ERROR]:', err);
//         await ctx.reply('⚠️ Error fetching recent signals.');
//     }
// };

// bot.command('signals', handleViewSignals);
// bot.action('view_signals', async (ctx) => {
//     await ctx.answerCbQuery();
//     await handleViewSignals(ctx);
// });

// // Launch the bot
// bot.launch().then(() => {
//   console.log('🤖 Hoba Labs Telegram Bot is running with expiration tracking...');
// }).catch((err) => {
//   console.error('Telegram bot startup error:', err);
// });

// // Enable graceful stop
// process.once('SIGINT', () => bot.stop('SIGINT'));
// process.once('SIGTERM', () => bot.stop('SIGTERM'));

// export default bot;
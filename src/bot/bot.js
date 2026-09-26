import dotenv from 'dotenv';
import { Telegraf } from 'telegraf';
import axios from 'axios';

// Configure env vars here too (not just in server.js) so this file works
// correctly regardless of import order or if it's ever run standalone.
dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';
const FRONTEND_URL = process.env.FRONTEND_URL;
const INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET;

if (!token) {
  console.error('❌ TELEGRAM_BOT_TOKEN is missing in your .env file!');
}
if (!INTERNAL_SERVICE_SECRET) {
  console.error('❌ INTERNAL_SERVICE_SECRET is missing — the bot will not be able to call the backend.');
}

// Initialize Telegraf bot instance
const bot = new Telegraf(token);

console.log('🤖 Hoba Labs Telegram Bot is running...');

// Handle /start command
bot.start(async (ctx) => {
  const telegramId = ctx.from?.id;
  const firstName = ctx.from?.first_name || 'Trader';
  const username = ctx.from?.username || '';

  if (!telegramId) return;

  try {
    // Check backend if this telegram_id is already linked.
    // This call is authenticated with a shared secret — it's an internal,
    // server-to-server route, not something a public client should reach.
    const response = await axios.post(
      `${BACKEND_URL}/api/auth/telegram-login`,
      { telegram_id: telegramId },
      { headers: { 'x-internal-secret': INTERNAL_SERVICE_SECRET } }
    );

    if (response.data.success) {
      await ctx.reply(
        `Welcome back, ${firstName}! 🚀\n\nYour account is linked. Tap below to launch your Hoba Labs Trading Dashboard.`,
        {
          reply_markup: {
            inline_keyboard: [[
              { text: '📊 Open Dashboard', web_app: { url: `${FRONTEND_URL}/dashboard` } }
            ]]
          }
        }
      );
    }
  } catch (err) {
    // If not linked, prompt them to link their web account
    await ctx.reply(
      `Welcome to Hoba Labs, ${firstName}! 🛡️\n\nTo use this platform, you must first have a registered web account.\n\nPlease link your account using your web credentials just once.`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '🔗 Link Web Account', web_app: { url: `${FRONTEND_URL}/link-telegram?telegram_id=${telegramId}&username=${username}` } }
          ]]
        }
      }
    );
  }
});

// Launch the bot (Telegraf handles polling and webhook clearing automatically)
bot.launch().then(() => {
  console.log('✅ Telegraf bot polling active.');
}).catch((err) => {
  console.error('Telegram bot startup error:', err);
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

export default bot;

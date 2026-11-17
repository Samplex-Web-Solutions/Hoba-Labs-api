import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';

// Route Imports
import authRoutes from './src/routes/authRoutes.js';
import subscriptionRoutes from './src/routes/subscriptionRoutes.js';
import webhookRoutes from './src/routes/webhookRoutes.js';
import iccRoutes from './src/routes/iccRoutes.js';
import signalRoutes from './src/routes/signalRoutes.js';

// EA & Broker Routes
import executionRoutes from './src/routes/executionRoutes.js';
import tradeRoutes from './src/routes/tradeRoutes.js';
import brokerRoutes from './src/routes/brokerRoutes.js';
import licenseRoutes from './src/routes/licenseRoutes.js';

// Admin Routes Import
import adminRoutes from './src/routes/adminRoutes.js';

// Telegram & Services Imports
import bot, { sendDirectTelegramMessage } from './src/bot/bot.js';
import { fetchTodayCalendar } from './src/services/news/newsService.js';
import { monitorOpenTrades } from './src/services/monitor/tradeMonitorService.js';

// Autonomous Scanner Worker Initializer
import './src/workers/scannerWorker.js';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({
  verify: (req, res, buf) => {
    if (req.originalUrl.startsWith('/api/webhook')) {
      req.rawBody = buf.toString();
    }
  }
}));

// Main Route Mounting
app.use('/api/auth', authRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/v1/icc', iccRoutes);
app.use('/api/signals', signalRoutes);
app.use('/api/execution', executionRoutes);
app.use('/api/trades', tradeRoutes);
app.use('/api/broker', brokerRoutes);
app.use('/api/license', licenseRoutes);
app.use('/api/admin', adminRoutes); // <-- Mounted successfully!

// Calendar Endpoint
app.get('/api/calendar/today', async (req, res) => {
  try {
    const events = await fetchTodayCalendar();
    res.json({ success: true, data: events });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch today's calendar" });
  }
});

// Telegram Broadcast Endpoint
app.post('/api/telegram/broadcast', async (req, res) => {
  const internalSecret = req.headers['x-internal-secret'];
  if (internalSecret !== process.env.INTERNAL_SERVICE_SECRET) {
    return res.status(403).json({ success: false, message: 'Unauthorized internal request' });
  }

  const { chat_id, message } = req.body;
  if (!chat_id || !message) {
    return res.status(400).json({ success: false, message: 'Missing chat_id or message' });
  }

  const sent = await sendDirectTelegramMessage(chat_id, message);
  res.json({ success: sent });
});

// Health Check Root Endpoint
app.get('/', (req, res) => {
  res.status(200).json({ status: 'online', service: 'Hoba Labs Backend API' });
});

// Trade Lifecycle Monitor (Interval: 30 seconds)
setInterval(() => {
  monitorOpenTrades();
}, 30000);
console.log('📈 Trade Lifecycle Monitor Worker Active 🚀');

const PORT = process.env.PORT || 1999;
app.listen(PORT, () => console.log(`Hoba Labs backend running on port ${PORT} - Autonomous Scanner Active 🚀`));
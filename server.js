import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import authRoutes from './src/routes/authRoutes.js';
import subscriptionRoutes from './src/routes/subscriptionRoutes.js';
import webhookRoutes from './src/routes/webhookRoutes.js';
import bot from './src/bot/bot.js';
import iccRoutes from './src/routes/iccRoutes.js';
import signalRoutes from './src/routes/signalRoutes.js';

// Import your autonomous background scanner worker here
import './src/workers/scannerWorker.js';
import { fetchTodayCalendar } from './src/services/news/newsService.js';
import { monitorOpenTrades } from './src/services/monitor/tradeMonitorService.js';
import { sendDirectTelegramMessage } from './src/bot/bot.js';






dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// Main Route Mounting
app.use('/api/auth', authRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/v1/icc', iccRoutes);
app.use('/api/signals', signalRoutes);
app.get('/api/calendar/today', async (req, res) => {
  try {
    const events = await fetchTodayCalendar();
    res.json({ success: true, data: events });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch today\'s calendar' });
  }
});


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

app.get('/', (req, res) => {
    res.status(200).json({ status: 'online', service: 'Hoba Labs Backend API' });
});

setInterval(() => {
  monitorOpenTrades();
}, 30000);
console.log('📈 Trade Lifecycle Monitor Worker Active 🚀');

const PORT = process.env.PORT || 1999;
app.listen(PORT, () => console.log(`Hoba Labs backend running on port ${PORT} - Autonomous Scanner Active 🚀`));
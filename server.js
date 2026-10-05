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

app.get('/', (req, res) => {
    res.status(200).json({ status: 'online', service: 'Hoba Labs Backend API' });
});

const PORT = process.env.PORT || 1999;
app.listen(PORT, () => console.log(`Hoba Labs backend running on port ${PORT} - Autonomous Scanner Active 🚀`));
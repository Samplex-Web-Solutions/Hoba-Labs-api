import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import authRoutes from './src/routes/authRoutes.js';
import bot from './src/bot/bot.js';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// Mount authentication routes under /api/auth
app.use('/api/auth', authRoutes);

// Health check
app.get('/', (req, res) => {
    res.status(200).json({ status: 'online', service: 'Hoba Labs Backend API' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Hoba Labs backend running on port ${PORT}`));
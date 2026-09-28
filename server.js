import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import authRoutes from './src/routes/authRoutes.js';
import bot from './src/bot/bot.js';
import iccRoutes from './src/routes/iccRoutes.js'; // Import your ICC routes

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/v1/icc', iccRoutes);


app.get('/', (req, res) => {
    res.status(200).json({ status: 'online', service: 'Hoba Labs Backend API' });
});

const PORT = process.env.PORT ;
app.listen(PORT, () => console.log(`Hoba Labs backend running on port ${PORT}`));
require('dotenv').config(); // Essential: Loads environment variables from your .env file
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws'); // Required for Supabase Realtime support on Node.js < 22
const verifyTelegramWebAppData = require('./Middleware/authMiddleware');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Supabase Client with Service Role and WebSocket transport fix
const supabase = createClient(
    process.env.SUPABASE_URL, 
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
        auth: { persistSession: false },
        realtime: { transport: ws }
    }
);

// Health check endpoint
app.get('/', (req, res) => {
    res.status(200).json({ status: 'online', service: 'Hoba Labs Backend API' });
});

// Endpoint called by the Mini App upon startup for authentication & profile sync
const generateClientId = () => {
    const randomNum = Math.floor(100000 + Math.random() * 900000);
    return `HOBA-${randomNum}`;
};

// Endpoint called by the Mini App upon startup for authentication & profile sync
app.post('/api/auth/sync', verifyTelegramWebAppData, async (req, res) => {
    const { id: telegram_id, username, first_name, last_name } = req.telegramUser;

    try {
        let { data: existingUser, error: fetchError } = await supabase
            .from('users')
            .select('*')
            .eq('telegram_id', telegram_id)
            .single();

        let userId;

        if (!existingUser) {
            // Generate a unique client ID for the new trader
            const client_id = generateClientId();

            // Insert new user with client_id and onboarding state
            const { data: newUser, error: insertError } = await supabase
                .from('users')
                .upsert([{ 
                    telegram_id, 
                    username, 
                    first_name, 
                    last_name, 
                    client_id,
                    onboarding_completed: false 
                }])
                .select()
                .single();

            if (insertError) throw insertError;
            userId = newUser.id;
            existingUser = newUser;

            // Automatically provision a 3-day free trial subscription record
            const { error: subError } = await supabase
                .from('subscriptions')
                .insert([{ user_id: userId, status: 'trialing', plan_type: 'trial' }]);

            if (subError) throw subError;
        } else {
            userId = existingUser.id;
            
            // Fallback: if an older user doesn't have a client_id yet, generate one on-the-fly
            if (!existingUser.client_id) {
                const client_id = generateClientId();
                const { data: updatedUser } = await supabase
                    .from('users')
                    .update({ client_id })
                    .eq('id', userId)
                    .select()
                    .single();
                existingUser = updatedUser;
            }
        }

        // Fetch active subscription status
        const { data: subscription } = await supabase
            .from('subscriptions')
            .select('*')
            .eq('user_id', userId)
            .single();

        return res.status(200).json({
            success: true,
            message: 'User synced successfully',
            user: existingUser,
            subscription: subscription
        });

    } catch (err) {
        console.error('Database sync error:', err);
        return res.status(500).json({ error: 'Internal server error during user synchronization' });
    }
});

// Endpoint to update user's WhatsApp phone number
app.post('/api/user/update-whatsapp', verifyTelegramWebAppData, async (req, res) => {
    const { id: telegram_id } = req.telegramUser;
    const { whatsapp_number } = req.body;

    if (!whatsapp_number) {
        return res.status(400).json({ error: 'WhatsApp number is required' });
    }

    try {
        const { data, error } = await supabase
            .from('users')
            .update({ whatsapp_number })
            .eq('telegram_id', telegram_id)
            .select()
            .single();

        if (error) throw error;

        return res.status(200).json({
            success: true,
            message: 'WhatsApp number updated successfully',
            user: data
        });
    } catch (err) {
        console.error('WhatsApp update error:', err);
        return res.status(500).json({ error: 'Failed to update WhatsApp number' });
    }
});

// Endpoint to mark user's onboarding as completed
app.post('/api/user/complete-onboarding', verifyTelegramWebAppData, async (req, res) => {
    const { id: telegram_id } = req.telegramUser;

    try {
        const { data, error } = await supabase
            .from('users')
            .update({ onboarding_completed: true })
            .eq('telegram_id', telegram_id)
            .select()
            .single();

        if (error) throw error;

        return res.status(200).json({
            success: true,
            message: 'Onboarding marked as completed',
            user: data
        });
    } catch (err) {
        console.error('Onboarding completion error:', err);
        return res.status(500).json({ error: 'Failed to update onboarding status' });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Hoba Labs backend running on port ${PORT}`));








// require('dotenv').config(); // Essential: Loads environment variables from your .env file
// const express = require('express');
// const cors = require('cors');
// const { createClient } = require('@supabase/supabase-js');
// const ws = require('ws'); // Required for Supabase Realtime support on Node.js < 22
// const verifyTelegramWebAppData = require('./Middleware/authMiddleware');

// const app = express();

// // Middleware
// app.use(cors());
// app.use(express.json());

// // Initialize Supabase Client with Service Role and WebSocket transport fix
// const supabase = createClient(
//     process.env.SUPABASE_URL, 
//     process.env.SUPABASE_SERVICE_ROLE_KEY,
//     {
//         auth: { persistSession: false },
//         realtime: { transport: ws }
//     }
// );

// // Health check endpoint
// app.get('/', (req, res) => {
//     res.status(200).json({ status: 'online', service: 'Hoba Labs Backend API' });
// });

// // Endpoint called by the Mini App upon startup for authentication & profile sync
// app.post('/api/auth/sync', verifyTelegramWebAppData, async (req, res) => {
//     const { id: telegram_id, username, first_name, last_name } = req.telegramUser;

//     try {
//         // 1. Check if user already exists
//         let { data: existingUser, error: fetchError } = await supabase
//             .from('users')
//             .select('*')
//             .eq('telegram_id', telegram_id)
//             .single();

//         let userId;

//         if (!existingUser) {
//             // 2. Insert new user if they don't exist
//             const { data: newUser, error: insertError } = await supabase
//                 .from('users')
//                 .upsert([{ telegram_id, username, first_name, last_name }])
//                 .select()
//                 .single();

//             if (insertError) throw insertError;
//             userId = newUser.id;
//             existingUser = newUser;

//             // 3. Automatically provision a 3-day free trial subscription record
//             const { error: subError } = await supabase
//                 .from('subscriptions')
//                 .insert([{ user_id: userId, status: 'trialing', plan_type: 'trial' }]);

//             if (subError) throw subError;
//         } else {
//             userId = existingUser.id;
//         }

//         // 4. Fetch active subscription status to return to the frontend
//         const { data: subscription } = await supabase
//             .from('subscriptions')
//             .select('*')
//             .eq('user_id', userId)
//             .single();

//         return res.status(200).json({
//             success: true,
//             message: 'User synced successfully',
//             user: existingUser,
//             subscription: subscription
//         });

//     } catch (err) {
//         console.error('Database sync error:', err);
//         return res.status(500).json({ error: 'Internal server error during user synchronization' });
//     }
// });

// // Endpoint to update user's WhatsApp phone number
// app.post('/api/user/update-whatsapp', verifyTelegramWebAppData, async (req, res) => {
//     const { id: telegram_id } = req.telegramUser;
//     const { whatsapp_number } = req.body;

//     if (!whatsapp_number) {
//         return res.status(400).json({ error: 'WhatsApp number is required' });
//     }

//     try {
//         const { data, error } = await supabase
//             .from('users')
//             .update({ whatsapp_number })
//             .eq('telegram_id', telegram_id)
//             .select()
//             .single();

//         if (error) throw error;

//         return res.status(200).json({
//             success: true,
//             message: 'WhatsApp number updated successfully',
//             user: data
//         });
//     } catch (err) {
//         console.error('WhatsApp update error:', err);
//         return res.status(500).json({ error: 'Failed to update WhatsApp number' });
//     }
// });

// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => console.log(`Hoba Labs backend running on port ${PORT}`));
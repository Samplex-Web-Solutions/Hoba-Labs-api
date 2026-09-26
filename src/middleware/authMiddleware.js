import crypto from 'crypto';

// --- Verifies Telegram Mini App initData (used for anything the FRONTEND calls directly) ---
export const verifyTelegramWebAppData = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No authorization token provided' });
    }

    const initData = authHeader.split(' ')[1];

    // Mock bypass — ONLY available outside production, never in a deployed environment.
    if (process.env.NODE_ENV !== 'production' && initData === 'mock_test_init_data_string') {
        req.telegramUser = {
            id: 999888777,
            username: 'test_trader',
            first_name: 'Samuel',
            last_name: 'Ojiemen'
        };
        return next();
    }

    try {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (!botToken) {
            return res.status(500).json({ error: 'Bot token not configured on server' });
        }

        const urlParams = new URLSearchParams(initData);
        const hash = urlParams.get('hash');

        if (!hash) {
            return res.status(403).json({ error: 'Missing Telegram signature hash' });
        }

        urlParams.delete('hash');

        const dataCheckString = Array.from(urlParams.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => `${key}=${value}`)
            .join('\n');

        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
        const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

        if (calculatedHash !== hash) {
            return res.status(403).json({ error: 'Invalid Telegram signature' });
        }

        // Reject stale initData (older than 24h) to prevent replay of a captured payload.
        const authDate = parseInt(urlParams.get('auth_date'), 10);
        const MAX_AGE_SECONDS = 24 * 60 * 60;
        if (!authDate || Date.now() / 1000 - authDate > MAX_AGE_SECONDS) {
            return res.status(403).json({ error: 'Telegram signature has expired, please reopen the app' });
        }

        const rawUser = urlParams.get('user');
        if (!rawUser) {
            return res.status(400).json({ error: 'User data missing from initData' });
        }

        req.telegramUser = JSON.parse(rawUser);
        next();
    } catch (err) {
        console.error('Auth middleware error:', err);
        return res.status(403).json({ error: 'Authentication failed' });
    }
};

// --- Verifies server-to-server calls (e.g. bot.js calling the backend directly) ---
// Not a substitute for real auth — just proves the caller holds a shared secret
// so this internal route isn't reachable by an arbitrary public client.
export const verifyInternalService = (req, res, next) => {
    const secret = req.headers['x-internal-secret'];

    if (!process.env.INTERNAL_SERVICE_SECRET) {
        console.error('INTERNAL_SERVICE_SECRET is not set — refusing internal request.');
        return res.status(500).json({ error: 'Server misconfigured' });
    }

    if (secret !== process.env.INTERNAL_SERVICE_SECRET) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    next();
};

export default verifyTelegramWebAppData;

import crypto from 'crypto';
import { verifyToken } from '../utils/token.js';

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

// --- Requires a logged-in web session (JWT from login/register) ---
// On success, sets req.userId — always derive the user from THIS, never from
// a userId the client puts in the request body, or anyone could pass a
// different id and act as another user.
export const verifyJWT = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No authorization token provided' });
    }

    try {
        req.userId = verifyToken(authHeader.split(' ')[1]);
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired session, please log in again.' });
    }
};

// --- Same as verifyJWT, but doesn't fail if there's no token ---
// Used for routes that behave differently depending on whether the caller
// already has a session (e.g. linking Telegram: skip the password re-check
// if they're already logged in, otherwise require phone+password).
export const attachUserIfPresent = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
            req.userId = verifyToken(authHeader.split(' ')[1]);
        } catch (err) {
            // Invalid/expired token — treat as "not logged in" rather than erroring,
            // since this route has a valid fallback path (phone + password).
        }
    }

    next();
};

export default verifyTelegramWebAppData;

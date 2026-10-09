import cron from 'node-cron';
import axios from 'axios';
import { calculateOrderBlocks } from '../utils/orderBlock/orderBlockDetector.js';
import { evaluateIccSetup } from '../icc/engine/engine.js';
import { dispatchAndLogSignal } from '../services/icc/iccNotificationService.js';
import { supabase } from '../config/supabase.js';

const TARGET_PAIRS = ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'NZDUSD', 'USDCHF'];
const recentSignalsMap = new Map();
const COOLDOWN_PERIOD_MS = 2 * 60 * 60 * 1000; 

cron.schedule('*/5 * * * *', async () => {
  console.log('[Scanner Worker] Running multi-timeframe market scan...');

  try {
    for (const pair of TARGET_PAIRS) {
      const htfResponse = await axios.get(`https://biquote.io/api/${pair}/ohlc`, { params: { interval: '1h', limit: 50 } });
      const htfBars = htfResponse.data?.bars || htfResponse.data;

      const ltfResponse = await axios.get(`https://biquote.io/api/${pair}/ohlc`, { params: { interval: '5m', limit: 50 } });
      const ltfBars = ltfResponse.data?.bars || ltfResponse.data;

      if (!Array.isArray(htfBars) || htfBars.length < 20 || !Array.isArray(ltfBars) || ltfBars.length < 20) continue;

      const activeAois = calculateOrderBlocks(htfBars);
      const signal = evaluateIccSetup(pair, htfBars, ltfBars, activeAois);

      if (signal) {
        const lastDispatchedTime = recentSignalsMap.get(pair) || 0;
        const now = Date.now();

        if (now - lastDispatchedTime < COOLDOWN_PERIOD_MS) continue;

        // --- PROFESSIONAL PROXIMITY CHECK ---
        // Fetch current live price right now to ensure we aren't broadcasting a stale/passed entry zone
        const liveTickRes = await axios.get(`https://biquote.io/api/${pair.toUpperCase()}`).catch(() => null);
        const livePrice = liveTickRes?.data?.mid || liveTickRes?.data?.price || liveTickRes?.data?.last;

        if (livePrice) {
          const isBullish = signal.direction === 'BULLISH' || signal.direction === 'BUY';
          const cleanPair = pair.toUpperCase();
          const pipMult = cleanPair.includes('XAU') ? 10 : cleanPair.includes('JPY') ? 100 : 10000;
          const distancePips = Math.abs(livePrice - signal.entry_price) * pipMult;

          // If price is already more than 15 pips away from entry, the setup missed its window or already ran
          if (distancePips > 25) {
            console.log(`[Scanner Worker] Skipped ${pair}: Live price is too far (${distancePips.toFixed(1)} pips) from entry zone.`);
            continue;
          }
        }

        const { data: existingSignals } = await supabase
          .from('signals')
          .select('id, created_at')
          .eq('pair', pair)
          .eq('status', 'PENDING')
          .order('created_at', { ascending: false })
          .limit(1);

        if (existingSignals && existingSignals.length > 0) {
          if (now - new Date(existingSignals[0].created_at).getTime() < COOLDOWN_PERIOD_MS) continue;
        }

        console.log(`[Scanner Worker] Valid Setup found for ${pair}! Dispatching signal...`);
        recentSignalsMap.set(pair, now);
        await dispatchAndLogSignal(signal);
      }
    }
  } catch (error) {
    console.error(`[Scanner Worker] Automated scan error: ${error.message}`);
  }
});






// import cron from 'node-cron';
// import axios from 'axios';
// import { calculateOrderBlocks } from '../utils/orderBlock/orderBlockDetector.js';
// import { evaluateIccSetup } from '../icc/engine/engine.js';
// import { dispatchAndLogSignal } from '../services/icc/iccNotificationService.js';
// import { supabase } from '../config/supabase.js';

// // Expanded target pairs covering Forex and Crypto markets
// const TARGET_PAIRS = ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'NZDUSD', 'USDCHF'];

// // Keep track of recent alerts to prevent duplicate spamming for the same asset zone (cooldown in ms: e.g., 2 hours)
// const recentSignalsMap = new Map();
// const COOLDOWN_PERIOD_MS = 2 * 60 * 60 * 1000; 

// // Run automated scan every 5 minutes
// cron.schedule('*/5 * * * *', async () => {
//   console.log('[Scanner Worker] Running multi-timeframe market scan (1H Bias + 5m Execution)...');

//   try {
//     for (const pair of TARGET_PAIRS) {
//       // 1. Fetch Higher Timeframe (1H) bars for macro structure, trend bias, and Order Blocks / AOIs
//       const htfResponse = await axios.get(`https://biquote.io/api/${pair}/ohlc`, {
//         params: { interval: '1h', limit: 50 }
//       });
//       const htfBars = htfResponse.data?.bars || htfResponse.data;

//       // 2. Fetch Lower Timeframe (5m) bars for immediate execution confirmation
//       const ltfResponse = await axios.get(`https://biquote.io/api/${pair}/ohlc`, {
//         params: { interval: '5m', limit: 50 }
//       });
//       const ltfBars = ltfResponse.data?.bars || ltfResponse.data;

//       if (!Array.isArray(htfBars) || htfBars.length < 20 || !Array.isArray(ltfBars) || ltfBars.length < 20) {
//         console.warn(`[Scanner Worker] Insufficient bars returned for ${pair}`);
//         continue;
//       }

//       // 3. Calculate Higher Timeframe Order Blocks & Fair Value Gaps (AOIs)
//       const activeAois = calculateOrderBlocks(htfBars);

//       // 4. Run ICC engine evaluation using HTF for bias/AOIs and LTF for confirmation/entry
//       const signal = evaluateIccSetup(pair, htfBars, ltfBars, activeAois);

//       // 5. If setup triggers, check cooldown before dispatching
//       if (signal) {
//         const lastDispatchedTime = recentSignalsMap.get(pair) || 0;
//         const now = Date.now();

//         if (now - lastDispatchedTime < COOLDOWN_PERIOD_MS) {
//           console.log(`[Scanner Worker] Setup found for ${pair}, but skipped due to active cooldown window.`);
//           continue;
//         }

//         // Optional: Double check Supabase to ensure no active pending signal for this pair
//         const { data: existingSignals } = await supabase
//           .from('signals')
//           .select('id, created_at')
//           .eq('pair', pair)
//           .eq('status', 'PENDING')
//           .order('created_at', { ascending: false })
//           .limit(1);

//         if (existingSignals && existingSignals.length > 0) {
//           const lastSignalTime = new Date(existingSignals[0].created_at).getTime();
//           if (now - lastSignalTime < COOLDOWN_PERIOD_MS) {
//             console.log(`[Scanner Worker] Active pending signal already exists in database for ${pair}. Skipping.`);
//             continue;
//           }
//         }

//         console.log(`[Scanner Worker] Valid Multi-Timeframe Setup found for ${pair}! Dispatching signal...`);
        
//         // Update cooldown tracker
//         recentSignalsMap.set(pair, now);

//         // Dispatch signal to database and Telegram
//         await dispatchAndLogSignal(signal);
//       }
//     }
//   } catch (error) {
//     console.error(`[Scanner Worker] Automated scan error: ${error.message}`);
//   }
// });
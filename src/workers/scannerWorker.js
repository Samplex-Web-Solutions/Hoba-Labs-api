import cron from 'node-cron';
import axios from 'axios';
import { calculateOrderBlocks } from '../utils/orderBlock/orderBlockDetector.js';
import { evaluateIccSetup } from '../icc/engine/engine.js';
import { dispatchAndLogSignal } from '../services/icc/iccNotificationService.js';
import { supabase } from '../config/supabase.js';

const TARGET_PAIRS = ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'NZDUSD', 'USDCHF'];
const recentSignalsMap = new Map();
const COOLDOWN_PERIOD_MS = 2 * 60 * 60 * 1000; 

// Run automated scan every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  console.log('[Scanner Worker] Running Top-Down Multi-Timeframe Market Scan (1D ➔ 4H ➔ 1H ➔ 5m)...');

  try {
    for (const pair of TARGET_PAIRS) {
      const cleanPair = pair.toUpperCase().replace('/', '');

      // 1. Fetch Daily (1D) bars for macro institutional market structure
      const dailyRes = await axios.get(`https://biquote.io/api/${cleanPair}/ohlc`, { params: { interval: '1d', limit: 30 } }).catch(() => null);
      const dailyBars = dailyRes?.data?.bars || dailyRes?.data;

      // 2. Fetch 4-Hour (4H) bars for intermediate structure alignment
      const h4Res = await axios.get(`https://biquote.io/api/${cleanPair}/ohlc`, { params: { interval: '4h', limit: 30 } }).catch(() => null);
      const h4Bars = h4Res?.data?.bars || h4Res?.data;

      // 3. Fetch 1-Hour (1H) bars for Order Blocks / AOIs
      const h1Res = await axios.get(`https://biquote.io/api/${cleanPair}/ohlc`, { params: { interval: '1h', limit: 50 } }).catch(() => null);
      const h1Bars = h1Res?.data?.bars || h1Res?.data;

      // 4. Fetch 5-Minute (5m) bars for lower timeframe confirmation and entry execution
      const m5Res = await axios.get(`https://biquote.io/api/${cleanPair}/ohlc`, { params: { interval: '5m', limit: 50 } }).catch(() => null);
      const m5Bars = m5Res?.data?.bars || m5Res?.data;

      if (!Array.isArray(dailyBars) || dailyBars.length < 10 ||
          !Array.isArray(h4Bars) || h4Bars.length < 10 ||
          !Array.isArray(h1Bars) || h1Bars.length < 20 ||
          !Array.isArray(m5Bars) || m5Bars.length < 20) {
        console.warn(`[Scanner Worker] Insufficient multi-timeframe bars returned for ${pair}`);
        continue;
      }

      // 5. Calculate Order Blocks from the 1H timeframe
      const activeAois = calculateOrderBlocks(h1Bars);

      // 6. Run Top-Down Confluence ICC Engine evaluation with all 4 timeframes
      const signal = evaluateIccSetup(pair, dailyBars, h4Bars, h1Bars, m5Bars, activeAois);

      if (signal) {
        const lastDispatchedTime = recentSignalsMap.get(pair) || 0;
        const now = Date.now();

        if (now - lastDispatchedTime < COOLDOWN_PERIOD_MS) {
          console.log(`[Scanner Worker] Setup found for ${pair}, but skipped due to active cooldown window.`);
          continue;
        }

        // Professional Proximity Check
        const liveTickRes = await axios.get(`https://biquote.io/api/${cleanPair}`).catch(() => null);
        const livePrice = liveTickRes?.data?.mid || liveTickRes?.data?.price || liveTickRes?.data?.last;

        if (livePrice) {
          const pipMult = cleanPair.includes('XAU') ? 10 : cleanPair.includes('JPY') ? 100 : 10000;
          const distancePips = Math.abs(livePrice - signal.entry_price) * pipMult;

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
          if (now - new Date(existingSignals[0].created_at).getTime() < COOLDOWN_PERIOD_MS) {
            console.log(`[Scanner Worker] Active pending signal already exists for ${pair}. Skipping.`);
            continue;
          }
        }

        console.log(`[Scanner Worker] Top-Down Confirmed Setup found for ${pair}! Dispatching signal...`);
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

// const TARGET_PAIRS = ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'NZDUSD', 'USDCHF', 'XAUUSD'];
// const recentSignalsMap = new Map();
// const COOLDOWN_PERIOD_MS = 2 * 60 * 60 * 1000; 

// cron.schedule('*/5 * * * *', async () => {
//   console.log('[Scanner Worker] Running multi-timeframe market scan...');

//   try {
//     for (const pair of TARGET_PAIRS) {
//       const htfResponse = await axios.get(`https://biquote.io/api/${pair}/ohlc`, { params: { interval: '1h', limit: 50 } });
//       const htfBars = htfResponse.data?.bars || htfResponse.data;

//       const ltfResponse = await axios.get(`https://biquote.io/api/${pair}/ohlc`, { params: { interval: '5m', limit: 50 } });
//       const ltfBars = ltfResponse.data?.bars || ltfResponse.data;

//       if (!Array.isArray(htfBars) || htfBars.length < 20 || !Array.isArray(ltfBars) || ltfBars.length < 20) continue;

//       const activeAois = calculateOrderBlocks(htfBars);
//       const signal = evaluateIccSetup(pair, htfBars, ltfBars, activeAois);

//       if (signal) {
//         const lastDispatchedTime = recentSignalsMap.get(pair) || 0;
//         const now = Date.now();

//         if (now - lastDispatchedTime < COOLDOWN_PERIOD_MS) continue;

//         // --- PROFESSIONAL PROXIMITY CHECK ---
//         // Fetch current live price right now to ensure we aren't broadcasting a stale/passed entry zone
//         const liveTickRes = await axios.get(`https://biquote.io/api/${pair.toUpperCase()}`).catch(() => null);
//         const livePrice = liveTickRes?.data?.mid || liveTickRes?.data?.price || liveTickRes?.data?.last;

//         if (livePrice) {
//           const isBullish = signal.direction === 'BULLISH' || signal.direction === 'BUY';
//           const cleanPair = pair.toUpperCase();
//           const pipMult = cleanPair.includes('XAU') ? 10 : cleanPair.includes('JPY') ? 100 : 10000;
//           const distancePips = Math.abs(livePrice - signal.entry_price) * pipMult;

//           // If price is already more than 15 pips away from entry, the setup missed its window or already ran
//           if (distancePips > 25) {
//             console.log(`[Scanner Worker] Skipped ${pair}: Live price is too far (${distancePips.toFixed(1)} pips) from entry zone.`);
//             continue;
//           }
//         }

//         const { data: existingSignals } = await supabase
//           .from('signals')
//           .select('id, created_at')
//           .eq('pair', pair)
//           .eq('status', 'PENDING')
//           .order('created_at', { ascending: false })
//           .limit(1);

//         if (existingSignals && existingSignals.length > 0) {
//           if (now - new Date(existingSignals[0].created_at).getTime() < COOLDOWN_PERIOD_MS) continue;
//         }

//         console.log(`[Scanner Worker] Valid Setup found for ${pair}! Dispatching signal...`);
//         recentSignalsMap.set(pair, now);
//         await dispatchAndLogSignal(signal);
//       }
//     }
//   } catch (error) {
//     console.error(`[Scanner Worker] Automated scan error: ${error.message}`);
//   }
// });
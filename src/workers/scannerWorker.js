import cron from 'node-cron';
import axios from 'axios';
import { calculateOrderBlocks } from '../utils/orderBlock/orderBlockDetector.js';
import { evaluateIccSetup } from '../icc/engine/engine.js';
import { dispatchAndLogSignal } from '../services/icc/iccNotificationService.js';
import { supabase } from '../config/supabase.js';

// Expanded target pairs covering Forex and Crypto markets
const TARGET_PAIRS = ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'NZDUSD', 'USDCHF'];

// Keep track of recent alerts to prevent duplicate spamming for the same asset zone (cooldown in ms: e.g., 2 hours)
const recentSignalsMap = new Map();
const COOLDOWN_PERIOD_MS = 2 * 60 * 60 * 1000; 

// Run automated scan every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  console.log('[Scanner Worker] Running multi-timeframe market scan (1H Bias + 5m Execution)...');

  try {
    for (const pair of TARGET_PAIRS) {
      // 1. Fetch Higher Timeframe (1H) bars for macro structure, trend bias, and Order Blocks / AOIs
      const htfResponse = await axios.get(`https://biquote.io/api/${pair}/ohlc`, {
        params: { interval: '1h', limit: 50 }
      });
      const htfBars = htfResponse.data?.bars || htfResponse.data;

      // 2. Fetch Lower Timeframe (5m) bars for immediate execution confirmation
      const ltfResponse = await axios.get(`https://biquote.io/api/${pair}/ohlc`, {
        params: { interval: '5m', limit: 50 }
      });
      const ltfBars = ltfResponse.data?.bars || ltfResponse.data;

      if (!Array.isArray(htfBars) || htfBars.length < 20 || !Array.isArray(ltfBars) || ltfBars.length < 20) {
        console.warn(`[Scanner Worker] Insufficient bars returned for ${pair}`);
        continue;
      }

      // 3. Calculate Higher Timeframe Order Blocks & Fair Value Gaps (AOIs)
      const activeAois = calculateOrderBlocks(htfBars);

      // 4. Run ICC engine evaluation using HTF for bias/AOIs and LTF for confirmation/entry
      const signal = evaluateIccSetup(pair, htfBars, ltfBars, activeAois);

      // 5. If setup triggers, check cooldown before dispatching
      if (signal) {
        const lastDispatchedTime = recentSignalsMap.get(pair) || 0;
        const now = Date.now();

        if (now - lastDispatchedTime < COOLDOWN_PERIOD_MS) {
          console.log(`[Scanner Worker] Setup found for ${pair}, but skipped due to active cooldown window.`);
          continue;
        }

        // Optional: Double check Supabase to ensure no active pending signal for this pair
        const { data: existingSignals } = await supabase
          .from('signals')
          .select('id, created_at')
          .eq('pair', pair)
          .eq('status', 'PENDING')
          .order('created_at', { ascending: false })
          .limit(1);

        if (existingSignals && existingSignals.length > 0) {
          const lastSignalTime = new Date(existingSignals[0].created_at).getTime();
          if (now - lastSignalTime < COOLDOWN_PERIOD_MS) {
            console.log(`[Scanner Worker] Active pending signal already exists in database for ${pair}. Skipping.`);
            continue;
          }
        }

        console.log(`[Scanner Worker] Valid Multi-Timeframe Setup found for ${pair}! Dispatching signal...`);
        
        // Update cooldown tracker
        recentSignalsMap.set(pair, now);

        // Dispatch signal to database and Telegram
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

// // Expanded target pairs covering Forex and Crypto markets
// const TARGET_PAIRS = ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'NZDUSD', 'USDCHF'];

// // Run automated scan every 5 minutes
// cron.schedule('*/5 * * * *', async () => {
//   console.log('[Scanner Worker] Running automated market scan...');

//   try {
//     for (const pair of TARGET_PAIRS) {
//       // 1. Fetch historical OHLCV candle bars required for OB & FVG detection
//       // Endpoint aligned with biquote.io /api/{symbol}/ohlc contract structure
//       const response = await axios.get(`https://biquote.io/api/${pair}/ohlc`, {
//         params: { interval: '5m', limit: 50 }
//       });

//       const liveBars = response.data?.bars || response.data;
//       if (!Array.isArray(liveBars) || liveBars.length < 20) {
//         console.warn(`[Scanner Worker] Insufficient bars returned for ${pair}`);
//         continue;
//       }

//       // 2. Automatically calculate Order Blocks and Fair Value Gaps (AOIs)
//       const activeAois = calculateOrderBlocks(liveBars);

//       // 3. Run ICC engine evaluation (validates trend bias, AOI tap, and LTF confirmation)
//       const signal = evaluateIccSetup(pair, liveBars, activeAois);

//       // 4. Dispatch automatically if setup triggers
//       if (signal) {
//         console.log(`[Scanner Worker] Setup found for ${pair}! Dispatching signal...`);
//         await dispatchAndLogSignal(signal);
//       }
//     }
//   } catch (error) {
//     console.error(`[Scanner Worker] Automated scan error: ${error.message}`);
//   }
// });
import cron from 'node-cron';
import axios from 'axios';
import { calculateOrderBlocks } from '../utils/orderBlock/orderBlockDetector.js';
import { evaluateXauSetup } from '../icc/engine/xauengine.js';
import { evaluateIccSetup } from '../icc/engine/engine.js';
import { dispatchAndLogSignal } from '../services/icc/iccNotificationService.js';
import { supabase } from '../config/supabase.js';

const GOLD_PAIRS = ['XAUUSD'];
const FOREX_PAIRS = ['EURUSD', 'GBPUSD', 'AUDUSD'];
const recentSignalsMap = new Map();
const COOLDOWN_PERIOD_MS = 2 * 60 * 60 * 1000;

cron.schedule('*/5 * * * *', async () => {
  console.log('[Scanner Worker] Running Multi-Engine Market Scan...');

  try {
    // 1. SCAN GOLD USING THE ELITE XAU ENGINE
    for (const pair of GOLD_PAIRS) {
      const cleanPair = pair.toUpperCase().replace('/', '');
      
      const h1Res = await axios.get(`https://biquote.io/api/${cleanPair}/ohlc`, { params: { interval: '1h', limit: 50 } }).catch(() => null);
      const m30Res = await axios.get(`https://biquote.io/api/${cleanPair}/ohlc`, { params: { interval: '30m', limit: 50 } }).catch(() => null);
      const m15Res = await axios.get(`https://biquote.io/api/${cleanPair}/ohlc`, { params: { interval: '15m', limit: 50 } }).catch(() => null);

      if (!h1Res?.data || !m30Res?.data || !m15Res?.data) continue;

      const h1Bars = h1Res.data.bars || h1Res.data;
      const m30Bars = m30Res.data.bars || m30Res.data;
      const m15Bars = m15Res.data.bars || m15Res.data;

      const activeAois = calculateOrderBlocks(h1Bars);
      const signal = evaluateXauSetup(pair, h1Bars, m30Bars, m15Bars, activeAois);

      if (signal) {
        await processAndDispatch(pair, signal);
      }
    }

    // 2. SCAN FOREX USING THE STANDARD ENGINE
    for (const pair of FOREX_PAIRS) {
      const cleanPair = pair.toUpperCase().replace('/', '');

      const h4Res = await axios.get(`https://biquote.io/api/${cleanPair}/ohlc`, { params: { interval: '4h', limit: 40 } }).catch(() => null);
      const h1Res = await axios.get(`https://biquote.io/api/${cleanPair}/ohlc`, { params: { interval: '1h', limit: 50 } }).catch(() => null);
      const m15Res = await axios.get(`https://biquote.io/api/${cleanPair}/ohlc`, { params: { interval: '15m', limit: 50 } }).catch(() => null);

      if (!h4Res?.data || !h1Res?.data || !m15Res?.data) continue;

      const h4Bars = h4Res.data.bars || h4Res.data;
      const h1Bars = h1Res.data.bars || h1Res.data;
      const m15Bars = m15Res.data.bars || m15Res.data;

      const activeAois = calculateOrderBlocks(h1Bars);
      const signal = evaluateIccSetup(pair, h4Bars, h1Bars, m15Bars, activeAois);

      if (signal) {
        await processAndDispatch(pair, signal);
      }
    }

  } catch (error) {
    console.error(`[Scanner Worker] Automated scan error: ${error.message}`);
  }
});

async function processAndDispatch(pair, signal) {
  const now = Date.now();
  const lastDispatchedTime = recentSignalsMap.get(pair) || 0;
  if (now - lastDispatchedTime < COOLDOWN_PERIOD_MS) return;

  // Check active signals in Supabase to prevent spamming duplicates
  const { data: openSignals } = await supabase
    .from('signals')
    .select('id, status')
    .eq('pair', pair)
    .in('status', ['PENDING', 'TRIGGERED'])
    .limit(1);

  if (openSignals && openSignals.length > 0) return;

  // Dispatch using your existing unified Telegram notification service
  if (await dispatchAndLogSignal(signal)) {
    recentSignalsMap.set(pair, now);
    console.log(`[Scanner Worker] Successfully broadcasted ${pair} signal via Telegram.`);
  }
}



// import cron from 'node-cron';
// import axios from 'axios';
// import { calculateOrderBlocks } from '../utils/orderBlock/orderBlockDetector.js';
// import { evaluateIccSetup } from '../icc/engine/engine.js';
// import { dispatchAndLogSignal } from '../services/icc/iccNotificationService.js';
// import { supabase } from '../config/supabase.js';

// const TARGET_PAIRS = ['EURUSD', 'GBPUSD', 'AUDUSD'];
// const recentSignalsMap = new Map();
// const COOLDOWN_PERIOD_MS = 2 * 60 * 60 * 1000;

// cron.schedule('*/5 * * * *', async () => {
//   console.log('[Scanner Worker] Running Top-Down Multi-Timeframe Market Scan (4H -> 1H -> 15m)...');

//   try {
//     for (const pair of TARGET_PAIRS) {
//       const cleanPair = pair.toUpperCase().replace('/', '');

//       // Fetch 4H, 1H, and 15m candles
//       const h4Res = await axios.get(`https://biquote.io/api/${cleanPair}/ohlc`, { params: { interval: '4h', limit: 40 } }).catch(() => null);
//       const h4Bars = h4Res?.data?.bars || h4Res?.data;

//       const h1Res = await axios.get(`https://biquote.io/api/${cleanPair}/ohlc`, { params: { interval: '1h', limit: 50 } }).catch(() => null);
//       const h1Bars = h1Res?.data?.bars || h1Res?.data;

//       const m15Res = await axios.get(`https://biquote.io/api/${cleanPair}/ohlc`, { params: { interval: '15m', limit: 50 } }).catch(() => null);
//       const m15Bars = m15Res?.data?.bars || m15Res?.data;

//       if (!Array.isArray(h4Bars) || h4Bars.length < 15 ||
//         !Array.isArray(h1Bars) || h1Bars.length < 20 ||
//         !Array.isArray(m15Bars) || m15Bars.length < 20) {
//         continue;
//       }

//       // Calculate order blocks based on 1H Indication zone
//       const activeAois = calculateOrderBlocks(h1Bars);
      
//       // Evaluate ICC setup using 4H (bias) -> 1H (indication/AOI) -> 15m (correction & order settlement)
//       const signal = evaluateIccSetup(pair, h4Bars, h1Bars, m15Bars, activeAois);

//       if (signal) {
//         const now = Date.now();
//         const lastDispatchedTime = recentSignalsMap.get(pair) || 0;

//         if (now - lastDispatchedTime < COOLDOWN_PERIOD_MS) continue;

//         // Order-Type Validity Check against live market price
//         const liveTickRes = await axios.get(`https://biquote.io/api/${cleanPair}`).catch(() => null);
//         const livePrice = liveTickRes?.data?.mid || liveTickRes?.data?.price || liveTickRes?.data?.last;

//         if (livePrice) {
//           const live = parseFloat(livePrice);
//           const entry = signal.entry_price;
//           const t = signal.order_type;

//           const needsPriceAbove = t === 'BUY_LIMIT' || t === 'SELL_STOP';
//           const stillValid = needsPriceAbove ? live > entry : live < entry;

//           if (!Number.isFinite(live) || !stillValid) {
//             console.log(`[Scanner Worker] Skipped ${pair}: ${t} @ ${entry} no longer valid (live ${live}).`);
//             continue;
//           }
//         }

//         const { data: openSignals, error: openError } = await supabase
//           .from('signals')
//           .select('id, status')
//           .eq('pair', pair)
//           .in('status', ['PENDING', 'TRIGGERED'])
//           .limit(1);

//         if (openError || (openSignals && openSignals.length > 0)) {
//           continue;
//         }

//         if (await dispatchAndLogSignal(signal)) {
//           recentSignalsMap.set(pair, now);
//         }
//       }
//     }
//   } catch (error) {
//     console.error(`[Scanner Worker] Automated scan error: ${error.message}`);
//   }
// });
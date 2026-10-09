import { detectTrendBias } from '../icc/indication/indicationService.js';
import { checkAoiTap } from '../icc/aoi/aoiDetector.js';
import { validateConfirmation } from '../icc/confirmation/confirmationService.js';

function calculatePips(entry, target, pair) {
  const cleanPair = pair.toUpperCase();
  let multiplier = 10000; 
  
  if (cleanPair.includes('JPY')) {
    multiplier = 100; 
  } else if (cleanPair.includes('XAU')) {
    multiplier = 10; 
  }

  const pips = Math.abs(target - entry) * multiplier;
  return parseFloat(pips.toFixed(1));
}

/**
 * Evaluates ICC Setup with strict Top-Down Multi-Timeframe Confluence (1D ➔ 4H ➔ 1H ➔ 5m)
 */
export function evaluateIccSetup(pair, dailyBars, h4Bars, h1Bars, m5Bars, activeAois) {
  // 1. MACRO INDICATION: Check Daily (1D) Market Structure Bias
  const dailyBias = detectTrendBias(dailyBars);
  if (dailyBias === 'NEUTRAL') return null;

  // 2. INTERMEDIATE INDICATION: Check 4-Hour (4H) Market Structure Bias
  const h4Bias = detectTrendBias(h4Bars);
  if (h4Bias === 'NEUTRAL' || h4Bias !== dailyBias) {
    // Reject setup if 4H structure conflicts with Daily macro trend
    return null;
  }

  // 3. MICRO INDICATION: Check 1-Hour (1H) Bias Alignment
  const h1Bias = detectTrendBias(h1Bars);
  if (h1Bias !== dailyBias) return null;

  // 4. CORRECTION PHASE: Check if 1H price is tapping an Order Block / AOI zone
  const latestH1Bar = h1Bars[h1Bars.length - 1];
  const targetedAoi = checkAoiTap(latestH1Bar.close, activeAois);
  if (!targetedAoi) return null;

  // 5. CONTINUATION PHASE: Validate Lower Timeframe (5m) structure confirmation
  const isConfirmed = validateConfirmation(m5Bars, dailyBias);
  if (!isConfirmed) return null;

  const latestM5Bar = m5Bars[m5Bars.length - 1];
  const entryPrice = latestM5Bar.close;
  
  let buffer = 0.0010; 
  const cleanPair = pair.toUpperCase();
  
  if (cleanPair.includes('XAU')) {
    buffer = 2.50; 
  } else if (cleanPair.includes('JPY')) {
    buffer = 0.15; 
  }

  const stopLoss = dailyBias === 'BULLISH' || dailyBias === 'BUY'
    ? Number((targetedAoi.low - buffer).toFixed(5)) 
    : Number((targetedAoi.high + buffer).toFixed(5));

  const risk = Math.abs(entryPrice - stopLoss);
  
  const rewardMultiplier = 2.5;
  const takeProfit = dailyBias === 'BULLISH' || dailyBias === 'BUY'
    ? Number((entryPrice + (risk * rewardMultiplier)).toFixed(5)) 
    : Number((entryPrice - (risk * rewardMultiplier)).toFixed(5));

  const slPips = calculatePips(entryPrice, stopLoss, pair);
  const tpPips = calculatePips(entryPrice, takeProfit, pair);

  const direction = (dailyBias === 'BULLISH' || dailyBias === 'BUY') ? 'BULLISH' : 'BEARISH';

  return {
    pair,
    direction,
    bias: direction,
    risk,
    riskRewardRatio: `1:${rewardMultiplier}`,
    slPips,
    tpPips,
    aoiId: targetedAoi.id,
    entryPrice: Number(entryPrice.toFixed(5)),
    stopLoss,
    takeProfit,
    timestamp: Date.now()
  };
}



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
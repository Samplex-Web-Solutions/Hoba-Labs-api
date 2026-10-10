import { detectTrendBias } from '../indication/indicationService.js';
import { checkAoiTap } from '../aoi/aoiDetector.js';
import { validateConfirmation } from '../confirmation/confirmationService.js';

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









// import { detectTrendBias } from '../indication/indicationService.js';
// import { checkAoiTap } from '../aoi/aoiDetector.js';
// import { validateConfirmation } from '../confirmation/confirmationService.js';

// /**
//  * Calculates pips based on asset class (Forex, JPY, Gold)
//  */
// function calculatePips(entry, target, pair) {
//   const cleanPair = pair.toUpperCase();
//   let multiplier = 10000; // Standard Forex pairs (e.g., EURUSD)
  
//   if (cleanPair.includes('JPY')) {
//     multiplier = 100; // JPY pairs
//   } else if (cleanPair.includes('XAU')) {
//     multiplier = 10; // Gold (adjust if broker uses 100 points)
//   }

//   const pips = Math.abs(target - entry) * multiplier;
//   return parseFloat(pips.toFixed(1));
// }

// export function evaluateIccSetup(pair, currentBars, activeAois) {
//   const latestBar = currentBars[currentBars.length - 1];
  
//   // 1. Indication: Get Trend Bias
//   const bias = detectTrendBias(currentBars);
//   if (bias === 'NEUTRAL') return null;

//   // 2. Correction: Check AOI Tap
//   const targetedAoi = checkAoiTap(latestBar.close, activeAois);
//   if (!targetedAoi) return null;

//   // 3. Continuation: Validate Lower Timeframe Structure Confirmation
//   const isConfirmed = validateConfirmation(currentBars, bias);
//   if (!isConfirmed) return null;

//   // Build Execution Plan with Asset-Aware Buffers
//   const entryPrice = latestBar.close;
  
//   let buffer = 0.0010; // Default forex buffer (~10 pips)
//   const cleanPair = pair.toUpperCase();
  
//   if (cleanPair.includes('XAU')) {
//     buffer = 2.50; // $2.50 buffer for Gold
//   } else if (cleanPair.includes('JPY')) {
//     buffer = 0.15; // 15 pips equivalent for JPY pairs
//   }

//   const stopLoss = bias === 'BULLISH' 
//     ? Number((targetedAoi.low - buffer).toFixed(4)) 
//     : Number((targetedAoi.high + buffer).toFixed(4));

//   const risk = Math.abs(entryPrice - stopLoss);
  
//   // Clean 1:2.5 Risk-to-Reward Ratio Target
//   const rewardMultiplier = 2.5;
//   const takeProfit = bias === 'BULLISH' 
//     ? Number((entryPrice + (risk * rewardMultiplier)).toFixed(4)) 
//     : Number((entryPrice - (risk * rewardMultiplier)).toFixed(4));

//   // Calculate Pip Targets for SL and TP
//   const slPips = calculatePips(entryPrice, stopLoss, pair);
//   const tpPips = calculatePips(entryPrice, takeProfit, pair);

//   return {
//     pair,
//     bias,
//     risk,
//     riskRewardRatio: `1:${rewardMultiplier}`,
//     slPips,
//     tpPips,
//     aoiId: targetedAoi.id,
//     entryPrice: Number(entryPrice.toFixed(4)),
//     stopLoss,
//     takeProfit,
//     timestamp: Date.now()
//   };
// }


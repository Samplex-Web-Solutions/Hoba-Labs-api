import { detectTrendBias } from '../indication/indicationService.js';
import { checkAoiTap } from '../aoi/aoiDetector.js';
import { validateConfirmation } from '../confirmation/confirmationService.js';

/**
 * Calculates pips based on asset class (Forex, JPY, Gold)
 */
function calculatePips(entry, target, pair) {
  const cleanPair = pair.toUpperCase();
  let multiplier = 10000; // Standard Forex pairs (e.g., EURUSD)
  
  if (cleanPair.includes('JPY')) {
    multiplier = 100; // JPY pairs
  } else if (cleanPair.includes('XAU')) {
    multiplier = 10; // Gold (adjust if broker uses 100 points)
  }

  const pips = Math.abs(target - entry) * multiplier;
  return parseFloat(pips.toFixed(1));
}

export function evaluateIccSetup(pair, currentBars, activeAois) {
  const latestBar = currentBars[currentBars.length - 1];
  
  // 1. Indication: Get Trend Bias
  const bias = detectTrendBias(currentBars);
  if (bias === 'NEUTRAL') return null;

  // 2. Correction: Check AOI Tap
  const targetedAoi = checkAoiTap(latestBar.close, activeAois);
  if (!targetedAoi) return null;

  // 3. Continuation: Validate Lower Timeframe Structure Confirmation
  const isConfirmed = validateConfirmation(currentBars, bias);
  if (!isConfirmed) return null;

  // Build Execution Plan with Asset-Aware Buffers
  const entryPrice = latestBar.close;
  
  let buffer = 0.0010; // Default forex buffer (~10 pips)
  const cleanPair = pair.toUpperCase();
  
  if (cleanPair.includes('XAU')) {
    buffer = 2.50; // $2.50 buffer for Gold
  } else if (cleanPair.includes('JPY')) {
    buffer = 0.15; // 15 pips equivalent for JPY pairs
  }

  const stopLoss = bias === 'BULLISH' 
    ? Number((targetedAoi.low - buffer).toFixed(4)) 
    : Number((targetedAoi.high + buffer).toFixed(4));

  const risk = Math.abs(entryPrice - stopLoss);
  
  // Clean 1:2.5 Risk-to-Reward Ratio Target
  const rewardMultiplier = 2.5;
  const takeProfit = bias === 'BULLISH' 
    ? Number((entryPrice + (risk * rewardMultiplier)).toFixed(4)) 
    : Number((entryPrice - (risk * rewardMultiplier)).toFixed(4));

  // Calculate Pip Targets for SL and TP
  const slPips = calculatePips(entryPrice, stopLoss, pair);
  const tpPips = calculatePips(entryPrice, takeProfit, pair);

  return {
    pair,
    bias,
    risk,
    riskRewardRatio: `1:${rewardMultiplier}`,
    slPips,
    tpPips,
    aoiId: targetedAoi.id,
    entryPrice: Number(entryPrice.toFixed(4)),
    stopLoss,
    takeProfit,
    timestamp: Date.now()
  };
}



// import { detectTrendBias } from '../indication/indicationService.js';
// import { checkAoiTap } from '../aoi/aoiDetector.js';
// import { validateConfirmation } from '../confirmation/confirmationService.js';

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
  
//   // Determine buffer based on asset type (e.g. Gold needs a wider buffer than EURUSD)
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
  
//   // Clean 1:2.5 or 1:3 Risk-to-Reward Ratio
//   const takeProfit = bias === 'BULLISH' 
//     ? Number((entryPrice + (risk * 2.5)).toFixed(4)) 
//     : Number((entryPrice - (risk * 2.5)).toFixed(4));

//   return {
//     pair,
//     bias,
//     risk,
//     aoiId: targetedAoi.id,
//     entryPrice: Number(entryPrice.toFixed(4)),
//     stopLoss,
//     takeProfit,
//     timestamp: Date.now()
//   };
// }
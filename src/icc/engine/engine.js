import { detectTrendBias } from '../indication/indicationService.js';
import { checkAoiTap } from '../aoi/aoiDetector.js';
import { validateConfirmation } from '../confirmation/confirmationService.js';

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
  
  // Determine buffer based on asset type (e.g. Gold needs a wider buffer than EURUSD)
  let buffer = 0.0010; // Default forex buffer (~10 pips)
  const cleanPair = pair.toUpperCase();
  
  if (cleanPair.includes('XAU')) {
    buffer = 2.50; // $2.50 buffer for Gold
  } else if (cleanPair.includes('JPY')) {
    buffer = 0.15; // 15 pips equivalent for JPY pairs
  }

  const stopLoss = bias === 'BULLISH' 
    ? Number((targetedAoi.low - buffer).toFixed(2)) 
    : Number((targetedAoi.high + buffer).toFixed(2));

  const risk = Math.abs(entryPrice - stopLoss);
  
  // Clean 1:2.5 or 1:3 Risk-to-Reward Ratio
  const takeProfit = bias === 'BULLISH' 
    ? Number((entryPrice + (risk * 2.5)).toFixed(2)) 
    : Number((entryPrice - (risk * 2.5)).toFixed(2));

  return {
    pair,
    bias,
    aoiId: targetedAoi.id,
    entryPrice: Number(entryPrice.toFixed(2)),
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

//   // Build Execution Plan
//   const entryPrice = latestBar.close;
//   const stopLoss = bias === 'BULLISH' ? targetedAoi.low - 0.0005 : targetedAoi.high + 0.0005;
//   const risk = Math.abs(entryPrice - stopLoss);
//   const takeProfit = bias === 'BULLISH' ? entryPrice + (risk * 3) : entryPrice - (risk * 3);

//   return {
//     pair,
//     bias,
//     aoiId: targetedAoi.id,
//     entryPrice,
//     stopLoss,
//     takeProfit,
//     timestamp: Date.now()
//   };
// }
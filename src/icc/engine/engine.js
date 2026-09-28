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

  // Build Execution Plan
  const entryPrice = latestBar.close;
  const stopLoss = bias === 'BULLISH' ? targetedAoi.low - 0.0005 : targetedAoi.high + 0.0005;
  const risk = Math.abs(entryPrice - stopLoss);
  const takeProfit = bias === 'BULLISH' ? entryPrice + (risk * 3) : entryPrice - (risk * 3);

  return {
    pair,
    bias,
    aoiId: targetedAoi.id,
    entryPrice,
    stopLoss,
    takeProfit,
    timestamp: Date.now()
  };
}
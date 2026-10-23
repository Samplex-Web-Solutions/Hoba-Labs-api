import { detectTrendBias } from '../indication/indicationService.js';
import { checkAoiTap } from '../aoi/aoiDetector.js';
import { validateConfirmation } from '../confirmation/confirmationService.js';

const XAU_CONFIG = {
  buffer: 1.00,        // Tight $1.00 Gold buffer
  minGap: 5,
  maxEntryDist: 200,
  risk: { min: 15, max: 400 },
  pipMultiplier: 10
};

function calculatePips(entry, target) {
  return parseFloat((Math.abs(target - entry) * XAU_CONFIG.pipMultiplier).toFixed(1));
}

/**
 * Specialized High-Performance XAUUSD Engine (Shorts-Optimized & Displacement-Filtered)
 */
export function evaluateXauSetup(pair, h1Bars, m30Bars, m15Bars, activeAois) {
  // 1. 1H Macro Bias Check with Displacement
  const h1Bias = detectTrendBias(h1Bars);
  if (h1Bias === 'NEUTRAL') return null;

  // 2. 30M Structural Confirmation
  const m30Bias = detectTrendBias(m30Bars);
  if (m30Bias !== h1Bias) return null;

  // 3. AOI Tap on 30M
  const latestM30Bar = m30Bars[m30Bars.length - 1];
  const targetedAoi = checkAoiTap(latestM30Bar.close, activeAois);
  if (!targetedAoi) return null;

  // 4. 15M Continuation Confirmation
  const isConfirmed = validateConfirmation(m15Bars, h1Bias);
  if (!isConfirmed) return null;

  const isBull = h1Bias === 'BULLISH';
  
  // --- STRICT SHORTS-ONLY ENFORCEMENT FOR GOLD ---
  // (You can toggle this if you want bidirectional later, but shorts proved elite)
  if (isBull) return null; 

  const pip = 1 / XAU_CONFIG.pipMultiplier;
  const currentPrice = m15Bars[m15Bars.length - 1].close;

  const recent = m15Bars.slice(-11, -1);
  const swingHigh = Math.max(...recent.map(b => b.high));
  const swingLow = Math.min(...recent.map(b => b.low));
  const aoiMid = (targetedAoi.high + targetedAoi.low) / 2;

  let orderType, entryPrice;
  if (aoiMid - currentPrice >= XAU_CONFIG.minGap * pip) {
    orderType = 'SELL_LIMIT';
    entryPrice = aoiMid;
  } else {
    orderType = 'SELL_STOP';
    entryPrice = swingLow - pip;
  }

  // Guards
  if (entryPrice < currentPrice) return null; // Must be sell order above/at price
  const gapPips = Math.abs(entryPrice - currentPrice) / pip;
  if (gapPips < XAU_CONFIG.minGap || gapPips > XAU_CONFIG.maxEntryDist) return null;

  const stopLoss = Number((targetedAoi.high + XAU_CONFIG.buffer).toFixed(2));
  if (stopLoss <= entryPrice) return null;

  const slPips = calculatePips(entryPrice, stopLoss);
  if (slPips < XAU_CONFIG.risk.min || slPips > XAU_CONFIG.risk.max) return null;

  const risk = Math.abs(entryPrice - stopLoss);
  const rewardMultiplier = 2.5;
  const takeProfit = Number((entryPrice - risk * rewardMultiplier).toFixed(2));
  const tpPips = calculatePips(entryPrice, takeProfit);

  return {
    pair,
    direction: 'BEARISH',
    bias: 'BEARISH',
    order_type: orderType,
    risk,
    riskRewardRatio: `1:${rewardMultiplier}`,
    slPips,
    tpPips,
    aoiId: targetedAoi.id,
    entry_price: Number(entryPrice.toFixed(2)),
    stop_loss: stopLoss,
    take_profit: takeProfit,
    timestamp: Date.now()
  };
}
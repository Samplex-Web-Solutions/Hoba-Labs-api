import { detectTrendBias } from '../indication/indicationService.js';
import { checkAoiTap } from '../aoi/aoiDetector.js';
import { validateConfirmation } from '../confirmation/confirmationService.js';

const ASSET_CONFIG = {
  XAU:     { buffer: 2.50,   minGap: 5, maxEntryDist: 100, risk: { min: 30, max: 300 } },
  JPY:     { buffer: 0.15,   minGap: 3, maxEntryDist: 30,  risk: { min: 8,  max: 50 } },
  DEFAULT: { buffer: 0.0010, minGap: 3, maxEntryDist: 30,  risk: { min: 8,  max: 50 } }
};

function getConfig(pair) {
  const p = pair.toUpperCase();
  if (p.includes('XAU')) return ASSET_CONFIG.XAU;
  if (p.includes('JPY')) return ASSET_CONFIG.JPY;
  return ASSET_CONFIG.DEFAULT;
}

function getPipMultiplier(pair) {
  const p = pair.toUpperCase();
  return p.includes('XAU') ? 10 : p.includes('JPY') ? 100 : 10000;
}

function calculatePips(entry, target, pair) {
  return parseFloat((Math.abs(target - entry) * getPipMultiplier(pair)).toFixed(1));
}

/**
 * Evaluates ICC Setup with strict Top-Down Multi-Timeframe Confluence & Pending Order Selection
 */
export function evaluateIccSetup(pair, dailyBars, h4Bars, h1Bars, m5Bars, activeAois) {
  const dailyBias = detectTrendBias(dailyBars);
  if (dailyBias === 'NEUTRAL') return null;

  const h4Bias = detectTrendBias(h4Bars);
  if (h4Bias === 'NEUTRAL' || h4Bias !== dailyBias) return null;

  const h1Bias = detectTrendBias(h1Bars);
  if (h1Bias !== dailyBias) return null;

  const latestH1Bar = h1Bars[h1Bars.length - 1];
  const targetedAoi = checkAoiTap(latestH1Bar.close, activeAois);
  if (!targetedAoi) return null;

  const isConfirmed = validateConfirmation(m5Bars, dailyBias);
  if (!isConfirmed) return null;

  const isBull = dailyBias === 'BULLISH' || dailyBias === 'BUY';
  const cfg = getConfig(pair);
  const pip = 1 / getPipMultiplier(pair);
  const currentPrice = m5Bars[m5Bars.length - 1].close;

  // Swing levels from the last 10 closed 5m bars (excluding the forming one)
  const recent = m5Bars.slice(-11, -1);
  const swingHigh = Math.max(...recent.map(b => b.high));
  const swingLow = Math.min(...recent.map(b => b.low));
  const aoiMid = (targetedAoi.high + targetedAoi.low) / 2;

  // Choose order type & entry price
  let orderType, entryPrice;
  if (isBull) {
    if (currentPrice - aoiMid >= cfg.minGap * pip) {
      orderType = 'BUY_LIMIT';
      entryPrice = aoiMid;
    } else {
      orderType = 'BUY_STOP';
      entryPrice = swingHigh + pip;
    }
  } else {
    if (aoiMid - currentPrice >= cfg.minGap * pip) {
      orderType = 'SELL_LIMIT';
      entryPrice = aoiMid;
    } else {
      orderType = 'SELL_STOP';
      entryPrice = swingLow - pip;
    }
  }

  // GUARD 1: pending entry must be on the correct side of price, at a sane distance
  const belowPrice = orderType === 'BUY_LIMIT' || orderType === 'SELL_STOP';
  const sideOk = belowPrice ? entryPrice < currentPrice : entryPrice > currentPrice;
  const gapPips = Math.abs(entryPrice - currentPrice) / pip;
  if (!sideOk || gapPips < cfg.minGap || gapPips > cfg.maxEntryDist) return null;

  // Stop loss beyond the AOI
  const stopLoss = isBull
    ? Number((targetedAoi.low - cfg.buffer).toFixed(5))
    : Number((targetedAoi.high + cfg.buffer).toFixed(5));

  // GUARD 2: SL must sit on the losing side of the ENTRY (not current price)
  if (isBull ? stopLoss >= entryPrice : stopLoss <= entryPrice) return null;

  const slPips = calculatePips(entryPrice, stopLoss, pair);

  // GUARD 3: risk size limits
  if (slPips < cfg.risk.min || slPips > cfg.risk.max) return null;

  const risk = Math.abs(entryPrice - stopLoss);
  const rewardMultiplier = 2.5;

  const takeProfit = isBull
    ? Number((entryPrice + risk * rewardMultiplier).toFixed(5))
    : Number((entryPrice - risk * rewardMultiplier).toFixed(5));

  const tpPips = calculatePips(entryPrice, takeProfit, pair);
  const direction = isBull ? 'BULLISH' : 'BEARISH';

  return {
    pair,
    direction,
    bias: direction,
    order_type: orderType,
    risk,
    riskRewardRatio: `1:${rewardMultiplier}`,
    slPips,
    tpPips,
    aoiId: targetedAoi.id,
    entry_price: Number(entryPrice.toFixed(5)),
    stop_loss: stopLoss,
    take_profit: takeProfit,
    timestamp: Date.now()
  };
}








// import { detectTrendBias } from '../indication/indicationService.js';
// import { checkAoiTap } from '../aoi/aoiDetector.js';
// import { validateConfirmation } from '../confirmation/confirmationService.js';

// function calculatePips(entry, target, pair) {
//   const cleanPair = pair.toUpperCase();
//   let multiplier = 10000; 
  
//   if (cleanPair.includes('JPY')) {
//     multiplier = 100; 
//   } else if (cleanPair.includes('XAU')) {
//     multiplier = 10; 
//   }

//   const pips = Math.abs(target - entry) * multiplier;
//   return parseFloat(pips.toFixed(1));
// }

// /**
//  * Evaluates ICC Setup with strict Top-Down Multi-Timeframe Confluence (1D ➔ 4H ➔ 1H ➔ 5m)
//  */
// export function evaluateIccSetup(pair, dailyBars, h4Bars, h1Bars, m5Bars, activeAois) {
//   // 1. MACRO INDICATION: Check Daily (1D) Market Structure Bias
//   const dailyBias = detectTrendBias(dailyBars);
//   if (dailyBias === 'NEUTRAL') return null;

//   // 2. INTERMEDIATE INDICATION: Check 4-Hour (4H) Market Structure Bias
//   const h4Bias = detectTrendBias(h4Bars);
//   if (h4Bias === 'NEUTRAL' || h4Bias !== dailyBias) {
//     return null;
//   }

//   // 3. MICRO INDICATION: Check 1-Hour (1H) Bias Alignment
//   const h1Bias = detectTrendBias(h1Bars);
//   if (h1Bias !== dailyBias) return null;

//   // 4. CORRECTION PHASE: Check if 1H price is tapping an Order Block / AOI zone
//   const latestH1Bar = h1Bars[h1Bars.length - 1];
//   const targetedAoi = checkAoiTap(latestH1Bar.close, activeAois);
//   if (!targetedAoi) return null;

//   // 5. CONTINUATION PHASE: Validate Lower Timeframe (5m) structure confirmation
//   const isConfirmed = validateConfirmation(m5Bars, dailyBias);
//   if (!isConfirmed) return null;

//   const latestM5Bar = m5Bars[m5Bars.length - 1];
//   const entryPrice = latestM5Bar.close;
  
//   let buffer = 0.0010; 
//   const cleanPair = pair.toUpperCase();
  
//   if (cleanPair.includes('XAU')) {
//     buffer = 2.50; 
//   } else if (cleanPair.includes('JPY')) {
//     buffer = 0.15; 
//   }

//   const isBull = dailyBias === 'BULLISH' || dailyBias === 'BUY';

//   const stopLoss = isBull  
//     ? Number((targetedAoi.low - buffer).toFixed(5))  
//     : Number((targetedAoi.high + buffer).toFixed(5));

//   // GUARD 1: Stop Loss must sit strictly on the losing side of entry
//   if (isBull ? stopLoss >= entryPrice : stopLoss <= entryPrice) return null;

//   const slPips = calculatePips(entryPrice, stopLoss, pair);

//   // GUARD 2: Reject setups where risk is too tight or too wide
//   const riskLimits = cleanPair.includes('XAU')  
//     ? { min: 30, max: 300 }   // $3 to $30 on gold  
//     : { min: 8, max: 50 };    // forex and JPY pairs

//   if (slPips < riskLimits.min || slPips > riskLimits.max) return null;

//   const risk = Math.abs(entryPrice - stopLoss);
//   const rewardMultiplier = 2.5;

//   const takeProfit = isBull  
//     ? Number((entryPrice + risk * rewardMultiplier).toFixed(5))  
//     : Number((entryPrice - risk * rewardMultiplier).toFixed(5));

//   const tpPips = calculatePips(entryPrice, takeProfit, pair);
//   const direction = isBull ? 'BULLISH' : 'BEARISH';

//   return {
//     pair,
//     direction,
//     bias: direction,
//     risk,
//     riskRewardRatio: `1:${rewardMultiplier}`,
//     slPips,
//     tpPips,
//     aoiId: targetedAoi.id,
//     entry_price: Number(entryPrice.toFixed(5)),
//     stop_loss: stopLoss,
//     take_profit: takeProfit,
//     timestamp: Date.now()
//   };
// }
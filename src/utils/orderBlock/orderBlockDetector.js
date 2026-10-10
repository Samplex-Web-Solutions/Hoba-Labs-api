/**
 * Institutional Order Block & FVG Detector with Displacement & Mitigation Filtering
 * @param {Array} bars - Array of OHLCV bars [{ timestamp, open, high, low, close }]
 * @returns {Array} List of high-probability active AOIs
 */
export function calculateOrderBlocks(bars) {
  const aois = [];
  if (!bars || bars.length < 10) return aois;

  // Calculate 10-bar Average Range (ATR proxy) to measure true displacement
  let totalRange = 0;
  for (let k = bars.length - 10; k < bars.length; k++) {
    totalRange += Math.abs(bars[k].high - bars[k].low);
  }
  const avgRange = totalRange / 10;

  const latestClose = bars[bars.length - 1].close;

  // 1. Detect Order Blocks (OB) with True Displacement
  for (let i = 2; i < bars.length - 3; i++) {
    const curr = bars[i];
    const next1 = bars[i + 1];
    const next2 = bars[i + 2];

    const next1Body = Math.abs(next1.close - next1.open);
    const next2Body = Math.abs(next2.close - next2.open);

    // Displacement Check: At least one of the expansion candles must be >= 1.2x average bar size
    const possessesDisplacement = next1Body >= (avgRange * 1.2) || next2Body >= (avgRange * 1.2);

    // --- BULLISH ORDER BLOCK ---
    const isBearishCandle = curr.close < curr.open;
    const isImpulseUp = next1.close > curr.high && next2.close > next1.high;

    if (isBearishCandle && isImpulseUp && possessesDisplacement) {
      // Check if price already broke below this block in subsequent bars (Mitigated/Invalidated)
      let isMitigated = false;
      for (let j = i + 3; j < bars.length; j++) {
        if (bars[j].close < curr.low) {
          isMitigated = true;
          break;
        }
      }

      if (!isMitigated) {
        aois.push({
          id: `OB_BULL_${curr.timestamp}`,
          type: 'BULLISH_OB',
          high: curr.high,
          low: curr.low,
          timestamp: curr.timestamp
        });
      }
    }

    // --- BEARISH ORDER BLOCK ---
    const isBullishCandle = curr.close > curr.open;
    const isImpulseDown = next1.close < curr.low && next2.close < next1.low;

    if (isBullishCandle && isImpulseDown && possessesDisplacement) {
      let isMitigated = false;
      for (let j = i + 3; j < bars.length; j++) {
        if (bars[j].close > curr.high) {
          isMitigated = true;
          break;
        }
      }

      if (!isMitigated) {
        aois.push({
          id: `OB_BEAR_${curr.timestamp}`,
          type: 'BEARISH_OB',
          high: curr.high,
          low: curr.low,
          timestamp: curr.timestamp
        });
      }
    }
  }

  // 2. Detect Fair Value Gaps (FVG)
  for (let i = 1; i < bars.length - 1; i++) {
    const candle1 = bars[i - 1];
    const candle2 = bars[i];
    const candle3 = bars[i + 1];

    // Bullish FVG
    if (candle3.low > candle1.high) {
      // Check if mitigated by current price
      if (latestClose >= candle1.high) {
        aois.push({
          id: `FVG_BULL_${candle2.timestamp}`,
          type: 'BULLISH_FVG',
          high: candle3.low,
          low: candle1.high,
          timestamp: candle2.timestamp
        });
      }
    }

    // Bearish FVG
    if (candle3.high < candle1.low) {
      if (latestClose <= candle1.low) {
        aois.push({
          id: `FVG_BEAR_${candle2.timestamp}`,
          type: 'BEARISH_FVG',
          high: candle1.low,
          low: candle3.high,
          timestamp: candle2.timestamp
        });
      }
    }
  }

  return aois;
}






// /**
//  * Automatically calculates Order Blocks and Fair Value Gaps (FVGs) from historical price bars.
//  * @param {Array} bars - Array of OHLCV bars [{ timestamp, open, high, low, close }]
//  * @returns {Array} List of detected zones (AOIs including OBs and FVGs)
//  */
// export function calculateOrderBlocks(bars) {
//   const aois = [];
//   if (!bars || bars.length < 5) return aois;

//   // 1. Detect Order Blocks (OB)
//   for (let i = 2; i < bars.length - 2; i++) {
//     const prev = bars[i - 1];
//     const curr = bars[i];
//     const next1 = bars[i + 1];
//     const next2 = bars[i + 2];

//     // Bullish Order Block: Last bearish candle before a strong upward impulsive break
//     const isBearishCandle = curr.close < curr.open;
//     const isImpulseUp = next1.close > curr.high && next2.close > next1.high;

//     if (isBearishCandle && isImpulseUp) {
//       aois.push({
//         id: `OB_BULL_${curr.timestamp}`,
//         type: 'BULLISH_OB',
//         high: curr.high,
//         low: curr.low,
//         mitigated: false,
//         timestamp: curr.timestamp
//       });
//     }

//     // Bearish Order Block: Last bullish candle before a strong downward impulsive break
//     const isBullishCandle = curr.close > curr.open;
//     const isImpulseDown = next1.close < curr.low && next2.close < next1.low;

//     if (isBullishCandle && isImpulseDown) {
//       aois.push({
//         id: `OB_BEAR_${curr.timestamp}`,
//         type: 'BEARISH_OB',
//         high: curr.high,
//         low: curr.low,
//         mitigated: false,
//         timestamp: curr.timestamp
//       });
//     }
//   }

//   // 2. Detect Fair Value Gaps (FVG) - 3-candle imbalance pattern
//   for (let i = 1; i < bars.length - 1; i++) {
//     const candle1 = bars[i - 1];
//     const candle2 = bars[i]; // Displacement candle
//     const candle3 = bars[i + 1];

//     // Bullish FVG: Gap between candle 1 high and candle 3 low
//     if (candle3.low > candle1.high) {
//       aois.push({
//         id: `FVG_BULL_${candle2.timestamp}`,
//         type: 'BULLISH_FVG',
//         high: candle3.low,
//         low: candle1.high,
//         mitigated: false,
//         timestamp: candle2.timestamp
//       });
//     }

//     // Bearish FVG: Gap between candle 1 low and candle 3 high
//     if (candle3.high < candle1.low) {
//       aois.push({
//         id: `FVG_BEAR_${candle2.timestamp}`,
//         type: 'BEARISH_FVG',
//         high: candle1.low,
//         low: candle3.high,
//         mitigated: false,
//         timestamp: candle2.timestamp
//       });
//     }
//   }

//   return aois;
// }
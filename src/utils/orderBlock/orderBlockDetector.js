/**
 * Automatically calculates Order Blocks and Fair Value Gaps (FVGs) from historical price bars.
 * @param {Array} bars - Array of OHLCV bars [{ timestamp, open, high, low, close }]
 * @returns {Array} List of detected zones (AOIs including OBs and FVGs)
 */
export function calculateOrderBlocks(bars) {
  const aois = [];
  if (!bars || bars.length < 5) return aois;

  // 1. Detect Order Blocks (OB)
  for (let i = 2; i < bars.length - 2; i++) {
    const prev = bars[i - 1];
    const curr = bars[i];
    const next1 = bars[i + 1];
    const next2 = bars[i + 2];

    // Bullish Order Block: Last bearish candle before a strong upward impulsive break
    const isBearishCandle = curr.close < curr.open;
    const isImpulseUp = next1.close > curr.high && next2.close > next1.high;

    if (isBearishCandle && isImpulseUp) {
      aois.push({
        id: `OB_BULL_${curr.timestamp}`,
        type: 'BULLISH_OB',
        high: curr.high,
        low: curr.low,
        mitigated: false,
        timestamp: curr.timestamp
      });
    }

    // Bearish Order Block: Last bullish candle before a strong downward impulsive break
    const isBullishCandle = curr.close > curr.open;
    const isImpulseDown = next1.close < curr.low && next2.close < next1.low;

    if (isBullishCandle && isImpulseDown) {
      aois.push({
        id: `OB_BEAR_${curr.timestamp}`,
        type: 'BEARISH_OB',
        high: curr.high,
        low: curr.low,
        mitigated: false,
        timestamp: curr.timestamp
      });
    }
  }

  // 2. Detect Fair Value Gaps (FVG) - 3-candle imbalance pattern
  for (let i = 1; i < bars.length - 1; i++) {
    const candle1 = bars[i - 1];
    const candle2 = bars[i]; // Displacement candle
    const candle3 = bars[i + 1];

    // Bullish FVG: Gap between candle 1 high and candle 3 low
    if (candle3.low > candle1.high) {
      aois.push({
        id: `FVG_BULL_${candle2.timestamp}`,
        type: 'BULLISH_FVG',
        high: candle3.low,
        low: candle1.high,
        mitigated: false,
        timestamp: candle2.timestamp
      });
    }

    // Bearish FVG: Gap between candle 1 low and candle 3 high
    if (candle3.high < candle1.low) {
      aois.push({
        id: `FVG_BEAR_${candle2.timestamp}`,
        type: 'BEARISH_FVG',
        high: candle1.low,
        low: candle3.high,
        mitigated: false,
        timestamp: candle2.timestamp
      });
    }
  }

  return aois;
}
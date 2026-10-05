/**
 * Automatically calculates Order Blocks (AOIs) from historical price bars.
 * @param {Array} bars - Array of OHLCV bars [{ timestamp, open, high, low, close }]
 * @returns {Array} List of detected Order Block zones (AOIs)
 */
export function calculateOrderBlocks(bars) {
  const aois = [];
  if (!bars || bars.length < 5) return aois;

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

  return aois;
}
/**
 * Detects structural confirmation shifts (CHoCH / BOS) for the ICC strategy.
 * @param {Array} bars - Array of price bar objects { timestamp, open, high, low, close }
 * @param {string} trendBias - 'BULLISH' or 'BEARISH'
 * @returns {Array} List of structure events detected
 */
export function detectStructureShifts(bars, trendBias) {
  const events = [];
  
  if (!bars || !Array.isArray(bars)) return events;

  for (let i = 2; i < bars.length; i++) {
    const prev = bars[i - 1];
    const curr = bars[i];

    if (trendBias === 'BEARISH' && curr.close < prev.low) {
      events.push({
        type: 'CHOCH',
        direction: 'BEARISH',
        priceLevel: prev.low,
        timestamp: curr.timestamp
      });
    } else if (trendBias === 'BULLISH' && curr.close > prev.high) {
      events.push({
        type: 'CHOCH',
        direction: 'BULLISH',
        priceLevel: prev.high,
        timestamp: curr.timestamp
      });
    }
  }
  
  return events;
}
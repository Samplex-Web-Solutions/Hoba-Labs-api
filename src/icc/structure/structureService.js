/**
 * Detects structural breaks (CHoCH and BOS) on lower timeframes.
 * @param {Array} bars - Price history array [{ timestamp, open, high, low, close }]
 * @param {string} bias - 'BULLISH' or 'BEARISH'
 * @returns {Array} List of detected structural events
 */
export function detectStructureShifts(bars, bias) {
  const events = [];
  if (!bars || bars.length < 3) return events;

  for (let i = 2; i < bars.length; i++) {
    const prev = bars[i - 1];
    const curr = bars[i];

    if (bias === 'BEARISH' && curr.close < prev.low) {
      events.push({
        type: 'CHOCH',
        direction: 'BEARISH',
        priceLevel: prev.low,
        timestamp: curr.timestamp
      });
    } else if (bias === 'BULLISH' && curr.close > prev.high) {
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
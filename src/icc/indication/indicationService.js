/**
 * Determines the higher-timeframe market trend bias.
 * @param {Array} bars - Array of historical price bars
 * @returns {string} 'BULLISH' or 'BEARISH'
 */
export function detectTrendBias(bars) {
  if (!bars || bars.length < 20) return 'NEUTRAL';

  // Simple Moving Average or recent price action comparison
  const recentClose = bars[bars.length - 1].close;
  const pastClose = bars[bars.length - 20].close;

  if (recentClose > pastClose) {
    return 'BULLISH';
  } else if (recentClose < pastClose) {
    return 'BEARISH';
  }
  
  return 'NEUTRAL';
}
/**
 * Calculates dynamic lot size for XAUUSD or major forex pairs based on risk percentage.
 * @param {number} equity - Current account equity
 * @param {number} riskPercentage - User risk limit (e.g., 1.00 for 1%)
 * @param {number} stopLossPips - Stop loss distance in pips
 * @param {string} symbol - Trading symbol (default XAUUSD)
 */
export function calculateLotSize(equity, riskPercentage, stopLossPips, symbol = 'XAUUSD') {
  const riskAmount = (equity * (riskPercentage / 100));
  
  // Standard pip value calculations (Simplified for XAUUSD / Forex standard lots)
  // For XAUUSD, 1 standard lot = 100 oz. 1 pip ($0.10 move per oz for standard lot = $10 per pip per lot)
  let dollarValuePerPipPerLot = 10.0; 
  if (symbol.toUpperCase() === 'XAUUSD') {
    dollarValuePerPipPerLot = 1.0; // Adjust according to broker contract specifications if needed
  }

  const calculatedLots = riskAmount / (stopLossPips * dollarValuePerPipPerLot);

  // Clamp between micro-lot (0.01) and max safety limit (50.0)
  const finalLotSize = Math.max(0.01, Math.min(calculatedLots, 50.0));

  // Round to 2 decimal places for MetaTrader compatibility
  return Number(finalLotSize.toFixed(2));
}
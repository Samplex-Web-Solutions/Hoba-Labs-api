import { detectStructureShifts } from '../structure/structureService.js';

/**
 * Validates if the market has printed proper confirmation after tapping an AOI.
 * @param {Array} bars - Lower timeframe bars
 * @param {string} bias - Higher timeframe bias
 * @returns {boolean} True if confirmed
 */
export function validateConfirmation(bars, bias) {
  const structureEvents = detectStructureShifts(bars, bias);
  // Ensure we have at least one structural shift confirming the continuation
  return structureEvents.length > 0;
}
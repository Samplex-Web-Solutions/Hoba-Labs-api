/**
 * Validates the incoming market data payload for the ICC engine.
 * @param {Object} payload 
 * @returns {Object} { isValid: boolean, message: string }
 */
export function validateIccPayload(payload) {
  if (!payload) {
    return { isValid: false, message: 'Payload is empty' };
  }

  const { pair, bars, aois, bias } = payload;

  if (!pair || typeof pair !== 'string') {
    return { isValid: false, message: 'Invalid or missing "pair" string' };
  }

  if (!Array.isArray(bars) || bars.length < 20) {
    return { isValid: false, message: '"bars" must be an array with at least 20 historical price bars' };
  }

  if (!Array.isArray(aois) || aois.length === 0) {
    return { isValid: false, message: '"aois" must be a non-empty array of zones' };
  }

  if (!['BULLISH', 'BEARISH'].includes(bias)) {
    return { isValid: false, message: '"bias" must be either "BULLISH" or "BEARISH"' };
  }

  return { isValid: true, message: 'Payload is valid' };
}
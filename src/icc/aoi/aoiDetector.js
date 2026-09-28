/**
 * Checks if the current market price is reacting inside an active Area of Interest (AOI).
 * @param {number} currentPrice 
 * @param {Array} aois - List of active AOI objects
 * @returns {Object|null} The targeted AOI or null if no tap is detected
 */
export function checkAoiTap(currentPrice, aois) {
  if (!aois || !Array.isArray(aois)) return null;
  
  for (const aoi of aois) {
    if (!aoi.mitigated && currentPrice >= aoi.low && currentPrice <= aoi.high) {
      return aoi; // Price is reacting inside the unmitigated zone
    }
  }
  return null;
}
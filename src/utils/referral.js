/**
 * Generates a brand-aligned referral code starting with "HOBA-"
 * @param {string} firstName 
 * @returns {string} e.g., HOBA-SAM4829
 */
export function generateReferralCode(firstName) {
  const cleanName = (firstName || 'TRADER').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  return `HOBA-${cleanName}${randomNum}`;
}
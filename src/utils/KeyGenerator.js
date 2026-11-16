import crypto from 'crypto';

export function generateLicenseKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const segment = () => Array.from(crypto.randomBytes(4))
    .map(b => chars[b % chars.length])
    .join('');
  return `HOBA-${segment()}-${segment()}-2026`;
}
/**
 * Punjabi Recovery Passphrase Engine (Phase 1 / IMP-06).
 * Derives a human-friendly, culturally authentic 6-word recovery & pairing passphrase
 * for guest accounts and multi-device library sync without requiring passwords.
 */

export const PUNJABI_WORDS: readonly string[] = [
  'dhol',
  'tumbi',
  'amber',
  'sartaaj',
  'bhangra',
  'chandigarh',
  'mohali',
  'majha',
  'doaba',
  'malwa',
  'sufi',
  'mehfil',
  'sitara',
  'gabru',
  'kalam',
  'ishq',
] as const;

/** Simple deterministic string hash (FNV-1a 32-bit) */
function hashString(str: string): number[] {
  let h1 = 0x811c9dc5;
  let h2 = 0x5b79e2c1;
  const bytes: number[] = [];

  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code;
    h2 = Math.imul(h2, 0x01000193);
    bytes.push(Math.abs(h1) & 0xff);
  }

  // Ensure at least 8 pseudo-random bytes
  while (bytes.length < 8) {
    h1 = Math.imul(h1 ^ 0x9e3779b9, 0x01000193);
    bytes.push(Math.abs(h1) & 0xff);
  }

  return bytes;
}

/**
 * Seed string (e.g. deviceId ya userId) se deterministic 6-word Punjabi pairing passphrase banata hai.
 * Format: `word1-word2-word3-word4-word5-NNN` (e.g. `dhol-bhangra-amber-sartaaj-mohali-482`).
 */
export function derivePunjabiPassphrase(seed: string): string {
  if (!seed || typeof seed !== 'string') {
    throw new Error('Seed string is required to derive passphrase');
  }

  const bytes = hashString(seed);
  const picked: string[] = [];
  const wordCount = PUNJABI_WORDS.length;

  for (let i = 0; i < 5; i++) {
    const idx = (bytes[i] + i * 3) % wordCount;
    picked.push(PUNJABI_WORDS[idx]);
  }

  const num = 100 + ((bytes[5] * 7 + bytes[6]) % 900);
  return `${picked.join('-')}-${num}`;
}

/**
 * Check karta hai ki di gayi passphrase valid Punjabi passphrase format me hai ya nahi.
 */
export function validatePunjabiPassphrase(passphrase: string): boolean {
  if (typeof passphrase !== 'string') return false;
  const parts = passphrase.trim().toLowerCase().split('-');
  if (parts.length !== 6) return false;

  // Pehle 5 parts PUNJABI_WORDS me hone chahiye
  for (let i = 0; i < 5; i++) {
    if (!PUNJABI_WORDS.includes(parts[i])) return false;
  }

  // 6th part 3-digit number hona chahiye
  const num = Number(parts[5]);
  return Number.isInteger(num) && num >= 100 && num <= 999;
}


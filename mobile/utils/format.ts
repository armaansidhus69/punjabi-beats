/**
 * Formatting helpers — player timestamps ke liye (pure functions, testable).
 */

/** ms → "m:ss" (e.g. 185000 → "3:05"); invalid/negative pe "0:00" */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** position/duration ka 0..1 ratio — duration 0 pe safe (NaN nahi deta) */
export function progressRatio(position: number, duration: number): number {
  if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, position / duration));
}

/** User/guest display name ko sanitize karta hai (max 24 chars, strips control chars) */
export function cleanName(value: string | undefined | null, fallback = 'Guest'): string {
  const cleaned = (value ?? '').replace(/[\u0000-\u001F]/g, '').trim().slice(0, 24);
  return cleaned || fallback;
}

/** Artist + Album pair se safe URI routing key generate karta hai */
export function albumKey(artist: string, album: string): string {
  return encodeURIComponent(`${artist}:::${album}`);
}

/** Album routing key ko wapas artist aur album me parse karta hai */
export function parseAlbumKey(key: string): { artist: string; album: string } | null {
  try {
    const decoded = decodeURIComponent(key);
    const split = decoded.split(':::');
    if (split.length < 2) return null;
    const artist = split[0]?.trim();
    const album = split.slice(1).join(':::').trim();
    if (!artist || !album) return null;
    return { artist, album };
  } catch {
    return null;
  }
}

/** Naam se 2-letter uppercase initials nikaalta hai (avatar icons ke liye) */
export function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean).slice(0, 2);
  if (!parts.length) return 'PB';
  return parts.map(part => part[0]?.toUpperCase() ?? '').join('');
}

/**
 * SSRF security guard: Check karta hai ki di gayi URL public Internet URL hai ya nahi.
 * Localhost, loopback (127.0.0.1, ::1), internal domains (.local, .internal),
 * aur private RFC1918 subnets (10.x, 172.16-31.x, 192.168.x, 169.254.x) ko block karta hai.
 */
export function isPublicHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
    if (host === '0.0.0.0' || host === '::1') return false;
    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
      const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
      if (a === 10 || a === 127 || a === 0) return false;
      if (a === 169 && b === 254) return false;
      if (a === 192 && b === 168) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
    }
    return true;
  } catch {
    return false;
  }
}


/**
 * Lyrics client-core (Phase 7a) — pure, headless-testable.
 *
 * LRC parsing + karaoke line lookup + cache helpers. Koi network/storage
 * import nahi — service layer unse jodta hai. Synced format LRCLIB ka
 * standard LRC: `[mm:ss.xx] line text` (multi-timestamp supported).
 */

import type { LyricsCacheEnvelope, LyricsData, LyricsLine } from '../../types';

export const LYRICS_CACHE_CAP = 50;
export const LYRICS_SHARE_MAX_LINES = 4;
export const LYRICS_SHARE_MAX_CHARS = 280;
export const LYRICS_SHARE_MAX_LINE_CHARS = 160;

export interface LyricsExcerpt {
  lines: string[];
  /** null for plain/untimed lyrics; synced first line can validly be 0 */
  startMs: number | null;
}

/* ------------------------------ LRC parsing ------------------------------ */

/** `[mm:ss.xx]` | `[mm:ss.zzz]` — brackets caller pehle hata deta hai */
const TIMESTAMP_TAG = /^(\d+):(\d+)(?:[.:](\d+))?$/;

/** pehla timestamp nikaalo — index + end split — loop me hi */
function matchTimestampTag(tag: string): { minutes: number; seconds: number; fractionMs: number } | null {
  const match = TIMESTAMP_TAG.exec(tag.trim());
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds >= 60) return null;
  const fraction = (match[3] ?? '').slice(0, 3);
  // `.1` = 100ms, `.12` = 120ms, `.123` = 123ms.
  const fractionMs = fraction.length > 0 ? Number(fraction.padEnd(3, '0')) : 0;
  return { minutes, seconds, fractionMs };
}

/**
 * Raw LRC → sorted LyricsLine[]. Multi-timestamp lines expand hote (ek
 * text ko do jagah gaaya). Meta tags `[by:...]`/`[offset:...]` line-drop
 * — offset special: positive = lyrics earlier (time - offset).
 * Junk/empty text drop ho jata hai.
 */
export function parseLrc(raw: string): LyricsLine[] {
  if (typeof raw !== 'string' || raw.trim().length === 0) return [];

  // offset tag optional — positive ms shifts lyrics earlier: `+300` drops 300ms
  let offsetMs = 0;
  const offsetMatch = /^\[offset:\s*([+-]?\d+)\s*\]$/im.exec(raw);
  if (offsetMatch) offsetMs = Number(offsetMatch[1]) || 0;

  const lines: LyricsLine[] = [];
  const rawLines = raw.split(/\r?\n/);

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) continue;

    // sab leading timestamp tags collect — pehli non-tag baad text hota
    const timestamps: number[] = [];
    let index = 0;
    let textStart = 0;
    while (trimmed[index] === '[') {
      const closeIndex = trimmed.indexOf(']', index);
      if (closeIndex < 0) break;
      const tag = trimmed.slice(index + 1, closeIndex);
      const stamp = matchTimestampTag(tag);
      if (stamp === null) {
        // non-timestamp tag ([by:x]) — pehla tag hi to line meta thi
        if (timestamps.length === 0) {
          textStart = -1;
          break;
        }
        index = closeIndex + 1;
        textStart = index;
        continue;
      }
      timestamps.push(stamp.minutes * 60_000 + stamp.seconds * 1000 + stamp.fractionMs);
      index = closeIndex + 1;
      textStart = index;
    }

    if (textStart < 0) continue; // pure meta line drop
    const text = trimmed.slice(textStart).trim();
    if (text.length === 0 || timestamps.length === 0) continue;

    for (const timeMs of timestamps) {
      lines.push({ text, timeMs: Math.max(0, timeMs - offsetMs) });
    }
  }

  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

/** synced lines (har timeMs>0 nahi — pehla 0 allowed) vs plain guard */
export function isSyncedLines(lines: LyricsLine[]): boolean {
  return lines.length > 0 && lines.every(isLyricsLine);
}

/** plain text → unsynced lines (timeMs 0 sab — approx share highlight) */
export function plainToLines(plain: string, durationMs: number): LyricsLine[] {
  void durationMs; // API parity: highlight timing screen progress-share se aati hai
  const rows = (plain ?? '')
    .split(/\r?\n/)
    .map(row => row.trim())
    .filter(row => row.length > 0);

  const lines = rows.map(text => ({
    text,
    timeMs: 0,
  }));
  return lines;
}

/* ------------------------------ karaoke lookup ------------------------------ */

/**
 * Current line index: LAST line jiska timeMs <= positionMs (tail match).
 * Position pehle line se pehle → -1 (caller 0 clamp kare); empty lines →
 * -1 bhi. Pure — boundaries headless test me.
 */
export function lineAt(lines: LyricsLine[], positionMs: number): number {
  if (!Array.isArray(lines) || lines.length === 0) return -1;
  if (!Number.isFinite(positionMs) || positionMs < 0) return -1;

  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (lines[mid].timeMs <= positionMs) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/* ------------------------------ share selection ------------------------------ */

export function selectionRange(
  anchor: number,
  target: number,
  totalLines: number,
): number[] | null {
  if (
    !Number.isInteger(anchor) ||
    !Number.isInteger(target) ||
    !Number.isInteger(totalLines) ||
    totalLines <= 0 ||
    anchor < 0 ||
    target < 0 ||
    anchor >= totalLines ||
    target >= totalLines
  ) {
    return null;
  }
  const start = Math.min(anchor, target);
  const end = Math.max(anchor, target);
  const count = end - start + 1;
  if (count > LYRICS_SHARE_MAX_LINES) return null;
  return Array.from({ length: count }, (_value, index) => start + index);
}

function shareLineText(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

export function lyricsExcerpt(
  source: LyricsLine[],
  indices: number[],
  synced: boolean,
): LyricsExcerpt | null {
  if (indices.length === 0 || indices.length > LYRICS_SHARE_MAX_LINES) return null;
  for (let index = 0; index < indices.length; index += 1) {
    const value = indices[index];
    if (
      !Number.isInteger(value) ||
      value < 0 ||
      value >= source.length ||
      (index > 0 && value !== indices[index - 1] + 1)
    ) {
      return null;
    }
  }
  const lines = indices.map(index => shareLineText(source[index].text));
  if (
    lines.some(line => line.length === 0 || codePointLength(line) > LYRICS_SHARE_MAX_LINE_CHARS) ||
    codePointLength(lines.join('\n')) > LYRICS_SHARE_MAX_CHARS
  ) {
    return null;
  }
  const first = source[indices[0]];
  const startMs = synced
    ? typeof first.timeMs === 'number' && Number.isFinite(first.timeMs) && first.timeMs >= 0
      ? Math.round(first.timeMs)
      : null
    : null;
  if (synced && startMs === null) return null;
  return { lines, startMs };
}

/* ------------------------------ cache helpers ------------------------------ */

type CacheMap = Record<string, LyricsData>;

function isLyricsLine(value: unknown): value is LyricsLine {
  if (value === null || typeof value !== 'object') return false;
  const line = value as Partial<LyricsLine>;
  return (
    typeof line.text === 'string' &&
    line.text.length > 0 &&
    typeof line.timeMs === 'number' &&
    Number.isFinite(line.timeMs) &&
    line.timeMs >= 0
  );
}

function isLyricsData(value: unknown): value is LyricsData {
  if (value === null || typeof value !== 'object') return false;
  const entry = value as Partial<LyricsData>;
  return (
    typeof entry.synced === 'boolean' &&
    Array.isArray(entry.lines) &&
    entry.lines.length > 0 &&
    entry.lines.every(isLyricsLine) &&
    typeof entry.plain === 'string' &&
    typeof entry.artist === 'string' &&
    typeof entry.title === 'string' &&
    typeof entry.fetchedAt === 'number' &&
    Number.isFinite(entry.fetchedAt) &&
    entry.fetchedAt >= 0
  );
}

/** restore guard — corrupt/galat version → empty cache (honest reset) */
export function cacheFromEnvelope(raw: unknown): CacheMap {
  if (raw === null || typeof raw !== 'object') return {};
  const envelope = raw as Partial<LyricsCacheEnvelope>;
  if (
    envelope.version !== 1 ||
    envelope.lyrics === null ||
    typeof envelope.lyrics !== 'object' ||
    Array.isArray(envelope.lyrics)
  ) {
    return {};
  }
  const clean: CacheMap = {};
  for (const [songId, entry] of Object.entries(envelope.lyrics)) {
    if (
      typeof songId === 'string' &&
      songId.length > 0 &&
      isLyricsData(entry)
    ) {
      clean[songId] = entry as LyricsData;
    }
  }
  return clean;
}

export function cacheToEnvelope(cache: CacheMap): LyricsCacheEnvelope {
  return { version: 1, lyrics: cache };
}

export function cacheGet(cache: CacheMap, songId: string): LyricsData | null {
  return cache[songId] ?? null;
}

/** put + cap 50 oldest-drop (fetchedAt ordering), refresh entry bump */
export function cachePut(cache: CacheMap, songId: string, data: LyricsData): CacheMap {
  if (songId.length === 0) return cache;
  const entries = Object.entries({ ...cache, [songId]: data });
  if (entries.length <= LYRICS_CACHE_CAP) {
    return Object.fromEntries(entries);
  }
  // sab oldest pehle — excess tab tak drop jab tak cap pe
  const sorted = entries.sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
  const kept = sorted.slice(sorted.length - LYRICS_CACHE_CAP);
  return Object.fromEntries(kept);
}

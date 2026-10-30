/**
 * Podcast transcript pure core (Phase 7b).
 *
 * Publisher VTT/SRT/JSON/HTML/plain text → ek common display segment model.
 * Koi fetch/storage/RN import nahi, isliye Node headless tests direct chalte.
 */

import type {
  PodcastTranscriptMime,
  PodcastTranscriptRef,
  TranscriptPositionEnvelope,
  TranscriptPositionEntry,
  TranscriptPositionMap,
  TranscriptSegment,
} from '../../types';

export const TRANSCRIPT_SEGMENT_CAP = 5000;
export const TRANSCRIPT_POSITION_CAP = 50;
export const TRANSCRIPT_SEARCH_CAP = 50;
export const JSON_CHUNK_MAX_CHARS = 240;
export const JSON_MERGE_GAP_MS = 1500;

const FORMAT_PRIORITY: Record<PodcastTranscriptMime, number> = {
  'text/vtt': 0,
  'application/x-subrip': 1,
  'application/json': 2,
  'text/html': 3,
  'text/plain': 4,
};

type SegmentDraft = Omit<TranscriptSegment, 'id'>;

/* ------------------------------ shared cleanup ------------------------------ */

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => safeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => safeCodePoint(Number(code)))
    .replace(/&amp;/gi, '&');
}

function safeCodePoint(value: number): string {
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff
    ? String.fromCodePoint(value)
    : '';
}

function textOnly(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000);
}

function cleanSpeaker(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = textOnly(value).slice(0, 80);
  return clean.length > 0 ? clean : null;
}

function finalizeSegments(drafts: SegmentDraft[]): TranscriptSegment[] {
  const clean: SegmentDraft[] = [];
  for (const draft of drafts) {
    const text = textOnly(draft.text);
    if (text.length === 0) continue;
    const startMs =
      typeof draft.startMs === 'number' && Number.isFinite(draft.startMs) && draft.startMs >= 0
        ? Math.round(draft.startMs)
        : null;
    const endMs =
      startMs !== null &&
      typeof draft.endMs === 'number' &&
      Number.isFinite(draft.endMs) &&
      draft.endMs >= startMs
        ? Math.round(draft.endMs)
        : null;
    clean.push({ startMs, endMs, speaker: cleanSpeaker(draft.speaker), text });
    if (clean.length >= TRANSCRIPT_SEGMENT_CAP) break;
  }

  // Fully timed formats should always be chronological. Mixed HTML order stays source-order.
  if (clean.length > 0 && clean.every(segment => segment.startMs !== null)) {
    clean.sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));
  }
  return clean.map((segment, index) => ({
    id: `${index}:${segment.startMs ?? 'u'}`,
    ...segment,
  }));
}

/* ------------------------------ format choice ------------------------------ */

export function chooseTranscriptRef(refs: PodcastTranscriptRef[]): PodcastTranscriptRef | null {
  let best: PodcastTranscriptRef | null = null;
  let bestPriority = Number.POSITIVE_INFINITY;
  for (const ref of refs) {
    const priority = FORMAT_PRIORITY[ref.type];
    if (priority < bestPriority) {
      best = ref;
      bestPriority = priority;
    }
  }
  return best;
}

/* ------------------------------ timestamps ------------------------------ */

/** VTT/SRT clock: hh:mm:ss.mmm, mm:ss.mmm, comma ya dot. */
export function parseTranscriptTimestampMs(raw: string): number | null {
  const parts = raw.trim().replace(',', '.').split(':');
  if (parts.length !== 2 && parts.length !== 3) return null;
  const secondsPart = parts.at(-1) ?? '';
  const minutesPart = parts.at(-2) ?? '';
  const hoursPart = parts.length === 3 ? parts[0] : '0';
  if (
    !/^\d{1,2}(?:\.\d+)?$/.test(secondsPart) ||
    !/^\d+$/.test(minutesPart) ||
    !/^\d+$/.test(hoursPart)
  ) {
    return null;
  }
  const seconds = Number(secondsPart);
  const minutes = Number(minutesPart);
  const hours = Number(hoursPart);
  if (
    !Number.isFinite(seconds) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(hours) ||
    !Number.isInteger(minutes) ||
    !Number.isInteger(hours) ||
    seconds < 0 ||
    seconds >= 60 ||
    minutes < 0 ||
    (parts.length === 3 && minutes >= 60) ||
    hours < 0
  ) {
    return null;
  }
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}

function timingLine(raw: string): { startMs: number; endMs: number | null } | null {
  const match = /^\s*(\S+)\s+-->\s+(\S+)/.exec(raw);
  if (!match) return null;
  const startMs = parseTranscriptTimestampMs(match[1]);
  const endMs = parseTranscriptTimestampMs(match[2]);
  if (startMs === null) return null;
  return { startMs, endMs: endMs !== null && endMs >= startMs ? endMs : null };
}

/* ------------------------------ WebVTT ------------------------------ */

function vttSpeakerAndText(raw: string): { speaker: string | null; text: string } {
  const match = /<v(?:\.[^ >]+)*\s+([^>]+)>/i.exec(raw);
  return {
    speaker: cleanSpeaker(match?.[1] ?? null),
    text: raw.replace(/<v(?:\.[^ >]+)*\s+[^>]+>/gi, ' ').replace(/<\/v>/gi, ' '),
  };
}

export function parseWebVtt(raw: string): TranscriptSegment[] {
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const blocks = normalized.split(/\n\s*\n/);
  const drafts: SegmentDraft[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const timingIndex = lines.findIndex(line => line.includes('-->'));
    if (timingIndex < 0) continue; // WEBVTT/NOTE/STYLE/REGION block
    const timing = timingLine(lines[timingIndex]);
    if (!timing) continue;
    const body = lines.slice(timingIndex + 1).join(' ');
    const parsed = vttSpeakerAndText(body);
    drafts.push({ ...timing, speaker: parsed.speaker, text: parsed.text });
  }
  return finalizeSegments(drafts);
}

/* ------------------------------ SRT ------------------------------ */

function splitSpeakerPrefix(raw: string): { speaker: string | null; text: string } {
  const match = /^([^:\n]{1,40}):\s+([\s\S]+)$/.exec(raw.trim());
  if (!match) return { speaker: null, text: raw };
  return { speaker: cleanSpeaker(match[1]), text: match[2] };
}

export function parseSrt(raw: string): TranscriptSegment[] {
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const drafts: SegmentDraft[] = [];
  for (const block of normalized.split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const timingIndex = lines.findIndex(line => line.includes('-->'));
    if (timingIndex < 0) continue;
    const timing = timingLine(lines[timingIndex]);
    if (!timing) continue;
    const parsed = splitSpeakerPrefix(lines.slice(timingIndex + 1).join(' '));
    drafts.push({ ...timing, speaker: parsed.speaker, text: parsed.text });
  }
  return finalizeSegments(drafts);
}

/* ------------------------------ Podcast JSON ------------------------------ */

interface JsonSegment {
  speaker?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  body?: unknown;
}

function sentenceEnds(text: string): boolean {
  return /[.!?]["')\]]?$/.test(text.trim());
}

export function parseJsonTranscript(raw: string): TranscriptSegment[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const source = (parsed as { segments?: unknown }).segments;
  if (!Array.isArray(source)) return [];

  const rows: SegmentDraft[] = [];
  for (const value of source) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
    const item = value as JsonSegment;
    if (typeof item.body !== 'string' || typeof item.startTime !== 'number') continue;
    if (!Number.isFinite(item.startTime) || item.startTime < 0) continue;
    const startMs = Math.round(item.startTime * 1000);
    const endMs =
      typeof item.endTime === 'number' &&
      Number.isFinite(item.endTime) &&
      item.endTime >= item.startTime
        ? Math.round(item.endTime * 1000)
        : null;
    const text = textOnly(item.body);
    if (text.length === 0) continue;
    rows.push({ startMs, endMs, speaker: cleanSpeaker(item.speaker), text });
  }
  rows.sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));

  const chunks: SegmentDraft[] = [];
  for (const row of rows) {
    const previous = chunks.at(-1);
    if (!previous) {
      chunks.push({ ...row });
      continue;
    }
    const previousEnd = previous.endMs ?? previous.startMs ?? 0;
    const rowStart = row.startMs ?? previousEnd;
    const gap = rowStart - previousEnd;
    const mergedText = `${previous.text} ${row.text}`.trim();
    const sameSpeaker = previous.speaker === row.speaker;
    const canMerge =
      sameSpeaker &&
      gap >= 0 &&
      gap <= JSON_MERGE_GAP_MS &&
      mergedText.length <= JSON_CHUNK_MAX_CHARS &&
      !sentenceEnds(previous.text);
    if (canMerge) {
      previous.text = mergedText;
      previous.endMs = row.endMs ?? previous.endMs;
    } else {
      chunks.push({ ...row });
    }
  }
  return finalizeSegments(chunks);
}

/* ------------------------------ HTML + plain ------------------------------ */

export function parseHtmlTranscript(raw: string): TranscriptSegment[] {
  const safe = raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  const tokenRegex = /<(cite|time|p)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  const drafts: SegmentDraft[] = [];
  let speaker: string | null = null;
  let startMs: number | null = null;
  let match: RegExpExecArray | null;
  let sawParagraph = false;
  while ((match = tokenRegex.exec(safe)) !== null) {
    const tag = match[1].toLowerCase();
    if (tag === 'cite') {
      speaker = cleanSpeaker(match[2].replace(/:\s*$/, ''));
    } else if (tag === 'time') {
      startMs = parseTranscriptTimestampMs(textOnly(match[2]));
    } else {
      sawParagraph = true;
      drafts.push({ startMs, endMs: null, speaker, text: match[2] });
      startMs = null;
    }
  }
  if (sawParagraph) return finalizeSegments(drafts);

  const plainish = safe
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]*>/g, ' ');
  return parsePlainTranscript(decodeEntities(plainish));
}

export function parsePlainTranscript(raw: string): TranscriptSegment[] {
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (normalized.length === 0) return [];
  let parts = normalized.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean);
  if (parts.length <= 1) {
    const lines = normalized.split('\n').map(line => line.trim()).filter(Boolean);
    if (lines.length > 1) parts = lines;
  }
  return finalizeSegments(
    parts.map(text => ({ startMs: null, endMs: null, speaker: null, text })),
  );
}

export function parseTranscriptByMime(
  mimeType: PodcastTranscriptMime,
  raw: string,
): TranscriptSegment[] {
  switch (mimeType) {
    case 'text/vtt':
      return parseWebVtt(raw);
    case 'application/x-subrip':
      return parseSrt(raw);
    case 'application/json':
      return parseJsonTranscript(raw);
    case 'text/html':
      return parseHtmlTranscript(raw);
    case 'text/plain':
      return parsePlainTranscript(raw);
  }
}

/* ------------------------------ playback + search ------------------------------ */

/** Latest timed segment whose start <= position; before-first/untimed → -1. */
export function segmentAt(segments: TranscriptSegment[], positionMs: number): number {
  if (!Number.isFinite(positionMs) || positionMs < 0) return -1;
  let found = -1;
  let latestStart = -1;
  for (let index = 0; index < segments.length; index += 1) {
    const startMs = segments[index].startMs;
    if (startMs === null) continue;
    if (startMs <= positionMs && startMs >= latestStart) {
      found = index;
      latestStart = startMs;
    }
  }
  return found;
}

export function searchTranscript(
  segments: TranscriptSegment[],
  query: string,
  cap: number = TRANSCRIPT_SEARCH_CAP,
): number[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length < 2 || cap <= 0) return [];
  const hits: number[] = [];
  for (let index = 0; index < segments.length && hits.length < cap; index += 1) {
    const segment = segments[index];
    const haystack = `${segment.speaker ?? ''}\n${segment.text}`.toLocaleLowerCase();
    if (haystack.includes(needle)) hits.push(index);
  }
  return hits;
}

/* ------------------------------ reading-position map ------------------------------ */

function isPositionEntry(value: unknown): value is TranscriptPositionEntry {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Partial<TranscriptPositionEntry>;
  return (
    typeof entry.sourceUrl === 'string' &&
    entry.sourceUrl.length > 0 &&
    typeof entry.segmentIndex === 'number' &&
    Number.isInteger(entry.segmentIndex) &&
    entry.segmentIndex >= 0 &&
    typeof entry.updatedAt === 'string' &&
    Number.isFinite(Date.parse(entry.updatedAt))
  );
}

export function normalizeTranscriptPositions(raw: unknown): TranscriptPositionMap {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const envelope = raw as Partial<TranscriptPositionEnvelope>;
  if (
    envelope.version !== 1 ||
    envelope.positions === null ||
    typeof envelope.positions !== 'object' ||
    Array.isArray(envelope.positions)
  ) {
    return {};
  }
  const clean: TranscriptPositionMap = {};
  for (const [episodeId, entry] of Object.entries(envelope.positions)) {
    if (episodeId.length > 0 && isPositionEntry(entry)) clean[episodeId] = entry;
  }
  return clean;
}

export function transcriptPositionsToEnvelope(
  positions: TranscriptPositionMap,
): TranscriptPositionEnvelope {
  return { version: 1, positions };
}

export function putTranscriptPosition(
  positions: TranscriptPositionMap,
  episodeId: string,
  entry: TranscriptPositionEntry,
): TranscriptPositionMap {
  if (episodeId.length === 0 || !isPositionEntry(entry)) return positions;
  const rows = Object.entries({ ...positions, [episodeId]: entry });
  rows.sort((a, b) => Date.parse(a[1].updatedAt) - Date.parse(b[1].updatedAt));
  return Object.fromEntries(rows.slice(Math.max(0, rows.length - TRANSCRIPT_POSITION_CAP)));
}

export function positionForTranscript(
  positions: TranscriptPositionMap,
  episodeId: string,
  sourceUrl: string,
  segmentCount: number,
): number | null {
  const entry = positions[episodeId];
  if (!entry || entry.sourceUrl !== sourceUrl || segmentCount <= 0) return null;
  return Math.min(segmentCount - 1, Math.max(0, entry.segmentIndex));
}

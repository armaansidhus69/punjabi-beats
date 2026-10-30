/**
 * Podcast RSS/ATOM parser (Phase 12a) — feed XML → episodes, pure.
 *
 * Contract: input pe KABHI throw nahi — malformed item skip hota hai,
 * garbage input → empty result (service lookup fallback use karega).
 *
 * Design: tag walker raw text pe chalta hai (unescape sirf LEAF READ pe —
 * double-unescape bug se bachne ke liye), enclosure/duration/audio rules
 * spec ke mutabik (audio enclosure missing → item null).
 */

import type {
  PodcastEpisode,
  PodcastShow,
  PodcastTranscriptMime,
  PodcastTranscriptRef,
} from '../../types';

/** Raw feed item — episode.ts adapters isko PodcastEpisode banate hain */
export interface RssEpisode {
  title: string;
  /** enclosure url — invalid episode adapters null deta hain */
  audioUrl: string;
  rawDurationSec: string | null;
  description: string | null;
  /** ISO ya '' (invalid/missing date) */
  publishedAt: string;
  artworkUrl: string | null;
  transcripts: PodcastTranscriptRef[];
}

export interface ParsedFeed {
  title: string;
  artist: string;
  artworkUrl: string;
  episodes: RssEpisode[];
}

/* ------------------------------ primitives ------------------------------ */

/** entity + CDATA deflate — leaf text pe exactly once, walkers raw rehte */
export function unescapeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&');
}

/** description text me HTML strip — podbean/feedburner HTML blobs */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Tag {
  name: string;
  attrs: Map<string, string>;
  /** RAW inner (unescape nahi hua) */
  inner: string;
}

const PODCAST_NAMESPACE_URIS = new Set([
  'https://podcastindex.org/namespace/1.0',
  'https://github.com/podcastindex-org/podcast-namespace/blob/main/docs/1.0.md',
]);

const TRANSCRIPT_MIMES = new Set<PodcastTranscriptMime>([
  'text/vtt',
  'application/x-subrip',
  'application/json',
  'text/html',
  'text/plain',
]);

/** Publisher MIME normalize — charset suffix strip, common SRT alias tolerate. */
export function normalizeTranscriptMime(raw: string | null): PodcastTranscriptMime | null {
  const clean = (raw ?? '').split(';', 1)[0].trim().toLowerCase();
  const normalized = clean === 'application/srt' ? 'application/x-subrip' : clean;
  return TRANSCRIPT_MIMES.has(normalized as PodcastTranscriptMime)
    ? (normalized as PodcastTranscriptMime)
    : null;
}

/** Official namespace URI se actual XML prefixes; common `podcast` tolerate. */
export function transcriptNamespacePrefixes(xml: string): Set<string> {
  const prefixes = new Set<string>(['podcast']);
  const regex = /xmlns:([A-Za-z_][\w.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    const uri = unescapeXml(match[2] ?? match[3] ?? '').trim().toLowerCase();
    if (PODCAST_NAMESPACE_URIS.has(uri)) prefixes.add(match[1].toLowerCase());
  }
  return prefixes;
}

function readOpeningTag(tagRaw: string): { name: string; attrs: Map<string, string>; selfClosing: boolean } | null {
  const selfClosing = tagRaw.endsWith('/>');
  const head = tagRaw.slice(1, selfClosing ? tagRaw.length - 2 : tagRaw.length - 1).trim();
  const spaceIdx = head.search(/\s/);
  const name = (spaceIdx < 0 ? head : head.slice(0, spaceIdx)).toLowerCase();
  if (name.length === 0) return null;
  const attrs = new Map<string, string>();
  const attrPart = spaceIdx < 0 ? '' : head.slice(spaceIdx);
  const attrRegex = /([A-Za-z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(attrPart)) !== null) {
    attrs.set(match[1].toLowerCase(), unescapeXml(match[2] ?? match[3] ?? ''));
  }
  return { name, attrs, selfClosing };
}

/**
 * Depth-1 walker: `region` ke top-level children Tags. Raw kyun? leaf read
 * pe unescape exact once hota hai — HTML-in-description double unescape se
 * bach. `diveKids` children ko unescape NAA kare; sirf leaf reader unescape.
 */
function walkChildren(region: string): Tag[] {
  const tags: Tag[] = [];
  let idx = 0;
  let guard = region.length + 16;
  while (idx < region.length && guard-- > 0) {
    const open = region.indexOf('<', idx);
    if (open < 0) break;
    if (region.startsWith('</', open)) {
      // stray close tag (caller overshoot) — skip
      const stray = region.indexOf('>', open);
      if (stray < 0) break;
      idx = stray + 1;
      continue;
    }
    const close = region.indexOf('>', open);
    if (close < 0) break;
    const tagRaw = region.slice(open, close + 1);
    idx = close + 1;

    if (tagRaw.startsWith('<!--')) {
      const commentEnd = region.indexOf('-->', open);
      if (commentEnd < 0) break;
      idx = commentEnd + 3;
      continue;
    }
    if (tagRaw.startsWith('<!') || tagRaw.startsWith('<?')) continue;

    const parsed = readOpeningTag(tagRaw);
    if (!parsed) continue;

    if (parsed.selfClosing) {
      tags.push({ name: parsed.name, attrs: parsed.attrs, inner: '' });
      continue;
    }

    // same-name nested tags RSS feeds me practically nahi hote — pehli
    // `</name>` pe band karte hain (v1 simplification; documented)
    const nextClose = region.toLowerCase().indexOf(`</${parsed.name}>`, idx);
    const end = nextClose < 0 ? region.length : nextClose;
    const inner = region.slice(idx, end);
    idx = end + parsed.name.length + 3;
    tags.push({ name: parsed.name, attrs: parsed.attrs, inner });
  }
  return tags;
}

/** child tag leaf text, trim + unescape once; empty → null */
function firstText(rawInner: string, wanted: string): string | null {
  const hit = walkChildren(rawInner).find(tag => tag.name === wanted);
  const text = unescapeXml(hit?.inner ?? '').trim();
  return text.length > 0 ? text : null;
}

/* ------------------------------ scalar parse ------------------------------ */

/** "300" → 300; "1:02:03" → 3723; invalid/null → null */
export function parseItunesDuration(raw: string | null): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  if (!/^(\d+:){1,2}\d+$/.test(trimmed)) return null;
  return trimmed.split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
}

export function parseDateToIso(raw: string | null): string {
  if (!raw) return '';
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? '' : new Date(ms).toISOString();
}

/* ------------------------------ main parse ------------------------------ */

/**
 * RSS 2.0 (itunes ns) ya ATOM feed → ParsedFeed. Header metadata channel/
 * feed level; items/entries list. Unknown shape → empty result; service
 * fallback lookup chalata hai.
 */
export function parsePodcastFeed(xml: string): ParsedFeed {
  const emptyFeed: ParsedFeed = { title: '', artist: '', artworkUrl: '', episodes: [] };
  if (typeof xml !== 'string' || xml.trim().length === 0) return emptyFeed;

  const lower = xml.toLowerCase();
  const rssOpen = lower.indexOf('<channel');
  const atomOpen = lower.indexOf('<feed');
  const isRss = rssOpen >= 0 && (atomOpen < 0 || rssOpen < atomOpen);
  const start = isRss ? rssOpen + '<channel'.length : atomOpen + '<feed'.length;
  if (start < 0) return emptyFeed;

  const endRaw = isRss ? '</channel>' : '</feed>';
  const endRegion = lower.indexOf(endRaw, start);
  if (endRegion < 0) return emptyFeed;
  const region = xml.slice(start, endRegion);

  const tags = walkChildren(region);
  const transcriptPrefixes = transcriptNamespacePrefixes(xml);
  const title = tags.find(tag => tag.name === 'title')?.inner.trim() ?? '';
  // itunes:author plain text ho to direct; `<itunes:owner><name>` wrapper me
  // bhi author ho sakta hai — tags strip kar ke text
  const authorTag = tags.find(tag => tag.name === 'itunes:author');
  let artist = authorTag ? unescapeXml(authorTag.inner).trim() : '';
  if (artist === '') {
    const ownerTag = tags.find(tag => tag.name === 'itunes:owner');
    if (ownerTag) artist = stripHtml(unescapeXml(ownerTag.inner));
  }
  const channelImage = tags.find(tag => tag.name === 'image');
  const channelItunesImage = tags.find(tag => tag.name === 'itunes:image');
  const artworkUrl = channelItunesImage?.attrs.get('href') ?? (channelImage ? (firstText(channelImage.inner, 'url') ?? '') : '');

  const episodes: RssEpisode[] = [];
  for (const tag of tags) {
    if (tag.name === 'item') {
      const episode = itemToRssEpisode(tag, transcriptPrefixes);
      if (episode) episodes.push(episode);
    } else if (tag.name === 'entry') {
      const episode = entryToRssEpisode(tag, transcriptPrefixes);
      if (episode) episodes.push(episode);
    }
  }

  return { title: unescapeXml(title), artist: unescapeXml(artist), artworkUrl, episodes };
}

function transcriptRefsFromChildren(children: Tag[], prefixes: Set<string>): PodcastTranscriptRef[] {
  const names = new Set([...prefixes].map(prefix => `${prefix}:transcript`));
  const refs: PodcastTranscriptRef[] = [];
  const seen = new Set<string>();
  for (const child of children) {
    if (!names.has(child.name) || refs.length >= 10) continue;
    const rawUrl = (child.attrs.get('url') ?? '').trim();
    const type = normalizeTranscriptMime(child.attrs.get('type') ?? null);
    if (rawUrl.length === 0 || type === null) continue;
    try {
      if (new URL(rawUrl).protocol !== 'https:') continue;
    } catch {
      continue;
    }
    const languageRaw = (child.attrs.get('language') ?? '').trim();
    const language = languageRaw.length > 0 ? languageRaw : null;
    const relRaw = (child.attrs.get('rel') ?? '').trim().toLowerCase();
    const rel = relRaw.length > 0 ? relRaw : null;
    const key = `${rawUrl}\u0000${type}\u0000${language ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ url: rawUrl, type, language, rel });
  }
  return refs;
}

function itemToRssEpisode(item: Tag, transcriptPrefixes: Set<string>): RssEpisode | null {
  let title = '';
  let audioUrl: string | null = null;
  let rawDurationSec: string | null = null;
  let description: string | null = null;
  let publishedAt = '';
  let artworkUrl: string | null = null;
  const children = walkChildren(item.inner);
  const transcripts = transcriptRefsFromChildren(children, transcriptPrefixes);

  for (const child of children) {
    switch (child.name) {
      case 'title':
        if (title === '') title = unescapeXml(child.inner).trim();
        break;
      case 'enclosure': {
        if (audioUrl !== null) break;
        const url = child.attrs.get('url') ?? null;
        const type = child.attrs.get('type') ?? '';
        if (url && (type.startsWith('audio') || type === '')) audioUrl = url;
        break;
      }
      case 'itunes:duration':
        if (rawDurationSec === null) rawDurationSec = unescapeXml(child.inner);
        break;
      case 'itunes:summary':
      case 'description':
        if (description === null && child.inner.trim().length > 0) {
          description = stripHtml(unescapeXml(child.inner));
        }
        break;
      case 'pubdate':
        if (publishedAt === '') publishedAt = parseDateToIso(unescapeXml(child.inner));
        break;
      case 'itunes:image':
        if (artworkUrl === null) artworkUrl = child.attrs.get('href') ?? null;
        break;
      default:
        break;
    }
  }
  if (audioUrl === null) return null;
  return { title, audioUrl, rawDurationSec, description, publishedAt, artworkUrl, transcripts };
}

function entryToRssEpisode(entry: Tag, transcriptPrefixes: Set<string>): RssEpisode | null {
  let title = '';
  let audioUrl: string | null = null;
  let description: string | null = null;
  let publishedAt = '';
  const children = walkChildren(entry.inner);
  const transcripts = transcriptRefsFromChildren(children, transcriptPrefixes);

  for (const child of children) {
    switch (child.name) {
      case 'title':
        if (title === '') title = unescapeXml(child.inner).trim();
        break;
      case 'link': {
        const rel = child.attrs.get('rel') ?? '';
        const type = child.attrs.get('type') ?? '';
        if (rel === 'enclosure' || type.startsWith('audio')) {
          audioUrl = child.attrs.get('href') ?? null;
        }
        break;
      }
      case 'summary':
      case 'content':
        if (description === null && child.inner.trim().length > 0) {
          description = stripHtml(unescapeXml(child.inner));
        }
        break;
      case 'published':
      case 'updated':
        if (publishedAt === '') publishedAt = parseDateToIso(unescapeXml(child.inner));
        break;
      default:
        break;
    }
  }
  if (audioUrl === null) return null;
  return {
    title,
    audioUrl,
    rawDurationSec: null,
    description,
    publishedAt,
    artworkUrl: null,
    transcripts,
  };
}

/* ------------------------------ type re-exports ------------------------------ */

export type { PodcastEpisode, PodcastShow };

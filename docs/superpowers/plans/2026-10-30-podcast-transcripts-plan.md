# Phase 7b — Podcast Transcripts V1 Implementation Plan

Design: `docs/superpowers/specs/2026-10-30-podcast-transcripts-design.md`

Approach: existing RSS-first podcast flow extend karo; pure parsing/search/
position helpers headless first, phir service/store/UI. Publisher-provided
transcripts only—koi backend, API key, package, ya AI audio upload nahi.
Existing `podcasts_enabled` gate reuse hota hai.

Verified anchors:
- `core/podcast/rss.ts`: raw depth-1 tag walker + `RssEpisode`; RSS items
  yahin transcript refs discover karenge
- `core/podcast/episode.ts`: RSS/iTunes → `PodcastEpisode` adapters
- `stores/podcastStore.ts`: `playEpisode` + progress-aware resume; transcript
  jump isi action ke baad existing `playerStore.seek` use karega
- `components/EpisodeRow.tsx`: ab ek Pressable; transcript icon ke liye
  sibling Pressables me refactor (nested Pressable nahi)
- `app/podcast/[id].tsx`: RSS-backed detail episodes/transcript entry anchor
- `services/storage.ts`: podcast keys lines 309+; new versioned raw key yahin
- transcript route pe MiniPlayer already visible (top route `podcast`),
  `useMiniPlayerPadding` list bottom protect karega

## Steps

1. **Types — `mobile/types/index.ts`**
   - `PodcastTranscriptMime = 'text/vtt' | 'application/x-subrip' |
     'application/json' | 'text/html' | 'text/plain'`
   - `PodcastTranscriptRef {url,type,language,rel}`
   - `TranscriptSegment {id,startMs,endMs,speaker,text}`
   - `PodcastTranscript {episodeId,sourceUrl,mimeType,language,timed,segments}`
   - `TranscriptPositionEntry {sourceUrl,segmentIndex,updatedAt}` +
     version-1 envelope/map
   - `PodcastEpisode.transcripts: PodcastTranscriptRef[]`; all constructors
     compile-fix with `[]` when iTunes/progress source has no RSS refs

2. **RSS discovery + adapters — `core/podcast/rss.ts`, `episode.ts`**
   - pure `normalizeTranscriptMime(raw)` strips charset/lowercases;
     tolerate `application/srt` by normalizing to `application/x-subrip`
   - `transcriptNamespacePrefixes(xml)`: root `xmlns:<prefix>` values for
     official Podcast Namespace URI + documented GitHub URI; always tolerate
     common undeclared `podcast` prefix
   - `itemToRssEpisode(item,prefixes)` captures supported self-closing
     `<prefix:transcript>`: HTTPS-only `new URL`, required type/url, dedupe
     `(url,type,language)`, max 10, feed order preserve
   - RSS adapter passes refs; iTunes adapter sets `transcripts: []`
   - Extend existing RSS fixture/test with default + alternate namespace,
     duplicate/HTTP/unsupported guards and adapter preservation

3. **Pure transcript core — `core/podcast/transcript.ts`**
   - constants: `TRANSCRIPT_SEGMENT_CAP=5000`, position cap 50, JSON chunk
     max 240 chars, merge gap 1500ms
   - `chooseTranscriptRef` priority VTT → SRT → JSON → HTML → plain
   - `parseTimestampMs` (`hh:mm:ss.mmm`, `mm:ss.mmm`, comma/dot)
   - `parseWebVtt`: header/cue-id/settings tolerate, speaker `<v>`, multiline
   - `parseSrt`: optional numeric id, speaker-prefix split, malformed skip
   - `parseJsonTranscript`: strict object/segments guard, sec→ms, same-speaker
     word rows coalesce until punctuation/gap/speaker/240-char boundary
   - `parseHtmlTranscript`: remove script/style blocks; ordered
     cite/time/paragraph subset; decode entities; no HTML render
   - `parsePlainTranscript`: paragraphs then lines, untimed
   - dispatcher returns segment array; empty means malformed
   - helpers: `segmentAt`, `searchTranscript` (min2/cap50),
     `normalizeTranscriptPositions`, `putTranscriptPosition` (sourceUrl +
     cap50 oldest-drop), `positionForTranscript` source-match + clamp

4. **Storage — `services/storage.ts`**
   - `TRANSCRIPT_POSITIONS_KEY='@pb_transcript_positions'`
   - `getTranscriptPositionsRaw(): Promise<unknown>` +
     `saveTranscriptPositions(envelope: TranscriptPositionEnvelope)`;
     pure version/shape guard core-owned
   - no full transcript body persistence

5. **Fetch service — `services/podcastTranscriptService.ts`**
   - `PodcastTranscriptError` codes:
     `unavailable|network|too_large|malformed|unsupported`
   - `fetchPodcastTranscript(episode)`: preferred ref → 10s fetch;
     `Content-Length` and final text max 2 MiB; RSS MIME authority;
     pure dispatcher; 0 segments → malformed
   - one-entry in-memory `{episodeId,sourceUrl,transcript}` cache
   - `describePodcastTranscriptError` Hinglish strings including web CORS hint
   - stale requests store-owned; service remains stateless except one-entry cache

6. **Transcript store — `stores/transcriptStore.ts`**
   - state: episode/transcript/loading/error/query/matches/positionsLoaded
   - request token: episode A late response cannot replace episode B
   - `open(episode)` selects immediately + fetch; `retry`, `close`, `setQuery`
   - `jumpToSegment(index)`: untimed ignore; same current song → seek;
     otherwise `usePodcast.getState().playEpisode(episode)` then seek
   - success/failure toast + haptic existing convention
   - `saveReadingIndex(index)` 750ms trailing throttle; sourceUrl included;
     load/normalize once, cap50, persist. `close` flushes pending save.

7. **Episode entry — `components/EpisodeRow.tsx`, podcast screens**
   - optional `onTranscript?: () => void`; row root View, main episode
     Pressable flex + separate 44px transcript Pressable
   - preserve existing episode play haptic/accessibility/memo behavior
   - show detail passes transcript action only when refs available:
     `transcriptStore.open(episode)` + `router.push('/podcast/transcript')`
   - iTunes search/continue rows pass no action (their denormalized episodes
     have no RSS refs)

8. **Transcript screen — `app/podcast/transcript.tsx`**
   - default export `PodcastGate` wrapper; inner component mounts effects only
     when flag enabled (flag-off zero network)
   - header metadata, format/language badge, search field + hit count/clear
   - FlatList: normal segments or query match indices; timed active index from
     player position + `segmentAt`; current line highlight; speaker label
   - auto-follow latch (`onScrollBeginDrag` off, Follow chip on),
     `onScrollToIndexFailed`; initial current segment else source-matched saved
     reading index
   - tap timed segment → store jump; untimed row non-button
   - viewability callback saves first visible original segment index only when
     user/follow state makes it a reading position
   - loading/unavailable/network/too_large/malformed states + retry;
     MiniPlayer padding remains

9. **Pure tests — extend `test-podcast.mjs`, add `test-transcript.mjs`**
   - podcast fixture: refs default/alternate prefix, dedupe, HTTPS/MIME guard,
     RSS adapter refs, iTunes `[]`
   - transcript tests (target 12+ cases): ref priority; timestamp variants;
     VTT identifiers/settings/speaker/multiline; SRT comma/speaker/bad blocks;
     JSON sec/coalesce boundaries; HTML script-strip/time; plain paragraphs;
     5k cap; segmentAt before/exact/between/after; search case/min/cap;
     position version/source/cap50
   - root/mobile chains append `test:transcript` (13 total suites)

10. **Probe — `probe-transcript.mjs`**
    - deterministic local VTT/SRT/JSON fixture checks always
    - optional `--live <raw-vtt-url>` manual mode with manual AbortController
      + cleared timer (Windows Node assertion avoid), response cap

11. **Gates, docs, commit**
    - `cd mobile && npx tsc --noEmit` 0
    - `cd mobile && npm run lint` 0 warnings
    - root `npm test` green (13 suites)
    - script-char/junk scan + `git diff --check`
    - REQUIREMENTS FR-14, ROADMAP transcript/search/highlight/jump/save rows
      `[~]`, report `[ ]`, CHECKLIST PHASE 24 + actual tracker recount
    - commit:
      `feat(podcasts): Phase 7b — publisher transcripts v1 (search, sync, jump)`

## Risks / decisions locked

- **Coverage**: only RSS-authoritative episodes expose refs; iTunes-only rows
  cannot invent publisher transcript metadata.
- **Web CORS**: no proxy in ₹0/client-only scope; mobile native fetch primary,
  web gets honest CORS/network error.
- **Storage**: transcript bodies can be megabytes, so no AsyncStorage body
  cache; only source-bound index map.
- **JSON word rows**: display coalescing prevents thousands of one-word rows;
  original earliest start/latest end retained per chunk.
- **HTML safety**: text extraction only; never render HTML/WebView.
- **Rooms**: jump calls existing playerStore seek path, so any room broadcast
  policy stays centralized and unchanged.

# Phase 7b — Podcast Transcripts V1 (Design)

> Roadmap: `mobile/docs/PRODUCTION_ROADMAP_CHECKLIST.md` → Phase 7,
> "Transcripts" rows. Date: 2026-10-30. Approved scope: **publisher
> transcripts** from the Podcasting 2.0 RSS namespace (Approach A).
> Budget ₹0, guest-compatible, client-only; no backend or AI transcription.

## 1. Purpose

Podcast listener ko creator-provided transcript padhne, episode ke andar text
search karne, playback ke saath current segment follow karne, aur transcript
segment tap karke us timestamp par jump karne dena. Accessibility primary goal
hai; publisher text ko AI-generated text se replace nahi karna.

## 2. Goals / Non-goals

**Goals**
- RSS item se official `<podcast:transcript>` refs read (`url`, `type`,
  optional `language`, optional `rel`)
- Official formats: WebVTT, SRT (`application/x-subrip`), Podcast Namespace
  JSON, plain text, and constrained transcript HTML
- Common segment model; timed formats me current-segment highlight +
  tap-to-play/seek, untimed formats me searchable readable text
- Episode-row transcript affordance sirf available ref pe
- Local transcript search and reading-position restore per episode
- Existing `podcasts_enabled` gate reuse; koi extra login/flag nahi

**Non-goals (later)**
- Whisper/Gemini/Apple auto-transcription (audio upload, cost, privacy,
  latency, and creator-text quality risks)
- Transcript translation
- Word-by-word karaoke (JSON words display-segments me coalesce honge)
- Multi-language picker (v1 deterministic preferred ref select karta hai;
  selected language header me visible)
- Report transcript issue: RSS namespace me publisher-neutral report endpoint
  nahi; roadmap row honest `[ ]`
- Full transcript body offline cache: large files AsyncStorage budget consume
  karte; v1 sirf reading position persist karta hai

## 3. Source discovery — existing RSS path

`mobile/core/podcast/rss.ts` ka `RssEpisode` extend:

```ts
interface PodcastTranscriptRef {
  url: string;
  type: PodcastTranscriptMime;
  language: string | null;
  rel: string | null;
}
```

`parsePodcastFeed` root XML declarations se namespace prefixes collect karega
jinka URI official
`https://podcastindex.org/namespace/1.0` (ya spec ka documented GitHub URI)
hai. `itemToRssEpisode` un prefixes ke `*:transcript` self-closing children
capture karega; undeclared but common `podcast:transcript` bhi tolerate hoga.
Guard:
- absolute HTTPS URL only (Podcast Namespace requirement)
- supported MIME only; lowercase + `; charset=` suffix remove
- duplicates `(url,type,language)` se dedupe
- max 10 refs per episode

`PodcastEpisode` me `transcripts: PodcastTranscriptRef[]`. RSS adapter refs
preserve karta; iTunes-only rows and progress-ledger reconstruction `[]` dete.
Isliye iTunes fallback episode par transcript icon nahi dikhega unless RSS
authoritative load hua.

## 4. Pure transcript core — `mobile/core/podcast/transcript.ts`

### 4.1 Common model

```ts
interface TranscriptSegment {
  id: string;                 // deterministic index/timing key
  startMs: number | null;
  endMs: number | null;
  speaker: string | null;
  text: string;
}

interface PodcastTranscript {
  episodeId: string;
  sourceUrl: string;
  mimeType: PodcastTranscriptMime;
  language: string | null;
  timed: boolean;
  segments: TranscriptSegment[];
}
```

All parsers: empty/junk segments drop, whitespace collapse, sorted timed
segments, max 5,000 display segments, no `any`, malformed input never throw to
screen (result error object/null boundary).

### 4.2 Format selection

`chooseTranscriptRef(refs)` deterministic priority:
1. `text/vtt`
2. `application/x-subrip` (also tolerate `application/srt` alias)
3. `application/json`
4. `text/html`
5. `text/plain`

Same MIME ke multiple refs me RSS order preserve. Language picker later; chosen
ref ka language header me shown.

### 4.3 Parsers

- **WebVTT**: optional `WEBVTT` header, cue identifiers/settings tolerate,
  `hh:mm:ss.mmm` / `mm:ss.mmm`; `<v Speaker>` speaker capture, remaining tags
  strip, multiline cue join
- **SRT**: numeric cue id optional, comma/dot milliseconds, multiline body;
  leading `Speaker:` split when short label
- **JSON**: `{version, segments[]}`; `startTime`/`endTime` seconds → ms,
  `speaker`, `body`. Word-granularity rows same-speaker + short-gap ke saath
  sentence/display chunks me coalesce (max 240 chars)
- **HTML**: spec subset `<cite>`, `<time>`, `<p>`; HTML entities decode,
  scripts/styles drop. `<time>` parse ho to timed, warna untimed
- **Plain**: blank-line paragraph split, fallback nonempty line split; untimed

### 4.4 Pure helpers

- `segmentAt(segments, positionMs)` → original segment index; before-first `-1`
- `searchTranscript(segments, query, cap=50)` → text/speaker case-insensitive
  hit indices; query <2 chars → empty
- `putTranscriptPosition(map, episodeId, index, ts)` → cap 50 oldest-drop
- `normalizeTranscriptPositions(raw)` → version/shape guard

## 5. Fetch service — `mobile/services/podcastTranscriptService.ts`

`fetchPodcastTranscript(episode)`:
1. `chooseTranscriptRef(episode.transcripts)`; none → `unavailable`
2. HTTPS GET, 10s AbortController
3. `Content-Length` pre-check + actual text length cap **2 MiB**
4. RSS ref MIME is authority (official tag me required); response
   `Content-Type` mismatch sirf diagnostic warning, format switch nahi
5. selected pure parser → zero valid segments = `malformed`
6. return `PodcastTranscript`; in-memory last-episode result cache only

Errors: `unavailable | network | too_large | malformed | unsupported`.
No proxy/backend. Native Android/iOS direct fetch expected; web hosts without
CORS get an honest network/CORS state (Podcast Namespace itself recommends CORS).

## 6. State and persistence

New `mobile/stores/transcriptStore.ts` keeps transcript flow out of screens and
existing podcast search store:
- state: `episode`, `transcript`, `loading`, `error`, `query`, `matches`
- `open(episode)`, `retry()`, `close()`, `setQuery(query)`
- `jumpToSegment(index)`: current episode playing ho to `player.seek`; warna
  `podcastStore.playEpisode(episode)` then seek
- `saveReadingIndex(index)` throttled (750ms) to storage

Storage key `@pb_transcript_positions`, versioned envelope, cap 50. Value:
`{segmentIndex, updatedAt}`. Full transcript body persist nahi hota.

## 7. UI

### 7.1 Episode row / detail

`EpisodeRow` optional `onTranscript` prop. Layout main episode Pressable +
separate document icon Pressable rakhega (nested Pressable nahi). Show detail
passes action only when `episode.transcripts.length > 0`:
- haptic
- `transcriptStore.open(episode)`
- `router.push('/podcast/transcript')`

### 7.2 Transcript screen — `app/podcast/transcript.tsx`

- PodcastGate wrap; no selected episode → honest EmptyState
- header: episode title, chosen language/format, back
- search input; query active pe hit-only list + hit count, clear action
- timed transcript: player `position` → `segmentAt`, current row highlight,
  auto-follow; user drag pauses follow, chip resumes
- row tap: haptic + `jumpToSegment`; untimed row tap disabled
- first open: currently playing episode ho to current segment; otherwise saved
  reading index
- FlatList virtualized, 5,000-segment hard cap, `onScrollToIndexFailed`
- loading, unavailable, malformed/too-large, network/CORS + retry states
- MiniPlayer remains visible so transport controls continue; list uses
  `useMiniPlayerPadding`

User actions use existing toast/haptic conventions. Screen only renders and
wires callbacks; fetch/search/jump/persist logic store/service/core me.

## 8. Error and safety boundaries

- HTTPS-only transcript URL; no arbitrary script execution
- HTML parser text-only regex/token subset, never WebView/rendered HTML
- 2 MiB response cap + 5,000 segments prevents memory/render blowups
- stale async response token prevents episode A result replacing episode B
- zero transcript ref means icon hidden (not an error toast)
- playback jump uses existing local player pipeline; room sync behavior remains
  playerStore-owned

## 9. Testing

- Extend `test-podcast.mjs`: RSS transcript ref extraction/dedupe (default +
  alternate namespace prefix) + adapter preservation, iTunes fallback `[]`
- New `test-transcript.mjs` pure:
  - ref MIME normalization/priority/HTTPS guard
  - VTT cue ids/settings/speaker/multiline
  - SRT comma times/speaker/malformed blocks
  - JSON seconds + word-row coalescing
  - HTML timed/untimed + script stripping, plain paragraphs
  - `segmentAt` boundaries, search cap/case, position version/cap 50
- `probe-transcript.mjs`: local fixtures; optional live official raw VTT URL
- Root + mobile test chain (`test:transcript`)

## 10. Delivery

Gates: `cd mobile && npx tsc --noEmit` (0), `npm run lint` (0), root
`npm test` green (13 suites). Docs: REQUIREMENTS FR-14, roadmap transcript
rows `[~]` for transcript/search/highlight/jump/save-position; report `[ ]`;
CHECKLIST PHASE 24 with recalculated actual totals.

Commit:
`feat(podcasts): Phase 7b — publisher transcripts v1 (search, sync, jump)`.

## 11. Manual verification

- Enable existing `EXPO_PUBLIC_PODCASTS_ENABLED=true`
- Open RSS-backed show with VTT/SRT transcript; icon visible
- Search hit, timed follow, tap-to-jump, user-scroll follow latch
- Reopen episode → saved reading index
- Plain/HTML transcript: searchable, no false seek action
- No-ref episode: transcript icon hidden

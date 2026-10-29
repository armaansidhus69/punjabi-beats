# Phase 7a — Lyrics V1 (Design)

> Roadmap: `mobile/docs/PRODUCTION_ROADMAP_CHECKLIST.md` → "Phase 7 — Lyrics
> and transcripts → Lyrics" rows ke v1 subset. Date: 2026-10-29.
> Approved: **LRCLIB synced lyrics + player full-screen** (Approach A).
> Budget ₹0 — LRCLIB free/keyless public API; koi backend deploy nahi.

## 1. Purpose

Gaane ke lyrics player me full-screen view — synced lines current position
pe highlight, tap-line seek. Music discovery/UX gap cover; podcasts
transcripts baad (7b).

## 2. Goals / Non-goals

**Goals**
- `GET https://lrclib.net/api/get?artist_name=&track_name=&duration=` (durationSec)
  (free, keyless) → plain + synced lyrics; fallback `/api/search` first
  result jab exact miss
- Full-screen lyrics route (`/lyrics`): current line highlight (`position`
  poll ~200ms), tap line → seek, scroll-follow (user scroll pe pause
  follow, "resume follow" chip)
- Cache `@pb_lyrics` (songId → parsed lyrics + source meta, cap 50
  oldest-drop) — offline repeat plays me instant
- Error states honest: flag off gate / no lyrics found / network fail /
  plain-only (unsynced) notice
- `lyrics_enabled` flag (registry me already, default false) +
  `EXPO_PUBLIC_LYRICS_ENABLED` opt-in

**Non-goals (baad)**
- Translation (7-later — translation vendor select karna baaki)
- Share selected lines / report incorrect lyrics (7-later)
- Podcast transcripts + transcript search (7b — RSS transcript tags)
- Karaoke word-level timing (LRCLIB word-sync rare hai, line-level suffices)

## 3. Pure core — `mobile/core/lyrics/lyrics.ts`

- `LYRICS_CACHE_CAP = 50`
- `parseLrc(raw)` → `{lines: Array<{text, timeMs}> | null}` — `[mm:ss.xx]`
  tags, multiple timestamps per line, junk-line drop, sorted
- `lineAt(lines, positionMs)` → index (last line with timeMs <= position;
  < first → 0/-1 honest; pure, boundaries tested)
- `isSyncedLines(lines)` — synced vs plain guard
- `cachePut(cache, songId, entry)` / `cacheGet` — cap 50 oldest-drop,
  restore-shape guard (versioned `{version, lyrics}` envelope parity
  signals pattern)
- `plainToLines(plain)` — unsynced fallback (timeMs 0 sab — highlight
  approx by progress share)

## 4. Service — `mobile/services/lyricsApi.ts`

- `fetchLyrics(song)` — LRCLIB `/api/get` (artist/title/durationSec);
  miss → `/api/search?q=` pehli best result (durationSec nearest) →
  still miss → `LyricsError('not_found')`
- Parsed result `{synced: boolean, lines, plain}` — service me cache
  read/write (`@pb_lyrics`), `getLyrics()` public flow
- 10s timeout AbortController; network fail → `LyricsError('network')`
- Cache-first: `@pb_lyrics` me hit to network hi nahi

## 5. Screen — `app/lyrics.tsx`

- Player meta anchor: currentSong tap ya Lyrics card (player screen se
  route push) — `LyricsGate` flag guard (`lyrics_enabled`)
- Synced: lines list FlatList (cap ~200 render), current index highlight,
  auto-scroll (item layout track karke, user scroll inter-lock: `onScrollBeginDrag`
  follow=false, chip "Follow onResume"), tap item → `seek(timeMs)`
- Plain-only: progress-share approx highlight (position/duration ratio ×
  lines), notice "sync timing nahi mila"
- Error states: not_found empty-state (EmptyState component), network
  retry button, gate upsell (flag)
- Render-only: selectors store/logic me nahi — screen sirf render + input.

## 6. Storage

`@pb_lyrics` — versioned envelope `{version: 1, lyrics: {[songId]:
{synced, lines, plain, artist, title, fetchedAt}}}` cap 50 (cachePut
oldest-drop by fetchedAt). `services/storage.ts` + get/save raw keys.

## 7. Error handling

- `not_found` — honest empty-state, doosri language/clean title hint text
- `network` — toast + retry button
- Flag off — gate upsell panel (koi network call nahi)
- LRCLIB down (5xx) — network fail branch, cache-first reply me koi hit
  chalega (offline degrade graceful)

## 8. Testing

- `test-lyrics.mjs` pure (core only): parseLrc (multi-timestamp, junk
  drop, sorted), lineAt boundaries (before-first/0/between/after-last),
  cache cap/dedupe/version guards, plainToLines
- optional `probe-lyrics.mjs --live` (LRCLIB /api/get probe — key-less
  live endpoint; local parse probe)
- root + mobile test chains wire (`test:lyrics`)

## 9. Gates / delivery

`cd mobile && npx tsc --noEmit` (0) · `npm run lint` (0) · root `npm test`
green (12 suites). Docs: REQUIREMENTS FR-13 (13.1..13.4), ROADMAP Phase 7
rows `[~]` (translation/share/report honestly `[ ]`), CHECKLIST PHASE 23.
Commit `feat(lyrics): Phase 7a — synced lyrics v1 via LRCLIB (flag off)`.

## 10. Open items (7b/later)

- Podcast transcripts (RSS `<podcast:transcript>` tags) + search + save position
- Translation (vendor), share selected lines, report incorrect lyrics

# Phase 7a — Lyrics V1 Implementation Plan

Design: `docs/superpowers/specs/2026-10-29-lyrics-design.md`
Pattern: 13b/13c jaisa — pure core headless first, phir service/screen,
tests + gates. Koi backend deploy nahi — sab client-local (LRCLIB free
keyless API). Flag `lyrics_enabled` registry me already hai (default
false) — sirf env hook add karna hai.

Anchors (verified):
- `Song.duration` milliseconds (LRCLIB seconds = `Math.round(ms/1000)`)
- `app/player.tsx` line 52–67: `usePlayer` selectors position/duration/
  seek already wired; `PlayerHeader` internal component headerActions me
  Lyrics icon slot (like/share ke beech) — flag-gated optional prop
- storage: versioned-envelope pattern (`@pb_ai_chat` latest reference)
- Gate: `components/PodcastGate.tsx` pattern

## Steps

1. **Types** — `mobile/types/index.ts` append:
   - `LyricsLine = {text: string; timeMs: number}`
   - `LyricsData = {synced: boolean; lines: LyricsLine[]; plain: string;
     artist: string; title: string; fetchedAt: number}`
   - `LyricsErrorCode = 'not_found' | 'network' | 'bad_request'`
   - `LyricsCacheEnvelope = {version: 1; lyrics: Record<string,
     LyricsData>}`

2. **Client pure — `mobile/core/lyrics/lyrics.ts`** (headless target):
   - `LYRICS_CACHE_CAP = 50`
   - `parseLrc(raw)` — `[mm:ss.xx]`/`[mm:ss.zzz]`/`[hh?]` tags, multi-
     timestamp lines expand, junk/empty/keval-meta tags drop (toolong text
     tags drop — offset tag `[offset:]` bhi), sorted by timeMs
   - `lineAt(lines, positionMs)` — last line `timeMs <= position`;
     position pehle line se pehle → index -1 honest (caller clamp 0)
   - `plainToLines(plain, durationMs)` — nonempty lines, timeMs=0,
     highlight approx progress-share screen-side
   - `cacheFromEnvelope(raw)` / `cacheToEnvelope(cache)` — version guard
     (wrong version → empty), entry shape guard
   - `cachePut(cache, songId, data, now)` — cap 50 oldest-drop by
     `fetchedAt`, duplicate refresh bump
   - `cacheGet` — expired nahi (no TTL v1; cap hi eviction)

3. **Storage** — `mobile/services/storage.ts`:
   - `LYRICS_CACHE_KEY = '@pb_lyrics'`, `getLyricsCacheRaw(): unknown`,
     `saveLyricsCache(envelope: {version, lyrics})` (raw-safe try/catch
     parity baaki keys)

4. **Service — `mobile/services/lyricsApi.ts`**:
   - `LyricsError` class + `describeLyricsError` (Hinglish)
   - `fetchLyrics(song)` — cache-first (`@pb_lyrics` read → hit? return);
     else LRCLIB `/api/get?artist_name&track_name&duration` (10s abort);
     404/miss → `/api/search?q=artist title` first result (artist+
     duration sanity loose) → parsed `{synced, lines, plain}` → cache
     write (server-side cache state in-module ref) → return `LyricsData`
   - no lyrics (dono fields null) → `LyricsError('not_found')`; any fetch/parse
     network issue → `LyricsError('network')`
   - Track-name cleanup: `(Official Video)`/`(Lyrics)`/feat-strip mild
     only for query (title display unchanged)

5. **Gate — `mobile/components/LyricsGate.tsx`**: flag
   `lyrics_enabled`, PodcastGate pattern (guest ok, koi login nahi)

6. **Screen — `mobile/app/lyrics.tsx`** (`/lyrics` route):
   - `LyricsGate` wrap; selectors: `currentSong`, `position`, `duration`,
     `seek` (usePlayer)
   - `useEffect` fetch on song change → state: `idle|loading|ok|error`
   - Synced: FlatList lines, highlight = `lineAt(position)` (poll alag
     nahi — position store already poll hota), auto-scroll latch:
     `onScrollBeginDrag` follow=false, "Follow" chip follow=true +
     scrollToCurrent
   - Tap line → `seek(timeMs)` (haptics + toast nahi — visual feedback
     highlight hi)
   - Plain-only: index approx = floor(progress * lines.length), notice
     strip "synced timing nahi mili — approx highlight"
   - Errors: not_found EmptyState + retry, network retry, gate flag

7. **Player entry** — `app/player.tsx`:
   - PlayerHeader optional `onLyrics` prop → icon button
     `document-text-outline`; player screen me
     `isFeatureEnabled('lyrics_enabled')` check karke pass (flag off:
     koi icon nahi — Phase 0 row "disabled flags expose nahi karte")
   - onPress: `router.push('/lyrics')` + tapFeedback

8. **Tests — `test-lyrics.mjs`** (pure core only):
   - parseLrc: standard LRC, multi-timestamp, `[offset:1000]` ignore-able
     offset tag apply v1 me (tests), info-tags (`[by:...]`) drop, junk,
     unsorted input → sorted
   - lineAt: before-first (-1), exact hit, between (last <=), after-last
     (last index), empty lines
   - cachePut: cap 50 oldest-drop, bump refresh, cacheGet round-trip,
     envelope version guard
   - plainToLines: empty drop, duration share
   - Wire root + mobile chains (`test:lyrics`)

9. **Probe** — `probe-lyrics.mjs`: local-mode pure parse probe (junk LRC
   round-trip) + `--live https://lrclib.net` optional live API check
   (keyless query — known Punjabi track sample)

10. **Gates + docs + commit** — tsc 0 / lint 0 / root `npm test` green
    (12 suites); REQUIREMENTS FR-13 (13.1..13.4), ROADMAP Phase 7 lyrics
    rows `[~]` (translation/share/report honestly `[ ]`), CHECKLIST
    PHASE 23; commit `feat(lyrics): Phase 7a — synced lyrics v1 (LRCLIB,
    flag off)`.

## Notes / risks

- **LRCLIB response fields**: `syncedLyrics` | `plainLyrics` | artistName
  | trackName | duration (s). `/api/get` pe exact match, 404 possible →
  search fallback. `/api/search` returns array.
- **Duration ms vs s**: LRCLIB seconds expect — `Math.round(duration/1000)`.
- **position polling**: usePlayer position store-polled hai (player.tsx
  already isse ProgressBar update karta) — lyrics screen same selector,
  FlatList extra poll nahi.
- **Cyrillic/CJK** usernames junk-scan gate, spec wale pattern se (proven).
- **Koi backend/env change** — sirf client env `EXPO_PUBLIC_LYRICS_ENABLED`
  opt-in. Flag off = icon hidden + route gated.
- **LRC offset tag**: `[offset:+500]` milliseconds maan ke apply (LRCLIB
  docs timedelta ms sign ergonomics) — positive = lyrics earlier. V1 me
  apply + tests.

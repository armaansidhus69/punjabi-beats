# Phase 13b — AI Playlist V1 Implementation Plan

Design: `docs/superpowers/specs/2026-10-29-ai-playlist-design.md`
Pattern: same layering as Signals/Blend/Jam/Podcasts — pure logic first
(server pure helpers + client pure core headless-testable), then service,
store, screen, then tests + gates. Gemini free tier, key sirf Vercel env.
Client server base = existing `EXPO_PUBLIC_YOUTUBE_MATCH_URL`
(`punjabi-beats-api.vercel.app`) — 13a signals taste context feed hota hai.

## Steps

1. **Types** — `mobile/types/index.ts` append:
   - `AiTrackRef {title: string; artist: string; reason?: string}`
   - `AiPlanRow {track: AiTrackRef; song: Song | null}` (song = resolved)
   - `AiPromptHistoryEntry {prompt: string; refineText?: string; ts: string}`
   - `AiPlaylistErrorCode = 'no_key' | 'rate_limited' | 'upstream' |
     'not_enough' | 'network'`

2. **Server pure — `api/_aiPlaylistCore.js`** (root node ESM — headless target):
   - `AI_MAX_TRACKS = 15`, `AI_DAILY_LIMIT = 10`, `AI_HOURLY_LIMIT = 4`
   - `buildAiPrompt({prompt, taste, refineText?})` — DJ instruction +
     STRICT-JSON `[{"title","artist"}]` + normalizing rules (taste block top
     artists/songs/queries; user text sirf dedicated quoted slot me = prompt
     injection isolation)
   - `parseAiResponse(raw)` — JSON.parse, array validate, title/artist
     non-empty, dedupe (title+artist key), cap 15 → `{tracks}` (empty/garbage
     → null caller 502 kare)
   - `rateLimitBucket(state, deviceId, nowMs)` — 2-window (day + hour)
     per-device in-memory Map → `{allowed, remaining, retryAfterSec}` (pure —
     state caller owned, Vercel warm-instance honest best-effort)

3. **Server handler — `api/ai-playlist.js`** (Vercel function):
   - POST `{prompt, deviceId, taste?, refineText?}`; input guards (trim,
     prompt ≤ 240 chars, taste slices server-side)
   - `GEMINI_API_KEY` missing → 400 `{error: 'no_key'}` (fail-closed, deploy
     order rule)
   - rate limit → 429 `{error: 'rate_limited', retryAfterSec}`
   - Gemini `generateContent` POST, model default `gemini-2.5-flash`
     (`GEMINI_MODEL` override), `responseMimeType: application/json`, 20s
     AbortController → timeout/HTTP fail → 502 `{error: 'upstream'}`
   - ok → 200 `{tracks, remaining, disclosure: true}`

4. **Client pure — `mobile/core/ai/playlist.ts`**:
   - `AI_MIN_PLAYABLE = 3`
   - `sanitizeAiTracks(raw: unknown)` — client-side second guard (cap/trim/
     dedupe/typecheck)
   - `normalizeName(text)` — lowercase, strip `(feat...)`/`(remix)` brackets,
     `&` → `and`, collapse whitespace
   - `matchablePlan(tracks, playable: Song[])` — per-candidate fuzzy match:
     exact normalized → substring → artist-overlap scoring; unmatched track
     row `{track, song: null}` (screen drop karake preview clean rehta hai)
   - `countPlayable(rows)`, `refineMergePrompt(prompt, refineText)`
   - `planHistories` helpers NOT here — storage service me

5. **Service — `mobile/services/aiPlaylistService.ts`**:
   - `AiPlaylistError` class (code + retryAfterSec)
   - `generatePlaylist(prompt, {refineText?})` — deviceId (`identity.ts`
     `getOrCreateDeviceIdentity`), taste compact from 13a `getTasteStats()`
     (top 10 songIds, top 10 artists `artistStatsFromSignals`, top 5 queries),
     POST `${EXPO_PUBLIC_YOUTUBE_MATCH_URL}/api/ai-playlist` (missing base →
     `network` error), 25s abort → `{tracks, remaining}`
   - `resolveCandidates(tracks, searchSongs)` — per-track `searchSongs`
     (title + artist), `previewOnly` OFF filter, dedupe by songId,
     `matchablePlan`; playable < `AI_MIN_PLAYABLE` → `not_enough` error
     (got: n)
   - Prompt history storage: storage.ts + `@pb_ai_prompts` key get/save
     (cap 10 newest-first, dedupe — pure helpers core/ai/playlist.ts me)

6. **Store — `mobile/stores/aiPlaylistStore.ts`** (zustand):
   - State: `planRows`, `remaining`, `busy`, history list
   - Actions: `initialize()` (history restore), `generate(prompt)`,
     `refine(refineText)`, `removeRow(track)`, `playAll()` (playerStore
     playSong first + queue), `saveAsPlaylist(name?)` (playlistStore create +
     addSongToPlaylist reuse, name default `AI: {prompt}` trunc 40)
   - Toasts Hinglish per error code (utils/haptics.ts + toast pattern)

7. **Screen — `mobile/app/ai-playlist.tsx`** (render-only, logic store me):
   - Prompt input + Generate, history chips (tap → refill), disclosure strip
     (hamesha visible), plan rows list (title/artist + matched mark + remove),
     refine composer, Play All / Save buttons, remaining quota note
   - Flag gate: `ai_playlist_enabled` off → upsell panel (PodcastGate pattern)
     with env hint `EXPO_PUBLIC_AI_PLAYLIST_ENABLED`

8. **Library card #4 — `mobile/app/(tabs)/library.tsx`**:
   - AI Playlist card existing 3 cards ke pattern me (Blend/Jam/Podcasts);
   flag off pe card dim + tap upsell

9. **Tests — root `test-ai-playlist.mjs`** (pure only):
   - server core: prompt-builder user-text isolation, parseAiResponse
     garbage/dup/cap guards, rateLimitBucket day+hour windows, retryAfterSec
   - client core: sanitize, normalizeName, matchablePlan fuzzy tiers,
     refineMergePrompt, history cap/dedupe
   - Wire root `package.json` (`test:ai` + npm test chain append) aur mobile
     mirror

10. **Gates** — `cd mobile && npx tsc --noEmit` (0) · `npm run lint` (0) ·
    root `npm test` green (10 suites)

11. **Docs + commit** — REQUIREMENTS FR-11 (11.1..11.7), ROADMAP Phase 13
    "AI playlist and assistant" rows `[~]` (assistant rows honestly `[ ]`),
    CHECKLIST PHASE 21. Commit
    `feat(ai): Phase 13b — AI playlist v1 via Gemini (server key, flag off)`.

## Notes / risks

- **Deploy order (user-side)**: `GEMINI_API_KEY` (aur optional
  `GEMINI_MODEL`) Vercel env me PEHLE, phir `npx vercel` — warna har POST
  400 `no_key` (fail-closed, by design).
- **Rate limiter warm-instance only** — Vercel cold-start pe buckets reset;
  client `remaining` + hourly guard pe bhi bharosa (defense in depth).
- **Gemini free tier RPM** modest — 4/hour client-side cap usse niche rakhta
  hai; 429 pe `retryAfterSec` toast.
- **Resolve min 3 playable**: Gemini catalog requests JioSaavn/Audius pe
  often match karti hain, par niche ke case me honest partial results —
  preview me `song: null` rows drop, < 3 → `not_enough` toast.
- **Verome/Piped songs previewOnly**: resolve filter preview-only OFF rakhta
  hai (full stream nahi mile to candidate drop) — podcast/13a pattern.
- Junk-hazard: har write/edit file me CJK/Devanagari/Cyrillic scan test se
  pehle (proven workflow).

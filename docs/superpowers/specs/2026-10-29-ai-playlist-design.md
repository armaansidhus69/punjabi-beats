# Phase 13b — AI Playlist V1 (Design)

> Roadmap: `mobile/docs/PRODUCTION_ROADMAP_CHECKLIST.md` → "Phase 13 — AI and
> recommendations → AI playlist and assistant". Data foundation (13a signals)
> isko input deta hai. Date: 2026-10-29.
> Approved: **Gemini free tier** + **Core playlist V1** scope (assistant chat
> => 13c, alag phase).

## 1. Purpose

User text prompt ("club ke liye banger", "raat 2 baje ki vibe") + 13a taste
context se **AI-generated playlist** banana. Server Gemini ko bula kar track
*names* leta hai; app ke existing search chain se wahi tracks resolve hote
hain aur normal player pipeline chalti hai. Budget ₹0 (Gemini free tier), key
sirf server-side (NFR-4.1).

## 2. Goals / Non-goals

**Goals**
- Prompt → 8–15 track candidates → playable Songs (existing JioSaavn/Audius/
  iTunes chain) → preview list → Play All / save-as-playlist
- Refine (follow-up text) + regenerate + remove rows
- Prompt history (cap 10) local `@pb_ai_prompts`
- AI disclosure har result pe visible; rate limit (client + server)
- Guest mode bhi chale (koi auth nahi — rate limit deviceId-se)

**Non-goals (13c/baad)**
- Assistant conversation/chat commands
- AI report ("kyun ye gaana hai") beyond per-row reason string op-reason
- Prompt injection hardening beyond user-text isolation (v1 text short)
- Located-region vs catalog deep-sort; mere clean match heuristic

## 3. Server — `api/ai-playlist.js` (+ pure core `_aiPlaylistCore.js`)

`api/_aiPlaylistCore.js` (Node ESM, handler aur test dono import karte):

- `buildAiPrompt({prompt, taste, refineText?}) → body `:
  System-like instruction embedded in single prompt (Gemini inline):
  `You are a Punjabi music DJ. Return STRICT JSON array of {title, artist}`
  + taste block (topArtists 10, topSongTitles 10, recentQueries 5 —
  **client text sirf `user` role me quote hota hai**, prompt-injection ko
  instruction me na trupt kare) + refine merge.
- `parseAiResponse(json) → {tracks: [{title, artist, reason?}]}` — cap 15,
  title/artist non-empty strings, dedupe (title+artist key), garbage drop,
  ≤40% parse fail → error
- `rateLimitBucket(deviceId, nowMs): {allowed: boolean, retryAfterSec?}` —
  instance-memory Map, 10/day + 4/hour (Vercel warm re-use honest note: limiter
  best-effort hai; cool-down window prompt response me pass hota hai)

`api/ai-playlist.js` handler:

- `POST {prompt, deviceId, taste?, refineText?}`, model default
  `gemini-2.5-flash` (`GEMINI_MODEL` env override), fetch
  `https://generativelanguage.googleapis.com/v1beta/models/{model}:
  generateContent` + `responseMimeType: application/json`
- Missing `GEMINI_API_KEY` → 400 `{error: 'no_key'}` (client flag screen ko
  dikhta hai)
- Input guard: prompt/refineText ≤ 240 chars, taste ≤ 40 entries/song (server
  slice), `deviceId` length ≤ 64
- Response `{tracks, remaining, disclosure: true}`
- 429 → `{error: 'rate_limited', retryAfterSec}`
- Gemini timeout 20s AbortController; response.json fail → 502
  `{error: 'upstream'}`

## 4. Client

### 4.1 Pure core — `mobile/core/ai/playlist.ts`

- `sanitizeAiTracks(raw) → {title, artist}[]` — client-side second guard
  (cap 15, trim, dedupe, unicode-trim whitespace)
- `matchablePlan(tracks, playable) → PlanRow[]` — rows `{track, song | null}`;
  match pure fuzzy: normalize (lowercase, strip `(/\(f remixes)`, `&/and`),
  exact → substring → artist-overlap scoring; injectable search fn se
  headless-testable
- `refineMergePrompt(base, refineText) → string` — "… aur bhi: {refineText}"

### 4.2 Service — `mobile/services/aiPlaylistService.ts`

- `generatePlaylist(prompt, {refineText?})` — deviceId (`identity.ts`
  existing `getOrCreateDeviceIdentity`), taste snapshot
  (13a `getTasteStats` → top 10 ids / artists / 5 queries — service layer
  compacts; core me shapes nahi), POST 25s AbortController
- `resolveCandidates(tracks, searchSongs)` — per-candidate search chain,
  `previewOnly: false` filter, ≥3 playable → PlanRow rows; kutti → throw
  `{code: 'not_enough', got}` error
- Errors typed `AiPlaylistError(code: 'no_key' | 'rate_limited' | 'upstream'
  | 'not_enough' | 'network')` — screen toasts friendly Hinglish (existing
  pattern)

### 4.3 State + screen — `stores/aiPlaylistStore.ts` + `app/ai-playlist.tsx`

- Zustand store: prompt history (`@pb_ai_prompts`, cap 10, dedupe), plan
  rows state, generate/refine/remove actions, saving flow
  (playlistStore ke create+addSongToPlaylist reuse — naya ledger nahi)
- Screen Library card #4 (Blend/Jam/Podcasts pattern; flag upsell when off):
  prompt input autosubmit on Enter/Generate + history chips tap-able,
  **disclosure strip** (har result list ke upar): "AI ne gaane sujhaye hain —
  match hamesha sahi nahi hota".
- Rows: title/artist + reason? (subtitle, sirf tab LLM ne diya ho; "AI
  suggested" caveat) + remove btn
- Refine composer: text → regenerate (same context + refine) — history me
  refineText bhi tag store
- Play All → `playerStore.playSong(first, rest)`; Save → playlist modal
  (CreatePlaylistModal reuse, name `AI: {prompt}` trunc)

### 4.4 Flag

- `ai_playlist_enabled` (registry me already, default false) — env opt-in
  `EXPO_PUBLIC_AI_PLAYLIST_ENABLED` (podcasts pattern)
- Deploy note: **GEMINI_API_KEY Vercel env me pehle set karo, phir deploy** —
  warna screen 400 no_key; flag off defaults guard

## 5. Prompt history

`@pb_ai_prompts` array: `{prompt, refineText? , ts}` — cap 10, newest-first,
dedupe (same prompt+refine). Sirf user prompt yaad hota hai, output track
list store NAHI (regenerate hamesha fresh hota hai).

## 6. Error handling

- `no_key` / flag off — screen upsell panel (PodcastGate pattern)
- Gemini upstream fail → "AI provider se connect nahi hua" toast
- 0–2 playable → error row "match kam mile — dobara try karo"
- Rate limit — toast `retryAfterSec` friendly countdown ke saath
- JSON parse garbage (Gemini guard) — server 502 + client generic upstream

## 7. Testing

- `test-ai-playlist.mjs` (pure): `_aiPlaylistCore` prompt-builder (user text
  sirf quoted slot me — injection isolation assert), `parseAiResponse` guards
  (garbage / dup / cap), `rateLimitBucket` boundaries; mobile core: sanitize,
  matchablePlan fuzzy (exact → substring → artist overlap), refine merge,
  history cap.
- `probe-ai-playlist.mjs --live <deploy>` — POST probe prompt (network) +
  local no-key branch check
- Root/npm test chain + mobile mirror (pattern jo pehle hua)

## 8. Gates / delivery

`cd mobile && npx tsc --noEmit` (0) · `npm run lint` (0) · root `npm test`
green; Vercel deploy = `npx vercel` (user-side; GEMINI_API_KEY set first).
REQUIREMENTS FR-11 (11.1..11.7) + ROADMAP rows `[~]` + CHECKLIST PHASE 21.
Commit `feat(ai): Phase 13b — AI playlist v1 via Gemini (server key, flag off)`.

## 9. Open items (13c)

- Assistant chat + commands (play/pause/search intent)
- Per-row "kyun ye pick" reasoning
- Supabase signal sync → server-side richer context

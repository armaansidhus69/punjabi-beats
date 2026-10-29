# Phase 13c — AI Assistant V1 Implementation Plan

Design: `docs/superpowers/specs/2026-10-29-ai-assistant-design.md`
Pattern: same as 13b — server pure helpers + client pure core headless
first, phir service/store/screen, tests + gates. Same `GEMINI_API_KEY`
(13b ke saath share — naya env nahi). Rate limiter 13b core import reuse
(alag counter values).

## Steps

1. **Types** — `mobile/types/index.ts` append:
   - `AssistantAction = 'search' | 'play' | 'pause' | 'next' | 'prev' |
     'queue_add' | 'create_playlist' | 'chat'`
   - `AssistantArgs = {query?: string; name?: string; count?: number}`
   - `AssistantReply = {action: AssistantAction; args: AssistantArgs;
     reply: string}`
   - `AssistantMessage = {role: 'user'|'assistant'; text: string; ts:
     string; results?: Song[]; failed?: boolean}`

2. **Server pure — `api/_aiAssistantCore.js`** (headless target):
   - `ASSISTANT_DAILY_LIMIT = 20`, `ASSISTANT_HOURLY_LIMIT = 5`,
     `ASSISTANT_MAX_TURNS = 6`, `ASSISTANT_MESSAGE_MAX_CHARS = 240`
   - `ASSISTANT_ACTIONS` set + per-action arg schema shape
   - `normalizeAssistantRequest(body)` — message/deviceId/turns guard
     (turns: max 6, `{role, text}` shape, role whitelist)
   - `buildAssistantPrompt({message, turns, taste?})` — STRICT JSON protocol
     text (action enum + args schema + reply lehza), turns quoted block,
     taste artists sirf one-line — user text sirf quoted slots (injection
     isolation, 13b builder pattern)
   - `parseAssistantResponse(raw)` — action whitelist, args per-action
     type-check (query string ≤ 120, count 1..10, others no-args), reply
     trim/≤ 200 (empty → default reply per action), garbage → null
   - re-export `rateLimitBucket` + limits from `./_aiPlaylistCore.js`

3. **Server handler — `api/ai-assistant.js`**:
   - POST; missing key → 400 `no_key`; input → 400 `bad_request`
   - 429 + Retry-After (2-window limiter, apne `new Map()` state me)
   - Gemini call (same buildGeminiRequest reuse? nahi — 13b core me hai,
     yahin duplicate chhota helper `buildAssistantGeminiRequest`) — 20s
     abort, 502 upstream parse garbage pe

4. **Client pure — `mobile/core/ai/assistant.ts`**:
   - `validateAssistantReply(raw: unknown)` — second guard (13b sanitize
     pattern)
   - `matchLocalQuickCommand(text)` — normalized tokens: pause/roko →
     `pause`, next/agla → `next`, previous/pichla → `prev`, shuffle →
     shuffle toggle flag (transport set me shuffle bhi chalta hai — args
     me) → `{action, args} | null` (server skip)
   - `makeTurnWindow(history, limit = 6)` — `{role, text}` slice
   - `truncateReply`, `describeAction(action)` labels

5. **Service — `mobile/services/aiAssistantService.ts`**:
   - `AiAssistantError` (family codes 13b jaisa) + `describeAiAssistantError`
   - `sendMessage(message, history)` — quick command check first; else
     POST `${EXPO_PUBLIC_YOUTUBE_MATCH_URL}/api/ai-assistant` (25s) with
     turns window + taste top-5 artists (13a `artistStatsFromSignals`,
     sirf names) → `validateAssistantReply` → return
   - `executeAssistantAction(reply)` — searchSongs resolve (previewOnly
     drop), playback mapper: search → results; play → playSong; queue_add →
     addToQueue; create_playlist → createPlaylist + count add; pause/next/
     prev → playerStore transport; empty playable → `not_enough`

6. **Store — `mobile/stores/assistantStore.ts`**:
   - messages `@pb_ai_chat` cap 20 (`services/storage.ts` + keys get/save),
     busy, remaining
   - `initialize` restore (results bhi restore), `send`: optimistic user
     bubble → busy → service → assistant bubble (results optional) →
     persist; failure pe `failed: true` bubble + retry last message
     (`retryLast`)
   - `clearChat`; toasts/haptics 13b pattern

7. **Screen + gate — `app/ai-assistant.tsx` + `components/AiAssistantGate.tsx`**:
   - Gate flag `ai_assistant_enabled`; registry add (featureFlags.ts +
     defaults map + `EXPO_PUBLIC_AI_ASSISTANT_ENABLED` env hook — check
     featureDisabledByEnv pattern 13b/podcasts)
   - Screen: header (back + title + disclosure strip + quota pill),
     bubble list (user right / assistant left, failed yellow), action
     result cards (tap → play), input bar + send button, clearChat icon
     (Alert confirm)
   - Library card #5 `app/(tabs)/library.tsx` (sparkles-chat icon)

8. **Tests — root `test-ai-assistant.mjs`** (pure):
   - server core: request guards, prompt turns isolation (message tokens
     quoted slot me), parse per-action (unknown action drop, query trim/
     length, count clamp, reply default), rate limit apne windows
   - client core: quick command matches (pause/roko/agla/previous/shuffle +
     Hindi/English variants), non-command null (server path), validator
     second guard, turn window 6, reply truncate
   - Wire root `test:assistant` + npm test chain append; mobile mirror

9. **Gates** — `cd mobile && npx tsc --noEmit` (0) · `npm run lint` (0) ·
   root `npm test` green (11 suites)

10. **Docs + commit** — REQUIREMENTS FR-12 (12.1..12.6), ROADMAP assistant
    rows `[~]` (voice/agent-loop `[ ]` honest), CHECKLIST PHASE 22. Commit
    `feat(ai): Phase 13c — assistant v1 (intent protocol, commands, chat)`.

## Notes / risks

- **13b rate limiter reuse**: import from `_aiPlaylistCore.js` — assistant
  apna `rateState` Map rakhta hai handler me (state share nahi; sirf
  bucket-function reuse, alag daily/hourly limits).
- **Local quick commands BEFORE server** — offline pause/next instantly
  chalta hai; rate limit khaata nahi. Match strict hai ("pause karo"
  suffixes handled, wordy chat server ko jati).
- **playerStore transport flags**: next/prev via playSong path — signals
  reader auto-manual flag already set (`manualAdvancePending`), assistant
  calls same actions (no new flag).
- **PlaybackError extra successive calls**: addToQueue duplicate/dry
  (existing 13b jaisa) — service me `previewOnly` drop, queue add fail
  Toast honest.
- **Junk-hazard**: har write/edit ke baad script-char scan (proven).
- **Deploy order user-side**: koi naya env nahi (GEMINI pehle se) — sirf
  `npx vercel` + `EXPO_PUBLIC_AI_ASSISTANT_ENABLED=true`.

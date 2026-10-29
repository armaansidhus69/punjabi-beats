# Phase 13c — AI Assistant V1 (Design)

> Roadmap: `mobile/docs/PRODUCTION_ROADMAP_CHECKLIST.md` → "Phase 13 — AI and
> recommendations → Assistant conversation and commands" rows. 13b AI
> Playlist V1 shipped pehle; ye usi Gemini infra ka second consumer. Date:
> 2026-10-29. Approved: **Assistant V1** scope (chat + commands).
> Provider pehle se locked: **Gemini free tier**, key sirf Vercel env server
> side (NFR-4.1).

## 1. Purpose

User chat karta hai ("club banger chalao", "pause karo", "diljit dhoondo",
"is vibe ki playlist banao") — server Gemini ko intent protocol bana kar
deta hai (`{action, args, reply}`), client usi local player/catalog APIs se
execute karta hai. Ek chat screen + Library entry. Budget ₹0, guest ok.

## 2. Goals / Non-goals

**Goals**
- Chat actions: `search` (result cards 3), `play` (resolve + playSong),
  `pause`/`next`/`prev` (player transport), `queue_add`, `create_playlist`
  (search → resolve → playlistStore), fallback `chat` (sirf reply text)
- Local quick commands: "pause"/"next"/"previous"/"shuffle" OFFLINE handle
  (server roundtrip skip — ke response instant, rate limit khaata nahi)
- Conversation context: last 6 turns server ko hi bheje jaate hain
  (`@pb_ai_chat` cap 20 local)
- Rate limit: 20/day + 5/hour per device (2-window, 13b core reuse)
- AI disclosure chat header me + action cards pe "AI suggested" note
- "No private user data in model logs" — server context me sirf coarse
  taste (top artist names, counts) + user ka apna chat text; signals
  ledger/song ids/timestamps kabhi nahi

**Non-goals (baad me)**
- Voice input (TTS/STT)
- Streaming token replies (SSE — single JSON hi v1 me paryapt)
- Server-authoritative playback control (Approach C reject — playback local hai)
- Deep multi-turn planning (agent loops) — single intent per message

## 3. Server — `api/ai-assistant.js` (+ pure `_aiAssistantCore.js`)

`api/_aiAssistantCore.js` pure (13b `_aiPlaylistCore.js` pattern):

- `ASSISTANT_DAILY_LIMIT = 20`, `ASSISTANT_HOURLY_LIMIT = 5`,
  `ASSISTANT_MAX_TURNS = 6`, `ASSISTANT_MESSAGE_MAX_CHARS = 240`
- `normalizeAssistantRequest(body)` — message + deviceId + turns[] guard
  (turns max 6, har turn text ≤ 240, role whitelist user/assistant)
- `buildAssistantPrompt({message, turns, taste?})` — protocol text: STRICT
  JSON `{"action": "...", "args": {...}, "reply": "..."}` + action enum +
  args schema per action (`search`/`play`/`queue_add`: {query};
  `create_playlist`: {name, query, count<=10}; transport: no args) +
  conversation turns quoted block + taste one-line (artists sirf)
- `parseAssistantResponse(raw)` — action whitelist, args type-check per
  action, reply string trim (empty reply → generated default), cap/polish
  (query max 120, count 1..10)
- `rateLimitBucket` — 13b core se import reuse (`_aiPlaylistCore.js`);
  alag counter kyunki action cheaper hai, per-device same bucket shape

`api/ai-assistant.js` handler:

- POST `{message, deviceId, turns?, taste?}`; missing `GEMINI_API_KEY` →
  400 `no_key` (fail-closed); input guard fail → 400 `bad_request`
- 429 `{error: 'rate_limited', retryAfterSec}` + Retry-After header
- Gemini `generateContent`, model `GEMINI_MODEL` default `gemini-2.5-flash`,
  `responseMimeType: application/json`, 20s AbortController → 502 upstream
- ok → 200 `{action, args, reply, remaining, disclosure: true}`

## 4. Client

### 4.1 Pure core — `mobile/core/ai/assistant.ts`

- `AssistantAction` type union + `validateAssistantReply(raw) →
  {action, args, reply} | null` — client-side second guard
- `LOCAL_QUICK_COMMANDS`: normalize karke exact-ish token match (pause/roko/
  next/agla/previous/pichla/shuffle — chhota token list) →
  `{action, noServer: true}` — headless-testable
- `makeTurnWindow(history, message)` — last 6 turns `{role, text}`
- `describeAction(action)` — toast/card label Hinglish

### 4.2 Service — `mobile/services/aiAssistantService.ts`

- `AiAssistantError` (same codes family: `no_key|rate_limited|upstream|
  not_enough|network|bad_request`) — 13b service pattern
- `sendMessage(message)` → local quick command check → execute directly;
  else POST server (25s timeout) → validate reply → `executeAction`
- `executeAction({action, args})` — mapper:
  - `search`/`play`/`queue_add`/`create_playlist`: `searchSongs(query, 5)`
    → previewOnly drop → playable empty → `not_enough` (honest "naya
    shabad try karo"); `play` = playSong(first, [first]),
    `queue_add` = addToQueue(first), `create_playlist` = createPlaylist +
    top `count` add (playlistStore reuse)
  - `pause`/`next`/`prev`: playerStore transport (next/prev transport
    signal manual-flag already playerStore me — local quick commands bhi
    isi path se jate)
- Taste snapshot privacy-safe: sirf top 5 artist names (13a
  `artistStatsFromSignals` se) — song ids/queries JAANE nahi

### 4.3 Store + screen — `stores/assistantStore.ts` + `app/ai-assistant.tsx`

- State: `messages: {role: 'user'|'assistant', text, action?, results?,
  ts}` (`@pb_ai_chat` cap 20, restore on init), `busy`, `remaining`
- Actions: `initialize` (history restore), `send` (message → service →
  append assistant bubble + optional result cards), `clearChat`
- Screen: chat bubbles list (FlatList inline small — cap 20 keeps it
  cheap), input bar bottom, action result cards (3 rows tap→play),
  disclosure strip header, remaining quota pill, entries: Library card #5
  + AI playlist screen header link (crosslink)
- `components/AiAssistantGate.tsx` — flag guard (`ai_assistant_enabled`
  PodcastGate pattern)

### 4.4 Flag

- `ai_assistant_enabled` registry add (default false) + env
  `EXPO_PUBLIC_AI_ASSISTANT_ENABLED` (13b pattern)
- Same deploy order rule: nothing new (same `GEMINI_API_KEY` reuse)

## 5. Conversation history

`@pb_ai_chat` array `{role, text, ts, action?, results?}` — cap 20
oldest-drop, restore me action/results bhi aate (offline re-view ok) par
server ko sirf last 6 turns ke role+text jaate.

## 6. Error handling

- `no_key` — gate screen upsell panel (flag off to gate hi hoga)
- `rate_limited` — toast `retryAfterSec` + input disabled till then
- `not_enough` — assistant reply honest: "is shabad pe kuch nahi mila"
- `upstream`/network — toast + user message bina history finalize kiye
  rukta hai; failing bubble ko 'delivery failed' mark + retry button
- Invalid action JSON (server) — 502 + client generic upstream message

## 7. Testing

- `test-ai-assistant.mjs` pure: server core (request guard, prompt
  isolation turns, parser per-action validation/junk drop), rate limit
  separate-window sanity, client core (quick command regex exact matches,
  turn window trim, validator second guard)
- `probe-ai-assistant.mjs` — local handler self-test (405/no_key/bad
  request/429 flow) + `--live` mode
- Root + mobile chain wiring (`test:ai-assistant`)

## 8. Gates / delivery

`cd mobile && npx tsc --noEmit` (0) · `npm run lint` (0) · root
`npm test` green (11 suites). Docs: REQUIREMENTS FR-12 (12.1..12.6),
ROADMAP assistant rows `[~]` (voice/dialog-loop honestly `[ ]`), CHECKLIST
PHASE 22. Commit
`feat(ai): Phase 13c — AI assistant v1 (intent protocol, commands, chat)`.

## 9. Open items (baad)

- Voice input/TTS
- Streaming replies (SSE)
- Multi-turn agent loops (follow-up planning)
- Server memory of preferences (Supabase sync — private, opt-in)

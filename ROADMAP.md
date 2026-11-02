# Punjabi Beats — Implementation Roadmap (17-phase plan → is repo ka exact map)

> **Kya ye document hai:** bahar se aaya 17-phase architecture plan (Auth →
> Catalogue → Playback → … → Widgets) is repo ke ACTUAL files/migrations/APIs
> pe map kiya gaya. Plan ka premise tha "sirf APK hai, source nahi" — is repo
> me source hai, aur kaafi phases pehle se built hain. Isliye ye roadmap
> "kya banana hai" nahi, "**kya already hai, kya missing hai, agla order kya
> hai**" batata hai.
>
> **Status legend:** ✅ shipped · 🟡 partial (built, gaps hain) · ⬜ not started
>
> Updated: 2026-11-02

---

## 0) Ek important architectural divergence (plan vs is app)

Plan Phase 3 ek **static local catalogue DB** (`tracks` table with `audio_url`)
maangta hai. Is app ka catalogue **federated live-source** hai: JioSaavn →
Audius → YT Music (Piped/Verome) → iTunes → Spotify (metadata) — har search
live APIs se aata hai, full-only policy guaranteed karta hai, aur
`offlineCache` + `core/database/localStore` caching karte hain. Ye jaan-bujh ke
rakha gaya design hai (licenced catalogue + hosting is app ke scale ke liye
nahi hai). Isliye Phase 3 ko "local tracks table" ke roop me build NAHI karenge
— "catalogue caching + richer artist/album metadata" ke roop me karenge. Baaki
sab phases plan ke hisaab se hi hain.

---

## 1) Status snapshot (poora plan ek nazar me)

| # | Phase | Status | sabse bada gap |
|---|-------|--------|----------------|
| 0 | Foundation (flags/analytics/errors/identity) | 🟡 | remote crash reporter, push provider |
| 1 | Auth & accounts | 🟡 | email OTP verify (baaki: logout-all + deletion ✅ ho gaya) |
| 2 | Family/kids/safety | ⬜ | sab kuch (profiles/privacy ke baad hi) |
| 3 | Catalogue model | 🟡 | federated design rakha hai; artist/album metadata enrich |
| 4 | Search/home/discovery | 🟡 | voice search, autocomplete, users search |
| 5 | Playback upgrade | 🟡 | queue screen + sleep timer + Radio ✅ (baaki: crossfade/EQ UI, cross-device sync) |
| 6 | Library + downloads | 🟡 | downloads v1 ✅ (manager + screen + offline play; baaki: Wi-Fi-only setting, auto-download) |
| 7 | Lyrics/transcripts | 🟡 | translation, share-lines, report-lyrics |
| 8 | Social sharing | ✅ | canonical web links + story integrations (later) |
| 9 | Chat/social | 🟡 | reactions + block/report ✅ (baaki: 1:1/group DMs, read-state) |
| 10 | Blend | ✅ | periodic recompute already scheduled (pg_cron) |
| 11 | Jam/listening rooms | 🟡 | roles (co-host/mod), listening-party scale, host promotion |
| 12 | Podcasts/audiobooks/video | 🟡 | audiobooks ⬜, music videos ⬜, podcast comments/polls |
| 13 | AI/recommendations | 🟡 | Made-for-you recos ✅ v1 (baaki: prompt history/refine) |
| 14 | Premium/payments | ❌ out of scope | **app free-forever — koi payments/billing nahi** (user decision) |
| 15 | Events/concerts | ⬜ | data-only (`constants/concerts.ts`); external ticket links first |
| 16 | Notifications | ⬜ | push provider + inbox (stub module hai) |
| 17 | Widgets/device integrations | ⬜ | lock-screen controls ✅ (track-player se); baaki later |

---

## 2) Phase-by-phase map

### Phase 0 — Foundation 🟡

**Built (`mobile/core/`):**
- `featureflags/featureFlags.ts` — 13 flags ka typed registry, sab default OFF,
  env mapping poora (`EXPO_PUBLIC_*_ENABLED`), beta override harness.
  Gates (`components/*Gate.tsx`) isi se consume karte hain.
- `auth/identity.ts` — guest identity + **device identity** (persistent UUID),
  `auth/sessionManager.ts` (guest + Supabase sessions), `auth/authService.ts`,
  `auth/supabaseClient.ts`, `auth/passphrase.ts`.
- `database/localStore.ts` + `database/migrations.ts` — versioned local schema.
- `network/apiClient.ts` — shared fetch wrapper (timeouts, error normalize).
- `analytics/analytics.ts` — sink = signals ledger (`services/signalsService`),
  `core/signals/` (skip schema/stats).
- `errors/errorReporting.ts` — reporter hook; `ErrorBoundary` ab isme report
  karta hai; dev me console reporter (bootstrap), remote SDK baad me.
- `navigation/deepLinkRouter.ts`, `notifications/notificationManager.ts`,
  `permissions/permissionManager.ts` — stubs, documented extension points.
- `bootstrap.ts` — `initializeCore()` best-effort, app start pe chalta hai.

**Missing / next:** remote crash reporter (Sentry/Crashlytics — Phase 1 auth ke
baad), push provider (Phase 16), remote config for flags (abhi env-only).

### Phase 1 — Auth & accounts 🟡

**Built:** `app/auth/` (login, register, forgot-password, profile),
`components/GoogleAuthButton.tsx`, `stores/authStore.ts`, Supabase Auth
backend, `supabase/migrations/001_profiles_devices.sql` (profiles, devices —
plan ke `users/auth_identities/user_sessions/devices` model ke barabar),
guest→account upgrade playlists/history ko preserve karta hai.

**Built (completion):** `signOutEverywhere()` (global scope — sab devices ke
refresh tokens revoke), `deleteAccount()` (migration 004 RPC se profile
anonymize + global signout) — dono profile screen pe wired.

**Missing / next tasks:** email OTP verify screen flow, devices-list UI,
multi-device push token sync.
**API note:** plan ke `/v1/auth/*` endpoints Supabase Auth se aate hain —
custom backend endpoints ki zarurat nahi.

### Phase 2 — Family/kids/safety ⬜

Sab kuch baaki. **Order:** Phase 1 complete hone ke baad hi. Pehla slice:
`profiles.privacy` columns + block/report tables + report queue (Phase 9 ke
moderation ke saath ek saath).

### Phase 3 — Catalogue 🟡 (federated design — section 0 dekho)

**Built:** `services/catalogueService.ts`, `app/artist/` + `app/album/` pages,
moods (`constants/moods.ts`, `app/mood/`), concerts data
(`constants/concerts.ts`), Spotify/Apple metadata sources.

**Next tasks:** artist biography + related-releases sections, album
save-to-library, "album radio" (Autoplay queue), merch/concerts Phase 15 ke
saath.

### Phase 4 — Search/home/discovery 🟡

**Built:** multi-source search + source filter chips + Artists/Albums/Playlists
filters, recent searches, Home = hero + trending + new songs (JioSaavn →
Spotify → YTM → Audius) + moods, `app/search.tsx`.

**Missing / next:** voice search (expo-speech), autocomplete/suggestions,
"search users" (Phase 9 profiles ke baad), personalized home sections
(Phase 13 signals se).

### Phase 5 — Playback upgrade 🟡

**Built:** full-only queue preference (30s clip kabhi full ki jagah nahi),
on-the-fly stream upgrade (strict title match), shuffle/repeat/volume,
state persistence (`@pb_player_state` — restart pe track/position restore),
auto-skip unplayable, lock-screen controls, background audio.

**Built (completion):** dedicated **Queue screen** (`app/queue.tsx` — reorder/
remove/clear/play-next/save-as-playlist, pure ops `core/queue/ops.ts`),
**Sleep timer** (`core/playback/sleepTimer.ts` + `stores/sleepTimerStore.ts`
— fixed minutes + end-of-track, room me interfere nahi karta), **Song Radio**
(`core/catalogue/radio.ts` + `services/radioService.ts` — seed artist se
queue, word-subset matching), player me queue link + utility row.

**Missing / next:** crossfade + gapless, EQ UI (`constants/equalizer.ts` ready
hai), playback speed, cross-device `playback_sessions` sync (Phase 1 ke baad).

### Phase 6 — Library + downloads 🟡

**Built:** liked songs, playlists (CRUD + add sheet + duplicate check),
recently played, artist/album pages, offlineCache (artwork + resolved streams).

**Built (downloads v1):** `core/downloads/stateMachine.ts` (pure reducer —
queued/downloading/downloaded/failed/retry), `services/downloadsService.ts`
(zustand + expo-file-system `pb-downloads/` dir, persisted `@pb_downloads`),
**downloads-first resolve** playerStore me (offline playback + data bachat),
`app/downloads.tsx` screen (play/delete/retry/clear + storage usage), library
entry — sab `downloads_enabled` flag ke peeche.

**Missing / next:** Wi-Fi-only setting, auto-download podcasts, resumable
downloads with granular progress (v2), pause/resume.

### Phase 7 — Lyrics & transcripts 🟡

**Built:** synced lyrics (LRCLIB, `core/lyrics/lyrics.ts` + `app/lyrics.tsx`),
podcast transcripts (`core/podcast/transcript.ts`), lyrics flag gate.

**Missing / next:** translation, share-selected-lines (Phase 8 card
generator ke saath), report-incorrect-lyrics endpoint.

### Phase 8 — Social sharing ✅

**Built:** signed share links (`api/share.js` + `api/_shareCore.js` + supabase
functions), share screen + composer sheet + **QR modal**, analytics open/click
hooks. Plan ka share flow end-to-end hai.

**Later:** canonical `yourapp.com/track/{id}` style links (abhi token-based —
token links zyada secure hain, canonical URLs SEO ke liye tab jab web app
banega), Instagram/Facebook Stories targets, server-side card generation.

### Phase 9 — Chat & social 🟡

**Built:** room chat + listening-party chat (`components/ChatModal.tsx`,
`utils/syncPayload.ts` chat events, rate-limit guards), message types
(text/track/room-invite).

**Built (slices):** **message reactions** (5 emojis, toggle + idempotent —
`core/chat/reactions.ts`, roomSync `chat-reaction` event, ChatModal
long-press action sheet), **block + report** (local blocklist filter +
report queue, optional Supabase push — `core/moderation/moderation.ts` +
`services/moderationService.ts` + migration `004_moderation_account.sql`
with RLS), cross-platform (RN Alert Android 3-button limit ka dhyan rakha).

**Missing / next:** 1:1 aur group DMs (`chats/chat_members/messages` tables),
read/typing state (Realtime presence already rooms me proven hai),
moderation dashboard (reports server pe aggregate karke).

### Phase 10 — Blend ✅

**Built (plan se aage):** deterministic taste-match scoring
(`core/blend/scoring.ts` — tested), snapshots + exclusions
(`supabase/migrations/002_blend.sql`), server-side recompute via
`supabase/functions/blend-compute` (pg_cron scheduled), member roles,
invite flow, `BlendGate` + screens. Plan ke "blend updates periodically" ka
implementation already cron-driven hai.

### Phase 11 — Jam & listening rooms 🟡

**Built:** 6-digit code rooms, host/participant playback sync (server-authority
time model: `core/room/timeModel.ts`, `versioning.ts`, drift correction),
queue voting (`voting.ts`), presence + member list, jam pads
(`proceduralSynth.ts`), Supabase broadcast transport + optional Apinator
transport, empty-room expiry. **Plan ke room model ke saare concepts
(`rooms/room_members/room_playback_state`) `supabase/migrations/003_rooms.sql`
+ `20261031_syncroom.sql` me hain.**

**Missing / next:** role hierarchy (owner/co-host/moderator/listener —
`core/room/permissions.ts` partial), host-disconnect pe co-host promotion,
scheduled live events (Phase 15), large-audience listening-party mode
(read-only audience + reactions).

### Phase 12 — Podcasts/audiobooks/video 🟡

**Built:** podcasts beta — RSS import (`core/podcast/rss.ts`), show/episode
pages, progress resume (`progress.ts` + `usePodcastProgress`), transcripts.

**Missing:** audiobooks ⬜, music videos ⬜, podcast comments/polls/chapters,
auto-download (Phase 6 download manager ke saath).

### Phase 13 — AI & recommendations 🟡

**Built (beta flags):** AI playlist (`core/ai/playlist.ts` +
`api/ai-playlist.js` + app screens), AI assistant (`core/ai/assistant.ts` +
`api/ai-assistant.js`), signals ledger (`core/signals/` — play/skip/like
events already record ho rahe hain).

**Built (recos v1):** signals-based **Made for You** — `core/recommendations/
rank.ts` (pure weighted scoring: plays/completions/likes/playlistAdds −
skips) + `services/recommendationService.ts` (top artists → round-robin
fetch → recently played + current queue exclude) + Home section
(`app/(tabs)/index.tsx`). Data kam (<5 signals) ho to section chhup jata hai.

**Missing / next:** prompt history + refine/regenerate UI, collaborative
filtering (sab users ka ledger), rate limits + prompt filtering hardening.

### Phase 14 — Premium & payments ❌ OUT OF SCOPE (app free-forever)

**User decision (2026-11-02): app te sab kuch free hai — kabhi payments,
subscriptions, entitlements ya billing nahi aayega.** Is phase ka koi code
nahi hoga, aur `premium_enabled` flag registry se hata diya gaya hai taaki
galti na bane. In-app ticketing (Phase 15) vi is decision ke saath external
redirect hi rahega — koi checkout app me nahi. Family plan jaisi features
(Phase 2) bina billing bhi possible hain (managed/child accounts), agar
kabhi chahiye.

### Phase 15 — Events & concerts ⬜

`constants/concerts.ts` data-only hai. MVP exactly plan ke hisaab se:
event page + venue + external ticket link + reminder + share. **In-app
ticketing kabhi nahi** (plan agree karta hai) — external provider redirect.

### Phase 16 — Notifications ⬜

`notificationManager.ts` stub hai; devices table me `push_token` column ready.
Tasks: Expo push (EAS) ya FCM direct, per-type opt-in settings, quiet hours,
in-app inbox. Types: plan ke 12 types me se pehle — new release, chat message,
room starting, blend/jam invite, event reminder.

### Phase 17 — Widgets & device integrations ⬜

Lock-screen/notification controls + background audio ✅ (react-native-track-player).
Baaki (Android Auto, Wear OS, Cast, Alexa, TV) last me — `DeviceIntegration`
adapter pattern plan ke hisaab se, `core/media/mediaFacade.ts` isi boundary pe
hai. Widgets (Now Playing) jab playback_sessions cross-device sync ho jaaye.

---

## 3) Backend architecture (reconciliation)

Plan "modular monolith" bolta hai — **is repo ka backend already wahi hai**,
bas managed form me:

```
Supabase (modular monolith):
  Postgres        -> profiles, devices, blends, rooms, share tokens (RLS enabled)
  Auth            -> email + Google OAuth, sessions
  Realtime        -> room broadcast, presence (chat/rooms/sync)
  Edge Functions  -> blend-compute (pg_cron), share resolve
Vercel functions:  publish (transport), youtube-match, share, ai-playlist,
                   ai-assistant, jam-clock, health
CDN/Object store:  music APIs apne CDN dete hain (federated model) — apna
                   object store tabhi jab downloads/uploads aayenge
Redis/Queue:       abhi zarurat nahi (Supabase Realtime kaafi hai);jab DMs +
                   notifications aayenge tab Realtime channels + pg_cron hi
                   pehle scale karenge, alag Redis service baad me
```

Plan ka "separate realtime service" ka points: Supabase Realtime wo role play
karta hai — alag WebSocket server deploy karne ki zarurat is scale pe nahi.

---

## 4) Testing (plan ke tests ↔ is repo ke suites)

| Plan | Repo |
|------|------|
| Unit: queue reducer/playback state | `test-player.mjs` (19), `test-loadqueue.mjs` |
| Unit: blend calculation | `test-logic.mjs` (blend scoring checks) |
| Unit: flags/permissions/privacy | `test-logic.mjs` (Phase 0 checks: 13-flag env mapping, errorReporting pipeline) |
| Unit: download state machine | Phase 6 me aayega |
| Unit: subscription entitlement | Phase 14 me aayega |
| Integration: login/logout, chat, rooms, reconnect | room/jam/blend suites + `20261031_syncroom.sql` RLS tests |
| Multi-device / security tests | Phase 1/9/11 completion ke saath formal karenge |

Current totals: 156 node:test + 125 logic + 67 youtube-match + loadqueue —
sab green.

---

## 5) MVP scope reconciliation (plan ka "Best MVP scope")

| Plan MVP item | Status |
|---------------|--------|
| 1. Account/login | 🟡 Supabase auth built; OTP/sessions UI missing |
| 2. User profile | 🟡 profile screen + avatars; settings partial |
| 3. Album/artist pages | ✅ |
| 4. Queue management | 🟡 store APIs built; dedicated queue screen missing |
| 5. Liked songs/library | ✅ |
| 6. Share links | ✅ (+QR) |
| 7. Basic 1:1/group chat | 🟡 room chat ✅; DMs ⬜ |
| 8. Basic reactions | ⬜ |
| 9. Blend | ✅ |
| 10. Private Jam room | ✅ |
| 11. Push notifications | ⬜ |
| 12. Privacy/block/report | ⬜ |

---

## 6) Adapted build order (is repo ke liye final)

Plan ka order theek hai, par is repo me kaam ho chuka hai — isliye actual
"agla kaam" order:

**Ho gaya (2026-11-02 build):** queue screen + sleep timer + Radio,
reactions + block/report + migration 004, downloads v1, Made-for-you recos,
logout-everywhere + account deletion.

1. **Auth OTP verify + devices UI** — Phase 1 da aakhri slice
2. **Push notifications** — Phase 16 (auth + devices table ready hai)
3. **DMs (1:1/group chat)** — Phase 9 (reactions/block/report base ready)
4. **Downloads v2** — Wi-Fi-only + auto-download + resumable progress
5. **Recommendations v2** — collaborative filtering (ledger data jama ho raha hai)
6. **Events MVP (external tickets) → device integrations** — Phase 15 → 17

**Kabhi nahi karo:** payments/subscriptions (Phase 14 — app free-forever),
in-app ticketing, AI rebuild, widgets — foundation pe depend karte hain.

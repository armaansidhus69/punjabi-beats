# Punjabi Beats — Production Roadmap Checklist

> Master checklist derived from the supplied production plan.
> `[ ]` pending · `[~]` in progress · `[x]` complete · `[!]` blocked

## Working rules

- Preserve existing playback, queue, room sync, playlists, and local guest usage.
- Keep the current Expo SDK 51 / React Native / Zustand / AsyncStorage / Expo Router stack.
- New features start behind feature flags disabled by default.
- Build a modular monolith first; split only realtime, media/download, and notification workers when needed.
- Do not claim a phase complete until its user flow and checks are verified.

## Phase 0 — Current app foundation

### Core modules

- [x] Add central guest/user identity module
- [x] Add stable device identity module
- [x] Add session manager
- [x] Add typed server API client
- [x] Add versioned local database/storage migration layer
- [x] Add feature flag registry with all new flags disabled by default
- [x] Add analytics/event facade
- [x] Add error-reporting facade
- [x] Add deep-link router facade
- [x] Add notification manager facade
- [x] Add permission manager facade
- [x] Keep existing media/player service behind a core media boundary

### Initial feature flags

- [x] `auth_enabled`
- [x] `catalog_enabled`
- [x] `social_share_enabled`
- [x] `chat_enabled`
- [x] `blend_enabled`
- [x] `jam_enabled`
- [x] `lyrics_enabled`
- [x] `downloads_enabled`
- [x] `ai_playlist_enabled`
- [x] `premium_enabled`
- [x] `events_enabled`

### Phase 0 acceptance

- [ ] Existing guest app starts without a login requirement
- [ ] Existing playlists, history, player queue, and room sync still load
- [ ] Device ID persists across app restart
- [ ] Local storage migrations are versioned and idempotent
- [ ] Disabled feature flags do not expose new screens/actions
- [ ] Core initialization failures do not stop playback

## Phase 1 — Account and authentication

> Supabase-backed client, auth service, guarded routes, and the initial
> `profiles`/`devices` migration are scaffolded. Real sign-in verification
> requires a Supabase project URL/key and applying the migration.

### Identity and sessions

- [~] Email/password registration and login
- [~] Email verification
- [~] Google login UI and Supabase OAuth flow
- [ ] Apple login
- [ ] Facebook login
- [ ] Phone login and OTP verification
- [~] Forgot password
- [~] Logout and refresh-token rotation
- [ ] Multiple-device sessions
- [ ] Account switching
- [~] Profile creation, avatar, username/display name
- [ ] Account deletion
- [ ] Revoke another device session

### Data model and API

> Supabase Auth manages `auth.users`, provider identities, and refresh
> sessions. The app does not duplicate those internal tables; the custom
> profile/device migration is at `supabase/migrations/001_profiles_devices.sql`.

- [ ] `users`
- [ ] `auth_identities`
- [ ] `user_sessions`
- [~] `devices`
- [ ] `POST /v1/auth/register`
- [ ] `POST /v1/auth/login`
- [ ] `POST /v1/auth/verify-otp`
- [ ] `POST /v1/auth/refresh`
- [ ] `POST /v1/auth/logout`
- [ ] `GET /v1/me`
- [ ] `PATCH /v1/me/profile`
- [ ] `GET /v1/me/sessions`
- [ ] `DELETE /v1/me/sessions/{id}`

### Screens and acceptance

- [~] Welcome, Login, Register, Forgot Password
- [ ] OTP screen
- [~] Profile setup and account settings
- [ ] Active sessions, switch account, delete account
- [ ] Guest can upgrade without losing local playlists/history
- [ ] Second-device login works
- [ ] Logout invalidates the session
- [ ] Last authenticated session supports offline startup

## Phase 2 — Family, kids, and safety

- [ ] Family plan and plan manager
- [ ] Managed/child accounts
- [ ] Parent approval, age verification, consent, PIN protection
- [ ] Content allowlist/blocklist
- [ ] Member invite/removal and profile switching
- [ ] `families`, `family_members`, `managed_accounts`, `parental_controls`
- [ ] `content_restrictions`, `age_verifications`, `consent_requests`
- [ ] Profile visibility and listening-activity controls
- [ ] Chat, room, Blend, and friend-request privacy controls
- [ ] Block/unblock user
- [ ] Report user/message/playlist/room
- [ ] Mute user and hide listening activity

## Phase 3 — Complete music catalogue

### Content model

- [ ] `tracks`
- [ ] `albums`
- [ ] `artists`
- [ ] `playlists`
- [ ] `genres`
- [ ] `moods`
- [ ] `music_videos`
- [ ] `shows`
- [ ] `episodes`
- [ ] `audiobooks`
- [ ] `events`
- [ ] `venues`

### Catalogue screens and actions

- [ ] Album pages, save/download/radio/share/related releases
- [ ] Artist pages, biography, popular tracks, albums, singles, videos, radio
- [ ] Artist follow/share/concert/merch sections
- [ ] Playlist cover, description, owner, visibility, collaboration
- [ ] Playlist followers, history, sort/filter, duplicate, restore version
- [ ] Add/remove/reorder tracks

## Phase 4 — Search, home, and discovery

- [ ] Search tracks, artists, albums, playlists, podcasts, audiobooks, events, users
- [ ] Autocomplete and search suggestions
- [ ] Voice search
- [ ] Content-type filters
- [ ] Recently played and continue listening sections
- [ ] Recommended tracks/albums/playlists
- [ ] New releases and popular artists
- [ ] Podcast, audiobook, concert, and live-room suggestions
- [ ] Initial recommendations from history, likes, searches, genres, artists, skips, and time
- [ ] Later collaborative filtering, Smart Shuffle, personalized playlists, AI playlists

## Phase 5 — Playback upgrade

### Queue

- [ ] Dedicated queue screen
- [ ] Add to queue and Play Next
- [ ] Reorder/remove/clear queue
- [ ] Save queue as playlist
- [ ] Queue persistence and cross-device synchronization

### Playback controls

- [ ] Shuffle modes and repeat context
- [ ] Autoplay
- [ ] Sleep/end-of-track timers
- [ ] Playback speed
- [ ] Crossfade and gapless playback
- [ ] Volume normalization and equalizer
- [ ] Audio output picker, Bluetooth, cast, remote playback
- [ ] Picture-in-picture where supported

### Acceptance

- [ ] Current track/position restores after restart
- [ ] Queue restores after restart
- [ ] Queue reorder updates immediately
- [ ] Same-account playback synchronizes across devices
- [ ] Bluetooth disconnect/reconnect is graceful

## Phase 6 — Library and offline downloads

### Library

- [ ] Liked songs and saved albums/artists
- [ ] Saved podcasts/episodes/audiobooks
- [ ] Downloaded content section
- [ ] Recently played and library search
- [ ] Grid/list layouts, filters, and sorting

### Downloads

- [ ] Keep downloads separate from stream cache
- [ ] `downloads` model with content type, path, status, progress, size, expiry, and error
- [ ] States: available, queued, downloading, paused, downloaded, failed, expired, deleted
- [ ] Download track/album/playlist/episode/audiobook
- [ ] Pause, resume, cancel, retry, and bulk redownload
- [ ] Storage usage and clear-downloads controls
- [ ] Wi-Fi-only and podcast auto-download settings
- [ ] Offline mode and offline playback validation
- [ ] License/authorization checks for offline audio

## Phase 7 — Lyrics and transcripts

### Lyrics

- [~] Full-screen lyrics *(7a v1: `/lyrics` modal + player entry; translation/share baad)*
- [~] Synced line-by-line lyrics *(7a v1: LRCLIB LRC highlight + follow + tap-to-seek)*
- [ ] Translation
- [ ] Share selected lines
- [~] Lyrics cache and error states *(7a v1: versioned `@pb_lyrics` cap 50 + not-found/network/rate retry)*
- [ ] Report incorrect lyrics

  > **2026-10-30 [~] status (Lyrics v1 7a)**: coded per
  > `docs/superpowers/specs/2026-10-29-lyrics-design.md` +
  > `docs/superpowers/plans/2026-10-30-lyrics-plan.md`. LRCLIB exact
  > artist/title/duration lookup + scored search fallback (free/keyless),
  > identified client header, 10s abort, `Retry-After` backoff. Pure core
  > `core/lyrics/lyrics.ts` parses multi-timestamp LRC + offset, resolves
  > current-line boundaries, and caps cache at 50. `/lyrics` is gated by
  > `lyrics_enabled` (default off), player icon stays hidden while off,
  > direct route makes zero network calls while gated. Plain-only fallback
  > uses approximate highlight. Translation, selected-line sharing, report,
  > and podcast transcripts remain `[ ]`.

### Transcripts

- [ ] Podcast transcripts
- [ ] Transcript search
- [ ] Current-sentence highlighting
- [ ] Jump to timestamp
- [ ] Save transcript position
- [ ] Report transcript issue
- [~] `lyrics` and `transcripts` data models *(7a local LyricsData/cache envelope done; transcript model pending)*

## Phase 8 — Social sharing

- [ ] Canonical track, album, artist, playlist, room, Blend, and Jam links
- [ ] Share-token creation and server preview metadata
- [ ] Native share sheet and web fallback
- [ ] Open/click analytics
- [ ] Share track, album, artist, playlist, lyrics, Blend, Jam, room, Wrapped, and event
- [ ] Device-generated share cards
- [ ] Later server-side share-card generation
- [ ] Instagram Stories/Notes
- [ ] Facebook Feed/Stories and Messenger
- [ ] Copy link and QR/share code

## Phase 9 — Chat and social interaction

### Chat

- [ ] One-to-one, group, room, listening-party, and event chat
- [ ] Text, track, album, artist, playlist, lyrics, image, GIF, event, and invite messages
- [ ] Reply, reactions, delete, read state, typing, and delivery state
- [ ] Mute/leave group, member management, privacy, report, and block

### Backend and safety

- [ ] `chats`, `chat_members`, `messages`, `message_attachments`
- [ ] `message_reactions`, `message_reads`, `chat_mutes`, `user_blocks`, `user_reports`
- [ ] Realtime message events
- [ ] Rate limits and attachment limits
- [ ] Image scanning and profanity/spam filtering
- [ ] Moderator/report queue

## Phase 10 — Blend

- [~] Create Blend
- [~] Invitation links
- [~] Taste similarity calculation
- [~] Shared generated playlist
- [~] Member-specific song attribution
- [~] Periodic Blend updates
- [~] Add/remove eligible tracks
- [~] `blends`, `blend_members`, `blend_items`
- [~] Create, invite, invitation, members, match percentage, story, edit, leave, remove-member screens

  > **2026-10-28 [~] status**: feature coded behind `blend_enabled` (default
  > off) per `docs/superpowers/specs/2026-10-28-blend-design.md` +
  > `docs/superpowers/plans/2026-10-28-blend-plan.md`. Sources: migration
  > `supabase/migrations/002_blend.sql`, Edge Function
  > `supabase/functions/blend-compute/` (+ `_shared/blend-scoring.ts` copy),
  > screens `mobile/app/blend/*`, pure logic `mobile/core/blend/*`.
  > Gates pass: tsc 0 · eslint 0 · root `npm test` green (15 new
  > `test-blend.mjs` assertions + parity guard). Pending: apply migration +
  > deploy Edge Function + cron SQL (`supabase/cron/blend-daily-refresh.sql`)
  > and a 2-device manual pass — boxes flip to `[x]` only after that.

## Phase 11 — Jam and live listening rooms

### Room types

- [~] Private Jam
- [~] Host-controlled listening party
- [ ] Scheduled live event *(v1 scope se bahar — Phases 14/15 overlap me plan)*
- [ ] Event page, creator/artist host, moderation, and access rules *(wahi defer)*

### Room model

- [~] `rooms`
- [~] `room_members`
- [~] `room_playback_state`
- [~] Owner/co-host/moderator/participant/listener roles
- [~] Server-authoritative playback state and versioning
- [~] WebSocket room events
- [~] Reconnection and state-version recovery
- [~] Host disconnect/co-host promotion
- [~] Room close and empty-room expiry

  > **2026-10-29 [~] status**: feature coded behind `jam_enabled` (default
  > off) per `docs/superpowers/specs/2026-10-29-jam-rooms-design.md` +
  > `docs/superpowers/plans/2026-10-29-jam-rooms-plan.md`. Sources: migration
  > `supabase/migrations/003_rooms.sql` (5 tables + RLS + `fn_join_room` RPC),
  > Edge Function `supabase/functions/room-control/` (service-role, version
  > bumps) + `_shared/room-permissions.ts` parity copy, cron
  > `supabase/cron/rooms-hourly-expiry.sql`, realtime
  > `mobile/services/jamRealtime.ts`, screens `mobile/app/jam/*` +
  > `mobile/components/{JamGate,AddSongSearchModal}.tsx`, pure logic
  > `mobile/core/room/*`. Live event rows intentionally `[ ]` (spec defer).
  > Gates pass: tsc 0 · eslint 0 · root `npm test` green (20 new
  > `test-jam.mjs` assertions + permissions parity guard). Pending: apply
  > migration + deploy `room-control` + cron SQL + `jam_enabled` flag +
  > 2-device manual pass — boxes flip to `[x]` only after that.

## Phase 12 - Podcasts, audiobooks, and video

### Podcasts

- [~] Podcast show/episode pages, trailers, continue listening, played state
- [~] Save-for-later, comments, polls, transcripts, chapters, auto-download *(save-for-later hi v1 me; baaki defer)*
- [ ] Podcast notification preferences
- [ ] Audiobook pages, chapters, progress, resume, purchase/access, family access
- [ ] Audiobook offline-license handling
- [ ] Music-video pages, video feed, full-screen player, playlists, quality, download policy

  > **2026-10-29 [~] status**: Podcasts v1 (12a) coded behind
  > `podcasts_enabled` (default off) per
  > `docs/superpowers/specs/2026-10-29-podcasts-design.md` +
  > `docs/superpowers/plans/2026-10-30-podcasts-plan.md`. Scope: show/episode
  > pages, iTunes show + episode search, full-episode playback (RSS enclosure,
  > no 30s preview limit), continue-listening, played state (95%/sticky),
  > save-for-later — sab local-only AsyncStorage (`@pb_podcast_shows` /
  > `@pb_podcast_progress`), guest-compatible, koi Supabase auth/deploy nahi.
  > Sources: parser `mobile/core/podcast/rss.ts` (hand-rolled walker, ATOM
  > fallback), adapters `mobile/core/podcast/episode.ts` (+ progress
  > `progress.ts`), service `mobile/services/podcastService.ts` (RSS-first,
  > lookup fallback), screens `mobile/app/podcast/*` +
  > `mobile/components/{PodcastGate,EpisodeRow}.tsx`, Library entry card.
  > Episode→player existing pipeline se (`episodeToSong`, previewOnly false).
  > Comments/polls/transcripts/chapters/auto-download/notification prefs +
  > audiobooks + music-video rows genuinely `[ ]` — later phases.
  > > Gates pass: tsc 0 · eslint 0 · root `npm test` green (11 new
  > `test-podcast.mjs` assertions). Pending: `EXPO_PUBLIC_PODCASTS_ENABLED=true`
  > + manual pass (koi server deploy nahi chahiye) - boxes flip to `[x]`
  > only after that.

## Phase 13 — AI and recommendations

### Data foundation

- [~] Play history and skips
- [~] Likes/saves and playlist changes
- [~] Search behavior and room activity *(search queries recorded; room = reaction_log DB-level + play_start remote tag — v1 count nahi)*
- [~] User preference signals *(raw counters + consumer-time weights)*

  > **2026-10-29 [~] status (Data foundation 13a)**: signals
  > coded local-first per `docs/superpowers/specs/2026-10-29-signals-design.md`
  > + `docs/superpowers/plans/2026-10-30-signals-plan.md`. Sources: pure core
  > `mobile/core/signals/{schema,skip,stats}.ts` (ledger schema + 30s/80%/95%
  > policy + raw-counter aggregation), service `mobile/services/signalsService.ts`
  > (analytics facade sink — stub pehli baar live, boot pe wired via
  > `core/bootstrap.ts`), player wiring `stores/playerStore.ts`
  > (play_start + outgoing-track classify, remote/auto-advance suppression),
  > store emit call sites (search/liked/playlist). Keys `@pb_play_signals`
  > (cap 1000, versioned envelope) + `@pb_taste_stats` (raw counters; weights
  > consumer-time pure). Guest-compatible, koi backend nahi; AI playlist rows
  > above genuinely `[ ]` (13b — LLM call, server key). Gates pass: tsc 0 ·
  > eslint 0 · root `npm test` green (9 new `test-signals.mjs` assertions).
  > Consumer (playlist/assistant UI + LLM) = 13b`.

  > **2026-10-29 [~] status (AI playlist v1 13b)**: coded per
  > `docs/superpowers/specs/2026-10-29-ai-playlist-design.md` +
  > `docs/superpowers/plans/2026-10-30-ai-playlist-plan.md`. Server
  > `api/ai-playlist.js` + pure `api/_aiPlaylistCore.js` (prompt isolation,
  > response parser, 2-window limiter 10/day + 4/hour — `GEMINI_API_KEY`
  > Vercel env, `GEMINI_MODEL` override, fail-closed `no_key`). Client:
  > pure `core/ai/playlist.ts` (sanitize + fuzzy resolve tiers), service
  > `services/aiPlaylistService.ts` (13a taste context, `AiPlaylistError`
  > codes), store `stores/aiPlaylistStore.ts`, screen `app/ai-playlist.tsx`
  > (disclosure strip hamesha on) + Library card #4. History
  > `@pb_ai_prompts` cap 10. Flag `ai_playlist_enabled` default off. Tests
  > `test-ai-playlist.mjs` (10 assertions) + `probe-ai-playlist.mjs` (local
  > handler checks / `--live` mode). Assistant rows 13c pending — genuinely
  > `[ ]`.

  > **2026-10-29 [~] status (Assistant v1 13c)**: coded per
  > `docs/superpowers/specs/2026-10-29-ai-assistant-design.md` +
  > `docs/superpowers/plans/2026-10-30-ai-assistant-plan.md`. Server
  > `api/ai-assistant.js` + pure `api/_aiAssistantCore.js` (intent protocol
  > `search/play/pause/next/prev/queue_add/create_playlist/chat`, turns
  > isolation, custom-limits `rateLimitBucket` 20/day + 5/hour — same
  > `GEMINI_API_KEY`). Client: pure `core/ai/assistant.ts` (quick commands
  > OFFLINE match + validator second guard), service
  > `services/aiAssistantService.ts` (execution playerStore/playlistStore
  > local — playback server nahi jaata), store `assistantStore.ts`
  > (`@pb_ai_chat` cap 20, failed-retry), screen `app/ai-assistant.tsx`
  > (disclosure + quota pill + result cards) + `AiAssistantGate`
  > (`ai_assistant_enabled` default off) + Library card #5. Privacy:
  > context sirf top-5 artist names + apne turns; ids/queries/ledger nahi.
  > Tests `test-ai-assistant.mjs` (8) + `probe-ai-assistant.mjs`. Voice +
  > agent loop abhi `[ ]`.

### AI playlist and assistant

- [~] Prompt input/history *(13b v1: prompt input + history chips @pb_ai_prompts cap 10)*
- [~] Generated playlist with add/remove/refine/regenerate/save/report *(13b v1: preview remove/refine/Play All/save; "report" per-row reason string only — deep report 13c)*
- [~] AI disclosure and rate limits *(13b v1: disclosure strip + 10/day+4/hour limiter)*
- [~] Assistant conversation and commands *(13c v1: chat + search/play/transport/queue/create_playlist intent protocol; agent-loop/dream 13.4 [ ])*
- [~] Search, play, stop/cancel, and create-playlist commands *(13c v1: sab live (stop=pause); cancel nahi — [ ])*
- [~] Prompt/output safety *(13b+13c: user text instruction se isolated, args whitelist + client second guard; full red-team pass [ ])*
- [~] No private user data in model logs *(13c v1: context sirf coarse artist names + user apne chat turns; ledger/ids/timestamps kabhi nahi — model-log retention server-side [ ])*

## Phase 14 — Premium and payments

- [ ] Products, plans, subscriptions, entitlements, billing transactions, payment events
- [ ] Premium page, trial, monthly/yearly plans, Family/Duo plans
- [ ] Upgrade, downgrade, cancel, restore purchase
- [ ] Billing status, failure handling, country/address, alternative checkout
- [ ] Android purchase-token verification on the server
- [ ] Renewal/cancel events update server entitlement
- [ ] Client never becomes entitlement source of truth

## Phase 15 — Events and concerts

### MVP

- [ ] Artist event page and venue page
- [ ] Date/time, location, description, external ticket link
- [ ] Save event, reminder notification, share event

### Later

- [ ] Ticket inventory, seats, checkout, ticket wallet, QR ticket, venue map
- [ ] Live event chat and artist livestream
- [ ] Keep first release on external ticket providers

## Phase 16 — Notifications

- [ ] New episode/release notifications
- [ ] Blend, chat, Jam, room, event, and download notifications
- [ ] Family, premium, and account-security notifications
- [ ] `notifications` model with deep links and read state
- [ ] Notification settings and per-type opt-in/out
- [ ] Quiet hours
- [ ] Push-token management
- [ ] In-app notification inbox

## Phase 17 — Widgets and device integrations

### Widgets

- [ ] Now Playing widget
- [ ] Play/pause/next/previous
- [ ] Artwork/current track/queue shortcut/room shortcut
- [ ] Material You styling

### Integrations

- [ ] Chromecast
- [ ] Spotify Connect-style remote devices
- [ ] Android Auto/Automotive
- [ ] Wear OS
- [ ] Alexa, Waze, Google Meet
- [ ] Android TV, Samsung, and Sony surfaces
- [ ] Adapter interface for each integration

## Backend architecture

- [ ] Modular monolith modules: Auth, Catalogue, Library, Playback, Social, Chat, Room, Recommendation, Billing, Events, Notification
- [ ] PostgreSQL main data store
- [ ] Redis for presence, room state, and rate limits
- [ ] Object store for images/GIFs/share cards
- [ ] CDN for artwork/audio/video
- [ ] Queue for downloads, notifications, and card generation
- [ ] Separate realtime WebSocket service when required
- [ ] Separate media/download worker when required
- [ ] Separate notification worker when required

## Testing and release gates

- [ ] Unit tests for queue, playback, Blend, permissions, downloads, entitlement, privacy
- [ ] Integration tests for auth, links, chat, rooms, sync, reconnect, downloads, purchase verification
- [ ] Multi-device tests for same-account playback, host disconnect, slow network, offline recovery
- [ ] Security tests for unauthorized access, expired links, blocked users, token tampering, abuse, deep links
- [ ] Every feature is feature-flagged
- [ ] Crash reporting and analytics available
- [ ] Existing playback remains stable

## Current execution slice — Phase 0

- [x] Create the checklist and preserve existing app checklist
- [x] Add identity/device/session foundation
- [x] Add feature flags with safe defaults
- [x] Add network/API facade
- [x] Add versioned local migration facade
- [x] Add analytics/error/notification/permission facades
- [x] Add deep-link router facade
- [x] Wire initialization without changing playback behavior
- [x] Run existing tests, typecheck, lint, Expo Doctor, and web bundling

## Definition of success

- [ ] Guest user can upgrade to an account without losing local data
- [ ] Shared links open the correct screen
- [ ] Chat messages deliver reliably
- [ ] Room playback syncs across devices and recovers after reconnect
- [ ] Blend is deterministic and refreshable
- [ ] Downloads play offline with authorization
- [ ] Server verifies payment entitlements
- [ ] Privacy/block/report controls work
- [ ] Every new feature remains behind a flag until beta rollout

# Punjabi Beats — Architecture Research and Improvement Report

**Research date:** 2 November 2026  
**Project:** Punjabi Beats  
**Reference projects:**

- [Metrolist](https://github.com/MetrolistGroup/Metrolist)
- [zemer-cipher](https://github.com/ZemerTeam/zemer-cipher)

## 1. Executive summary

Punjabi Beats is an Expo React Native application with a Vercel serverless API and
client-side room synchronisation. It already has the right high-level boundaries
for a small music app: screens render UI, Zustand stores own state, services own
network/provider work, and `react-native-track-player` owns native playback.

The most valuable ideas from the reference projects are architectural rather than
code-level copies:

1. Keep one authoritative playback owner and expose a small state boundary to UI.
2. Treat stream URLs as short-lived capabilities with cache expiry, invalidation,
   and retry/recovery policy.
3. Validate all remote configuration before accepting it and retain the last-good
   configuration when refresh fails.
4. Keep durable library/history data separate from the active playback queue.
5. Test provider resolution and playback transitions with deterministic fixtures.

Punjabi Beats should **not** copy GPL implementation code, assets, or the native
Android architecture of either project. The two reference repositories are
GPL-3.0 licensed. This report records ideas and links for attribution; the
implementation below remains an independent TypeScript/Expo design.

## 2. Reference repository research

### 2.1 Metrolist

Metrolist is a native Android YouTube Music client built around Kotlin,
Jetpack/Compose, Media3/ExoPlayer, a foreground `MediaLibraryService`, Room, and
Flow-based view models.

#### Playback and audio service

- `MusicService` is the process-level playback owner. It creates the ExoPlayer,
  media session, notification, audio focus handling, connectivity observer,
  caching, and foreground-service lifecycle.
- `PlayerConnection` is a UI-facing control/state boundary. It observes player
  readiness, playback state, current metadata, queue windows, shuffle/repeat,
  errors, and network waiting state.
- Playback errors have explicit recovery state, retry limits, network recovery,
  stream URL invalidation, and per-song failure guards. This prevents one bad
  stream from creating an infinite retry loop.
- A separate `StreamUrlCache` stores expiry, request headers, client identity,
  and cache generations. A late resolver cannot overwrite a newer invalidation.
- Sleep timer, audio focus, Bluetooth, background notification controls, and
  player lifecycle are service responsibilities rather than screen concerns.
- The service persists queue and player state and restores it in the background
  owner, not in individual screens.

#### Search and library

- Search is split into online/local view models, with a dedicated suggestions
  path and debounced state flows.
- Library data is backed by Room entities and relation tables for songs, artists,
  albums, playlists, history, lyrics, and search history. View models expose
  screen-specific projections instead of making composables query storage.
- Queue items, library records, download records, and playback history are
  separate concepts. This makes reordering and persistence less error-prone.

#### Lyrics, UI, and error handling

- Lyrics use a provider registry with configurable order, per-provider timeouts,
  an overall timeout, cancellation, in-memory caching, and a not-found result
  instead of throwing through the UI.
- Compose screens are fed by state flows and keep playback in the service. UI
  navigation therefore does not stop playback.
- Media session and notification controls use the same player owner as the main
  UI, so play/pause/next/previous/seek do not have separate implementations.

#### Relevance to Punjabi Beats

Adoptable now:

- preserve the current single TrackPlayer owner and strengthen its state/error
  boundary;
- resolve the selected track before resolving optional upcoming tracks;
- add bounded URL/result caching with expiry and invalidation;
- keep playlist/history/search persistence in storage services, not screens;
- make lyrics/provider fallback bounded and cancellation-safe;
- keep native background controls in `playbackService.ts`.

Not a direct fit now:

- replacing Expo/TrackPlayer with Media3 would be a platform rewrite;
- Room/Flow/Hilt are not appropriate dependencies for the current app;
- equalizer, crossfade, audio normalisation, and offline cache require native
  support and device testing before enabling them.

### 2.2 zemer-cipher

`zemer-cipher` is a standalone Android library for YouTube player signature/n
transformation and PoToken generation. Its README documents a separate
`zemer-app` integration that selects and validates stream clients.

Useful reliability patterns:

- `player_configs.json` has a versioned schema and is bundled as an offline
  default.
- `PlayerConfigParser` is a validation boundary: malformed entries, unsafe
  values, newer unsupported schemas, and hash/alias collisions are rejected.
- `PlayerConfigStore` refreshes remote configuration with a TTL and ETag,
  force-refreshes after an unknown player failure, and retains the last-good
  table when the network or file is invalid.
- The rotation workflow uses independent validation, HTTP 206 checks, parser
  parity fixtures, fail-closed deployment, and a kill switch.
- `RendererRecoveryPolicy` and the test harness make failure recovery explicit
  rather than relying on one permanent provider assumption.

Relevance to Punjabi Beats:

- apply the same last-known-good and schema-validation pattern to optional
  provider/configuration data;
- validate provider URLs, expiry, media type, and required identifiers before
  putting a result into the player;
- keep provider probes and recovery tests deterministic.

Out of scope:

- Punjabi Beats will not add cipher deobfuscation, PoToken generation, client
  impersonation, anti-bot evasion, or undocumented extraction. YouTube Music
  playback remains limited to configured/authorized catalogue and audio
  integrations already supported by the project.

### 2.3 Licensing and attribution

Both repositories currently identify themselves as **GPL-3.0** projects. No
reference source code, assets, generated configuration, or copied UI has been
added to Punjabi Beats. This report links to the projects and describes
architectural observations only. If a future change incorporates source code or
GPL-derived material, licensing review and attribution must happen before that
change is merged.

## 3. Punjabi Beats architecture map

```text
Expo Router screens (mobile/app)
        │
        ├── reusable UI (mobile/components)
        ├── Zustand stores (mobile/stores)
        │       ├── playerStore ───────────────┐
        │       ├── playlist/liked/search       │
        │       ├── sleep timer                 │
        │       └── room/blend/jam              │
        │                                       │
        ├── pure domain utilities (mobile/core, mobile/utils)
        └── service layer (mobile/services) ────┤
                ├── musicApi provider chain     │
                ├── storage / AsyncStorage      │
                ├── lyrics, downloads, sync     │
                └── auth / feature flags        │
                                                │
Vercel serverless API (api/)                    │
  publish, youtube-match, health, room/AI/share │
                                                │
react-native-track-player native service ◄─────┘
  playbackService + notification/remote events
```

### Frontend and navigation

- Expo SDK 51 / React Native 0.74 / Expo Router 3.
- Root `mobile/app/_layout.tsx` installs providers, initializes core services,
  registers the TrackPlayer playback service, mounts the global mini-player,
  and mounts global sheets/toast.
- `mobile/app/(tabs)/_layout.tsx` owns Home, Search, Library, and Room tabs.
- Screens render UI and call stores/services; most domain operations already live
  outside route files.

### Playback engine

- `mobile/stores/playerStore.ts` is the logical playback owner.
- `react-native-track-player` is the native queue/audio engine.
- `mobile/services/playbackService.ts` handles media notification and remote
  controls.
- `mobile/core/media/mediaFacade.ts` is a small boundary around player startup.
- `musicApi.ts` resolves JioSaavn/Audius/optional Gaana/Jamendo/iTunes,
  Spotify metadata, Verome, and Piped results into the common `Song` shape.
- Full-song policy is enforced in search, stream resolution, and native queue
  insertion; preview-only rows are not allowed to play.

### State and persistence

- Zustand stores own active UI/application state.
- `mobile/services/storage.ts` is the AsyncStorage boundary for playlists, liked
  songs, recent searches, recently played, player snapshots, room name, and
  provider dead-cache data.
- Supabase is used for optional auth/room/backend data; Apinator is an optional
  realtime transport.
- `mobile/core/database/localStore.ts` and migrations provide the foundation for
  future structured local data, but playlists/history currently remain JSON
  records in AsyncStorage.

### Backend

- Vercel functions in `api/` handle publish, YouTube metadata matching, health,
  AI playlist/assistant, share, and jam clock operations.
- Server-only credentials are kept in Vercel environment variables according to
  the repository rules.
- There is no native Android source tree in the repository; Expo CNG generates
  native projects from configuration.

## 4. Audit findings

### Strengths already present

- single logical player store and single native playback service;
- queue, shuffle, repeat, seek, volume, persistence, recently played, and sleep
  timer primitives already exist;
- stale search requests are guarded by request IDs and debounced input;
- search categories are independently derived and deduplicated;
- playlist import validates rows and persists mutations;
- provider failures are generally converted into fallback results;
- room sync has sequence/echo handling and is separated from provider code;
- test suites cover pure queue logic, player behavior, music providers, search,
  and feature modules.

### Problems and technical debt

1. **Queue load fan-out:** `loadAndPlaySong` resolves every queue item before
   adding the native queue. A large search result queue can therefore issue many
   provider requests before the selected song starts, even though only the
   current track is needed immediately.
2. **Provider result lifetime:** Verome cache entries have expiry checks, but the
   broader full-stream cache is in-memory only and has no in-flight deduplication
   or explicit negative result backoff.
3. **Playback state authority:** the store performs optimistic state updates and
   TrackPlayer listeners later correct them. This is practical, but failures need
   a more explicit loading/error state to prevent controls from appearing ready
   while a resolver is still running.
4. **Library storage scale:** JSON AsyncStorage is suitable for current small
   playlists but will become expensive for very large libraries, ordering, and
   album/artist indexes. The existing local database foundation should be used
   before adding large-library features.
5. **Native verification:** the workspace has no Android SDK/ADB/emulator and no
   generated native directory, so physical background playback and gesture tests
   cannot be completed locally.
6. **Reference-only advanced audio:** equalizer, crossfade, audio normalisation,
   network reconnect policy, and provider configuration refresh are recommendations
   until a compatible Expo/TrackPlayer implementation and device test exist.

## 5. Recommended phased plan

### Phase A — completed in this worktree

- document the architecture and reference research;
- keep Library as one native vertical `FlatList` with cards in its header;
- preserve mini-player-safe bottom padding;
- retain existing search/full-song improvements and regression tests.

### Phase B — playback start and queue reliability — implemented

- resolve the selected track first;
- add only the verified full selected track to the native queue immediately;
- hydrate direct/full upcoming tracks in bounded background batches;
- keep metadata-only logical queue entries until they become active;
- fall back to logical queue next/previous when native tracks are not hydrated;
- preserve auto-skip, repeat, shuffle, and superseded-load semantics.

### Phase C — provider resilience — implemented

- add in-flight request deduplication for the same video/song;
- add bounded positive cache expiry and short negative backoff;
- validate URL/media type/expiry before returning a stream;
- expose a small loading/error state to the player UI.

### Phase D — library scale

- migrate playlist/history/liked-song indexing to the local database boundary;
- keep JSON import/export as a compatibility format;
- add recently played, albums, artists, and ordering operations as indexed data.

### Phase E — device verification and native audio features

- build an Expo development client/EAS development build;
- test Android notification controls, lifecycle, audio focus, network loss,
  mini-player hit targets, and Library gestures on physical/emulated devices;
- only then evaluate speed, equalizer, crossfade, normalisation, and offline
  caching against the actual provider and native engine constraints.

## 6. Implementation status and acceptance checks

The implementation increments cover provider resilience in
`mobile/services/musicApi.ts`, playback intent/loading state, and lazy queue
hydration in `mobile/stores/playerStore.ts`. They preserve the public store API,
full-song policy, room events, queue controls, shuffle/repeat behavior, and the
TrackPlayer background service. Library database migration and physical device
verification remain release-level work.

Checks for each increment:

- `cd mobile && npx tsc --noEmit`
- `cd mobile && npm run lint`
- `npm test`
- `cd mobile && npx expo-doctor`
- `cd mobile && npx expo export --platform web`
- Android development build and physical gesture/audio tests when an Android
  SDK/device is available.

The current workspace cannot claim physical Android verification because `adb`,
the emulator command, and a generated `android/` project are unavailable here.

### Verification recorded for this increment

- `npm test`: passed all suites, including player (21 tests), music API (19
  tests), and search (5 tests).
- `cd mobile && npx tsc --noEmit`: passed.
- `cd mobile && npm run lint`: passed with zero warnings.
- `cd mobile && npx expo-doctor`: 17/17 checks passed.
- `cd mobile && npx expo export --platform web`: passed.
- `git diff --check`: passed; Git only reports the repository's existing
  Windows line-ending conversion notices.
- Android physical/emulator test: not run because `adb` and the Android SDK are
  unavailable in this workspace.

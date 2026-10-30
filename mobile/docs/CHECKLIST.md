# ✅ Punjabi Beats — Development Checklist

> **Legend:** `[ ]` = Pending · `[x]` = Done · `[~]` = In Progress · `[!]` = Blocked

---

## 📦 PHASE 0: Project Setup

- [x] Create Expo project: `npx create-expo-app mobile --template expo-template-blank-typescript@sdk-51`
- [x] Project `mobile/` folder me ready (SDK 51: expo ~51.0.28, RN 0.74.5)
- [x] Install Expo Router: `npx expo install expo-router react-native-safe-area-context react-native-screens expo-linking expo-constants expo-status-bar`
- [x] Install audio: `npm install react-native-track-player@4.1.2` (TrackPlayer — native playback + notification controls; expo-av kabhi install nahi hua, migration ki zaroorat nahi padi)
- [x] Install storage: `npx expo install @react-native-async-storage/async-storage expo-secure-store`
- [x] Install state: `npm install zustand` (v5.0.15)
- [x] Install HTTP: `npm install axios` (v1.20.0)
- [x] Install UI: `npm install react-native-paper` (v5.15.3)
- [x] Install animations: `npx expo install react-native-reanimated react-native-gesture-handler`
- [x] Install toast: `npm install react-native-toast-message` (v2.5.2)
- [x] Install Apinator: `npm install @apinator/client@2.0.0` (TS types included)
- [x] Configure `app.json` (name "Punjabi Beats", slug, scheme, dark theme, portrait)
- [x] Configure `babel.config.js` (SDK 51 me `babel-preset-expo` reanimated plugin auto-included karta hai — alag plugin ki zaroorat nahi)
- [x] Configure `tsconfig.json` (strict: true — already set)
- [x] Setup folder structure (app/, components/, stores/, services/, types/, constants/)
- [x] Theme constants: `constants/colors.ts`, `typography.ts`, `spacing.ts`, `theme.ts` (Paper dark theme)
- [x] Root layout + 4-tab skeleton (Expo Router, dark background) + App.tsx removed
- [x] Verify: `npx tsc --noEmit` → 0 errors
- [x] Test: App runs on Expo Go via QR scan — **PASS (2026-09-27)**: 2 Android phones pe Expo Go se chala

**Phase 0 Complete?** `[x]` (setup + device smoke test PASS)

---

## 🗄️ PHASE 1: Data Layer

### Types
- [x] Define `Song` type
- [x] Define `Playlist` type
- [x] Define `Room` type — `types/index.ts` me `Room` + `RoomMember` (roomStore ise extend karta hai)
- [x] Define `Mood` type
- [x] Define `PlayerState` type (+ `RepeatMode`, Phase 11 sync events, `volume` FR-2.11)

### Music API Service (`services/musicApi.ts`)
- [x] `searchSongs(query: string): Promise<Song[]>`
- [x] **Multi-source fallback chain (full songs priority):** open-source JioSaavn API → Audius → iTunes (2026-10-25)
  - [x] Try 1 `searchJioSaavn` — default `saavn.sumit.co`, optional self-host override, paginated up to 100 results
  - [x] Try 2 `searchAudius` — `api.audius.co/v1/tracks/search` (free, no key, full songs 60s+)
  - [x] Optional Reverbio-style YouTube bridge — metadata search via existing backend + Piped audio resolver when `EXPO_PUBLIC_PIPED_API` is configured
  - [x] Try 3 `searchITunes` — `country=IN`, `entity=song` (sirf 30s preview) + partial Audius top-up
  - [x] **Audio guard** — JioSaavn mirror ke download URL ka HEAD check; zombie mirror (metadata sahi, CDN 404) skip hota hai
  - [x] `previewOnly` flag: sirf iTunes pe `true` → SongItem ka "30s" badge + player note
- [x] Response mapping (har source ka mapper → common `Song`; JioSaavn ke 3 shapes + `link`/`url` dono)
- [x] Error handling with fallback (har source ka try/catch + `[musicApi] … → source` console log)
- [x] Test: `searchSongs('Diljit')` → **JioSaavn full songs** with Audius/iTunes fallback — `probe-search.mjs` live PASS
- [x] Test: Karan Aujla / Sidhu Moose Wala / Satinder Sartaaj → full songs; `xyzabc` → 0 full (clips filter)
- [x] JioSaavn status (2026-10-25): `saavn.sumit.co` returns Punjabi/Hindi metadata plus playable 320kbps URLs; old mirrors remain fallback-only

### Storage Service (`services/storage.ts`)
- [x] `getPlaylists(): Promise<Playlist[]>`
- [x] `savePlaylists(playlists: Playlist[]): Promise<void>`
- [x] `getRecentlyPlayed(): Promise<Song[]>`
- [x] `saveRecentlyPlayed(songs: Song[]): Promise<void>` — actual impl `addRecentlyPlayed(song)` (top-pe-add + dedupe + cap 20)
- [ ] Test: Data persists after app restart (device run baaki — AsyncStorage persist wiring tsc-verified; restart device pe verify hona hai)

### Apinator Service (`services/apinator.ts`)
- [x] Initialize client with app key
- [x] `createRoom(): string` (generate code) — `generateRoomCode()` + roomStore.createRoom
- [x] `joinRoom(code: string): void` — architecture split: roomStore.joinRoom → roomSync lifecycle (FR-5.2)
- [x] `leaveRoom(): void` — roomStore.leaveRoom → channel unsubscribe
- [x] `publish(event, data): Promise<void>` — `publishEvent` (Vercel `/api/publish` POST; Phase 12 deploy ke baad live)
- [x] Subscribe to channel — `subscribeChannel` + roomSync `joinSyncChannel`
- [x] Bind event handlers — `bindChannelEvents` (song-change / playback-control / member-* events)
- [x] Test: Connection established — **2-phone sync LIVE verified (2026-09-27)**: create/join → song-change/playback-control dono devices pe sync

### Zustand Stores
- [x] `playerStore.ts` — currentSong, queue, index, isPlaying, position (+ shuffle/repeat/volume)
- [x] `playlistStore.ts` — playlists, add, remove, create, delete
- [x] `roomStore.ts` — `code`, isHost, members, connectionState (+ naam FR-5.11)
- [x] Test: State updates correctly — device run PASS (2026-09-27: 2 phones pe playback + room flow chala); pure logic `npm test` → 65 assertions

**Phase 1 Complete?** `[x]` (code ✓ tsc clean + device test PASS)

---

## 🎨 PHASE 2: UI Components

### Base Components
- [x] `SongItem.tsx` — song row with artwork + actions (+ `+` add-sheet, active state)
- [x] `MoodCard.tsx` — mood grid card (+ Reanimated spring press — Phase 13)
- [x] `MiniPlayer.tsx` — bottom mini player (root layout me ek hi mount, player modal pe hide)
- [x] `ProgressBar.tsx` — seek bar (+ mini variant, times)
- [x] `PlayerControls.tsx` — play/pause/next/prev (+ shuffle/repeat, haptics)
- [x] `LoadingSpinner.tsx` — loading state
- [x] `EmptyState.tsx` — no results (+ optional emoji prop)
- [x] `ErrorBoundary.tsx` — crash handler (root `_layout` me mounted)

### Theme
- [x] Colors constants (`constants/colors.ts`)
- [x] Typography constants
- [x] Spacing constants
- [x] Apply dark theme throughout (Paper dark `constants/theme.ts` + har screen)

**Phase 2 Complete?** `[x]` (sare components exist + wired; visual check phone pe)

---

## 🏠 PHASE 3: Home Screen

- [x] `app/(tabs)/index.tsx` created
- [x] Greeting header ("Punjabi Beats 🎵") — + clock icon → `/recent` (Phase 14 entry)
- [x] Mood grid (8 cards, 2 columns) — `constants/moods.ts` (probe-verified queries)
- [x] Trending section header — "Trending Now 🔥"
- [x] Trending songs list — `getTrendingSongs()` (punjabi hits, IN store)
- [x] Auto-fetch trending on mount
- [x] Loading state while fetching — LoadingSpinner
- [x] Error state if fetch fails — EmptyState + Try Again (network fail pe crash nahi)
- [x] Tap mood → navigate to `/mood/[id]`
- [x] Tap song → play song — poori trending list queue ban jaati hai (auto-next)
- [ ] Test: Home loads, moods clickable, songs playable (phone manual)

**Phase 3 Complete?** `[x]` (code ✓ tsc clean; phone test baaki)

---

## 🎭 PHASE 4: Mood Screen

- [x] `app/mood/[id].tsx` created
- [x] Read mood id from URL params — `useLocalSearchParams` + `getMoodById` (invalid id pe friendly screen)
- [x] Fetch songs by mood query — `getSongsByMood`
- [x] Display mood title + emoji — BackHeader me `${emoji}  ${title}` + accent bar
- [x] Song list with SongItem — pull-to-refresh + loading/error/empty states
- [x] Back button works
- [ ] Test: All 8 moods load songs (phone manual)

**Phase 4 Complete?** `[x]` (code ✓ tsc clean; phone test baaki)

---

## 🔍 PHASE 5: Search Screen

- [x] `app/(tabs)/search.tsx` created (stub se poora rewrite)
- [x] Search input with icon — 52px bar, `#1f1f2e` bg, 26px radius, focus pe `#ffb347` border
- [x] Debounced search (400ms — Stitch design spec; purane checklist me 300ms tha) — `hooks/useDebounce.ts`
- [x] Search on Enter key (`onSubmitEditing` — debounce skip karke turant)
- [x] Clear button (query.length > 0 pe hi dikhta hai)
- [x] Results list — `SongItem` reuse, max 30 (FR-1.3), race-guard se purane response ignore
- [x] Empty state ("Kuch type karo") — 🎤 emoji (`EmptyState` me naya optional `emoji` prop)
- [x] No results state — 😕 "Kuch nahi mila" / "Doosra try karo"
- [x] Loading indicator — 3 shimmer skeleton rows (`Animated` loop)
- [x] Recent searches (design: max 5) — `stores/searchStore.ts` + `@pb_recent_searches`; FR-1.6 me "last 10" likha hai
- [x] Tap recent → re-search (+ X se single remove, "Clear all" se poora clear; query <2 chars pe nahi search hota)
- [x] Test: Search returns Punjabi songs (live API probe: Diljit / AP Dhillon / Karan Aujla → 30 songs each; garbage query → 0)
  - Extra (design reference): filter chips "All / Songs / Artists / Albums / Playlists" — filhaal sab pe songs hi aate hain (API song-level hai)

**Phase 5 Complete?** `[x]` (code + live search probe + tsc/lint ✓; `npm test` covers app logic; phone pe ek manual run baaki)

---

## ▶️ PHASE 6: Audio Player

- [x] `playerStore.ts` implemented (react-native-track-player@4.1.2 single instance + `setupPromise`, strict TS; **2026-09-27 double-play fix**: generation token + serialized load queue + `requestedTrackId` race guard + `TrackPlayer.reset()` before add — sim test `test-loadqueue.mjs` 3/3 PASS; purana expo-av `Audio.Sound` code kabhi tha hi nahi)
- [x] `playSong(song, queue)` action (+ `initialPosition`/`startPaused`/`remote` options)
- [x] `togglePlay()` action (+ idempotent `play`/`pause` for sync)
- [x] `playNext()` action (shuffle/repeat logic FR-2.9/2.10 ke saath)
- [x] `playPrev()` action
- [x] `seek(position)` action (+ roomSync throttle)
- [x] TrackPlayer setup — `ensurePlayerSetup()` + `updateOptions` (capabilities Play/Pause/Next/Prev/Seek, `appKilledPlaybackBehavior: ContinuePlayback` = background audio; iOS silent-mode Duck nahi — native service)
- [x] Load track on song change — `TrackPlayer.reset()` + `add()` + `skip()` + `play()` (`loadAndPlaySong`)
- [x] Reload guard — `loadGeneration` token + serialized `loadQueue`: purana load stale-skip hota hai, `reset()` se pehle ka track nahi bajta (double-play impossible)
- [x] Progress tracking (every 500ms) — `PlaybackProgressUpdated` listener (`progressUpdateEventInterval: 0.5`)
- [x] Auto-next on finish — `PlaybackQueueEnded` → `playNext()` (+ `PlaybackError` pe skip)
- [ ] Test: Play, pause, next, prev, seek all work (phone manual)

**Phase 6 Complete?** `[x]` (code ✓ tsc clean; phone test baaki)

---

## 🎵 PHASE 7: Mini Player

- [x] `MiniPlayer.tsx` component
- [x] Show current song info — artwork + title + artist (SongArtwork fallback)
- [x] Play/pause button
- [x] Next button
- [x] Progress bar (thin) — ProgressBar `variant="mini"` (top edge pe)
- [x] Tap → open full player — `router.push('/player')`
- [x] Fixed at bottom above tabs — root layout `bottomOffset=TAB_BAR_HEIGHT`
- [x] Hide when no song (+ full-player modal pe bhi hide — AppShell)
- [ ] Test: Persistent on all screens (phone manual)

**Phase 7 Complete?** `[x]` (code ✓ tsc clean; phone test baaki)

---

## 📺 PHASE 8: Full Player

- [x] `app/player.tsx` modal created — Stack `presentation: 'modal'` + `slide_from_bottom`
- [x] Large album art (250x250) — `ARTWORK_MAX_SIZE = 250` (chhoti screen pe width-se clamp)
- [x] Rotating animation when playing — 14s/rotation, sirf `isPlaying` pe (RN Animated loop)
- [x] Song title + artist (+ "Queue me N songs" count)
- [x] Progress bar with times — `showTimes` (current/total)
- [x] Full controls (prev, play, next) — PlayerControls (haptics)
- [x] Shuffle button — `toggleShuffle`
- [x] Repeat button — `cycleRepeat` (off→all→one, active state highlight)
- [x] Swipe down to close — iOS native gesture + Android PanResponder (FR-6.6) + drag handle
- [ ] Test: Full player opens and works (phone manual)

**Phase 8 Complete?** `[x]` (code ✓ tsc clean; phone test baaki)

---

## 📋 PHASE 9: Playlists

- [x] `app/(tabs)/library.tsx` created
- [x] List of playlists
- [x] "New Playlist" button (header pill + empty-state button)
- [x] Create modal (name input) — `components/CreatePlaylistModal.tsx`
- [x] Playlist detail screen (`app/playlist/[id].tsx`)
- [x] Add-to-playlist sheet (from SongItem) — `components/AddToPlaylistSheet.tsx`, root layout me global mount
- [x] Duplicate check (`utils/playlistValidation.ts` + `addSongToPlaylist` false return)
- [x] Delete playlist (header trash button + confirm dialog — swipe/long press nahi)
- [x] Remove song from playlist
- [x] Empty state
- [x] Persist to AsyncStorage
- [x] Test: Create → add → name/duplicate validate headless-PASS (`npm test` → playlistValidation 10/10); AsyncStorage restart-run device pe pending

**Phase 9 Complete?** `[x]` (code + `npm test` ✓; phone pe ek manual run baaki)

---

## 👥 PHASE 10: Group Room

- [x] `app/(tabs)/room.tsx` created
- [x] "Create Room" button
- [x] "Join Room" button
- [x] Create → generates 6-digit code
- [x] Join → input for code
- [x] Room screen (`app/room/[code].tsx`)
- [x] Show room code prominently
- [x] Show host/joined badge
- [x] Leave room button (room screen + Room tab card; back pe room minimize rehta hai)
- [x] Test: Create room, share code, join from 2nd device — **PASS (2026-09-27, 2 devices)**

**Phase 10 Complete?** `[x]` (code ✓ tsc clean + **2-device create/join/sync PASS**)

---

## 🔄 PHASE 11: Real-Time Sync

- [x] Apinator client initialized (`services/apinator.ts` transport + `roomSync.initRoomSync`)
- [x] Subscribe to `room-{code}` channel (lifecycle event se auto — create/join pe)
- [x] Bind `song-change` event
- [x] Bind `playback-control` event
- [x] On song change → broadcast (Vercel `/api/publish` POST — Phase 12 deploy tak silent fail)
- [x] On play/pause → broadcast
- [x] On seek → broadcast (250ms leading+trailing throttle)
- [x] On receive → update local player (`remote: true` flag se echo loop nahi banta)
- [x] Robust JSON parsing (`typeof data === 'string'` + object dono — `utils/syncPayload.ts`)
- [x] Handle connection errors (subscribe error + publish fail → ek baar warning, playback nahi rukta)
- [x] Auto-reconnect (app-level watchdog: `apinator.forceReconnect` + 5s health check + AppState resume recovery — SDK v2.0.0 ka reconnect NO-OP tha, `connect()` state guard ki wajah se; naye client pe channel auto-resubscribe + activity-timer keep-alive workaround)
- [x] Test: 2 devices sync within 200ms — **PASS (2026-09-27)**: live 2-phone test, backend `punjabi-beats-api.vercel.app` ke through

**Phase 11 Complete?** `[x]` (code ✓ tsc clean + `npm test` sync logic ✓ + **2-device live test PASS**)

---

## 🖥️ PHASE 12: Backend (Vercel)

- [x] `api/publish.js` created (project ROOT `api/` — Vercel root se deploy; SDK v2 `trigger({name,channel,data})` se verified; cluster env-se, data string/object dono accept)
- [x] `package.json` with `@apinator/server` (root, ^2.0.0)
- [x] `vercel.json` (functions config; `api/` auto-route) + `.vercelignore` (mobile/ aur .env* kabhi upload nahi hote)
- [x] Environment variables set — **LIVE-VERIFIED**: `--live` POST valid → 200 `{success:true}` (env missing hota to 500 aata — local test me aaya bhi tha; ref root `.env.example`):
  - [x] `APINATOR_APP_ID` (Vercel pe configured — probe 200 se prove)
  - [x] `APINATOR_KEY` (configured)
  - [x] `APINATOR_SECRET` (sirf server-side — client bundle me kabhi nahi)
- [x] Deploy to Vercel — **LIVE**: `https://punjabi-beats-api.vercel.app` (2026-09-27); URL `mobile/.env` → `EXPO_PUBLIC_PUBLISH_URL` me bhi set (verify kiya; `.env` gitignored)
- [x] Test: POST to `/api/publish` triggers Apinator — `node probe-publish.mjs --live https://punjabi-beats-api.vercel.app` → **3/3 PASS exit 0** (GET 405, POST{} 400, valid → 200 + Apinator trigger). Local handler tests bhi 6/6.
- [x] Verify: Secrets NOT exposed to client (mobile/ me zero `APINATOR_SECRET`/`APINATOR_APP_ID` refs; client me sirf public `EXPO_PUBLIC_APINATOR_KEY`; `.vercelignore` mobile/ exclude karta hai)

**Phase 12 Complete?** `[x]` (10/10 — deploy + env vars + live probe 3/3 PASS; 2-device sync test Phase 15 me)

---

## ✨ PHASE 13: Polish

- [x] Toast notifications (all actions) — root layout `<Toast />` + create/delete/add/share/room actions
- [x] Loading skeletons — Search me 3 shimmer rows (`Animated` loop); baaki jagah LoadingSpinner
- [x] Empty states everywhere — `EmptyState` (home/mood/search/library/playlist/recent/player)
- [x] Error boundaries — `components/ErrorBoundary.tsx` root `_layout` me mounted
- [x] Smooth animations (Reanimated) — MoodCard spring press (v3.10, UI-thread; babel plugin auto)
- [x] Haptic feedback (expo-haptics) — `utils/haptics.ts` (tap/success/warning) — controls, modals, room actions
- [x] Pull to refresh — Home + Mood screens (RefreshControl)
- [ ] No console warnings (runtime device check — intentional `console.warn` error-logs alag hain)
- [x] No TypeScript errors — `npx tsc --noEmit` → 0 (strict mode)
- [x] No ESLint warnings — ESLint setup: `eslint@8.57.1` + `eslint-config-expo` (`.eslintrc.js`, `npm run lint` = `--max-warnings=0`) → 47 files linted, 0 problems (smoke-test se rules active bhi verify kiye)

**Phase 13 Complete?** `[~]` (9/10 — sirf runtime console-warnings device check baaki)

---

## 🚀 PHASE 14: Extra Features (P2)

- [x] Shuffle mode — playerStore `toggleShuffle` + PlayerControls button (FR-2.9)
- [x] Repeat one / repeat all — `cycleRepeat` off→all→one (FR-2.10)
- [x] Volume control — playerStore `setVolume` + full-player inline `VolumeSlider` (`app/player.tsx`, FR-2.11; local-only, sync me kabhi broadcast nahi)
- [x] Recently played screen — `/recent` route + Home header clock icon (last 20, FR-8.1)
- [x] Share song — full-player header share button (RN `Share` API, preview URL ke saath)
- [x] Share playlist — playlist detail header share (top 10 songs + count)
- [x] Presence (online users) — host roster + `member-join`/`member-leave`/`member-list` events + 30s heartbeat + stale-prune (`roomSync`) — FR-5.10
- [x] User names — Room tab naam field (persist `@pb_room_name`, default `Guest-XXXX`) + members list me naam — FR-5.11
- [x] **YouTube matching — link-out (DONE 2026-10-05)** — `songMatch.ts` (pure scoring core) + `youtubeAudio.ts` (orchestration) + `api/youtube-match.js` (live Vercel) + **`utils/youtubeLink.ts` (call site, NEW)**. 67/67 unit + live probe 4 exact/partial + 2 honest fallback. Wired into `SongItem` (▶ YouTube button on preview-only rows) + `player.tsx` ("Full version on YouTube"). Env `EXPO_PUBLIC_YOUTUBE_MATCH_URL` set.
  - ⚠️ **Link-out, NOT in-app WebView player — deliberate decision.** WebView se audio lena evaluate karke reject kiya: (a) `roomSync` ka core invariant tootti — sab devices same URL/position pe chalte hain; ek pe 30s preview + doosre pe full song = position math bekaar, aur phone lock pe WebView mar ke room permanently desync; (b) background play + notification controls chala jaate; (c) `url: ''` rows → `PlaybackError` → auto-skip storm. Playback hamesha TrackPlayer se.

**Phase 14 Complete?** `[x]` (code ✓ tsc clean; 2-device presence live test — backend LIVE hai, ab possible)

---

## 🧪 PHASE 15: Testing

### Manual Testing
- [x] Test on Android phone 1 — **PASS (2026-09-27)**: search/play/player/room sab chala
- [x] Test on Android phone 2 — **PASS (2026-09-27)**: 2-phone sync live verified
- [ ] Test on iPhone (Expo Go)
- [ ] Test on tablet (`ios.supportsTablet: true` set hai; player artwork width-se clamp hota hai)
- [ ] Test on slow network (3G) — 8s axios timeouts + shimmer skeletons ready hain
- [ ] Test offline mode — API fail pe `[]` + empty states + "Try Again" retry UI ready hain
- [ ] Test while app in background — background audio **ENABLED** (feature request 2026-09-30): TrackPlayer native service + `appKilledPlaybackBehavior: ContinuePlayback` + iOS `infoPlist.UIBackgroundModes: ["audio"]` + Android `permissions: [FOREGROUND_SERVICE, FOREGROUND_SERVICE_MEDIA_PLAYBACK, WAKE_LOCK, POST_NOTIFICATIONS]` + lock-screen notification controls (`playbackService.ts` RemotePlay/Pause/Next/Previous/Seek). Phone pe 3 scenarios baaki: home button → bajta rahe, lock screen → bajta rahe, wapas khola → same position se continue
- [ ] Test after force close — AsyncStorage persistence (playlists, recently played, searches, room name)
- [ ] Test with 100+ songs in playlist — FlatList virtualization

### Edge Cases
- [x] Empty search query — `searchSongs` `if (!trimmed) return []`, screen pe `MIN_QUERY_LENGTH = 2`, recent-search me trim-guard
- [x] Special characters in search — axios `params` khud URL-encode karta hai (Diljit/AP Dhillon queries probes se live verify hain)
- [x] Song with no artwork — `SongArtwork` empty-uri pe placeholder icon (musical-note)
- [x] Song with no preview URL — `mapITunesSong` `!previewUrl → null` skip; sync `toSong` bhi preview-less song drop karta hai
- [x] Network timeout — dono search APIs `REQUEST_TIMEOUT_MS = 8000`, publish `PUBLISH_TIMEOUT_MS = 8000`; fail pe fallback/`[]`
- [ ] API rate limit (429) — generic catch + retry UI hai, lekin 429-specific handling/test nahi
- [ ] Apinator disconnect — try/catch + error paths hain, lekin live disconnect/reconnect (NFR-3.3) device test chahiye
- [ ] Room with 10+ users — multi-device runtime test chahiye (host roster me koi hard limit nahi)

**Phase 15 Complete?** `[~]` (5/17 — 5 edge cases code-verified; 9 manual + 3 runtime tests device pe)

---

## 📦 PHASE 16: Build & Deploy

### Android
- [ ] Install EAS CLI: `npm install -g eas-cli` (abhi global install nahi — `npx eas-cli` se bhi chalega)
- [ ] `eas login` (Expo account user ka — yahan se login possible nahi)
- [x] `eas build:configure` → build config **ready** — `mobile/eas.json` hand-written (preview = APK, production = autoIncrement AAB); login ke baad ye command ise verify/regenerate kar legi
- [ ] `eas build --platform android --profile preview` (login ke baad)
- [ ] Download APK (EAS dashboard/CLI se)
- [ ] Install on test device
- [ ] Test all features
- [ ] `eas build --platform android --profile production` (AAB for Play Store)

### iOS
- [ ] Apple Developer account ($99/year — optional; user task)
- [ ] `eas build --platform ios` (login ke baad; EAS cloud pe Mac ki zaroorat nahi)
- [ ] Test via TestFlight
- [ ] Submit to App Store

### Backend
- [x] Vercel deployed — **LIVE**: `https://punjabi-beats-api.vercel.app` (2026-09-27, live probe se verified)
- [x] Environment variables set — 3 critical vars live-verified (`--live` probe → 200); `APINATOR_CLUSTER` optional hai (default `eu` = mobile env se match)
- [ ] Custom domain (optional — abhi `*.vercel.app` subdomain)

**Phase 16 Complete?** `[~]` (3/15 — `eas.json` ready + backend LIVE; baaki sab EAS login + builds + device tasks)

---

## 📚 PHASE 17: Documentation

- [x] `README.md` written — features, structure, setup, quality gates
- [x] Setup instructions — README + `QUICKSTART.md` (mobile + backend dono)
- [x] Environment variables documented — README table + root/mobile `.env.example` (bina values)
- [ ] Screenshots added (phone se screenshots chahiye — user task)
- [x] Features list — README "✨ Features"
- [x] Tech stack documented — README "🛠 Tech stack" table
- [x] Contributing guidelines — `CONTRIBUTING.md`
- [x] License added (MIT) — root `LICENSE`
- [ ] GitHub repo created (account chahiye — user task)
- [x] Local git repo + initial commit (`git init -b main` + add + commit; gitignores se `node_modules/`/`.env` excluded)
- [ ] Code pushed to GitHub (repo create ke baad: `git remote add origin <url> && git push -u origin main`)

**Phase 17 Complete?** `[~]` (8/11 — screenshots/GitHub/push user task)

---

## 🎉 FINAL CHECKLIST

Before releasing:
- [ ] All P0 features working
- [ ] All P1 features working
- [ ] 0 crashes in 1 hour usage
- [x] 0 TypeScript errors — re-verified 2026-09-27 (`npx tsc --noEmit`, strict → 0)
- [x] 0 ESLint warnings — verified (`npm run lint` → 47 files, 0 problems, `--max-warnings=0` enforced)
- [ ] APK size < 50MB
- [ ] App icon designed (abhi `assets/icon.png` = default Expo template — custom design pending)
- [ ] Splash screen designed (abhi `assets/splash.png` = default Expo template)
- [x] App name finalized — "Punjabi Beats" (app.json `name` + `slug: punjabi-beats` + `scheme` consistent)
- [ ] Privacy policy (if publishing)
- [ ] Terms of service (if publishing)
- [ ] Tested on 3+ devices
- [ ] Tested by 3+ users
- [ ] Feedback collected
- [ ] Bugs fixed
- [ ] Final build created
- [ ] Released! 🚀

---

## 📊 Progress Tracker

| Phase | Total | Done | % |
|---|---|---|---|
| Phase 0: Project Setup | 19 | 19 | 100% |
| Phase 1: Data Layer | 35 | 34 | 97% |
| Phase 2: UI Components | 12 | 12 | 100% |
| Phase 3: Home Screen | 11 | 10 | 91% |
| Phase 4: Mood Screen | 7 | 6 | 86% |
| Phase 5: Search Screen | 12 | 12 | 100% |
| Phase 6: Audio Player | 12 | 11 | 92% |
| Phase 7: Mini Player | 9 | 8 | 89% |
| Phase 8: Full Player | 10 | 9 | 90% |
| Phase 9: Playlists | 12 | 12 | 100% |
| Phase 10: Group Room | 10 | 10 | 100% |
| Phase 11: Real-Time Sync | 12 | 12 | 100% |
| Phase 12: Backend (Vercel) | 10 | 10 | 100% |
| Phase 13: Polish | 10 | 9 | 90% |
| Phase 14: Extra Features (P2) | 9 | 9 | 100% |
| Phase 15: Testing | 17 | 7 | 41% |
| Phase 16: Build & Deploy | 15 | 3 | 20% |
| Phase 17: Documentation | 11 | 8 | 73% |
| Phase 18: Liked Songs / Favorites | 22 | 21 | 95% |
| Phase 19: Podcasts (Roadmap 12a) | 20 | 19 | 95% |
| Phase 20: Play Signals (Roadmap 13a) | 14 | 13 | 93% |
| Phase 21: AI Playlist V1 (Roadmap 13b) | 16 | 14 | 88% |
| Phase 22: AI Assistant V1 (Roadmap 13c) | 15 | 14 | 93% |
| Phase 23: Lyrics V1 (Roadmap 7a) | 14 | 13 | 93% |
| Phase 24: Podcast Transcripts V1 (Roadmap 7b) | 16 | 15 | 94% |
| Phase 25: Canonical Share Links V1 (Roadmap 8a) | 17 | 16 | 94% |
| Phase 26: Selected Lyrics Sharing V1 (Roadmap 8b) | 11 | 10 | 91% |
| Phase 27: Copy Link + QR Composer V1 (Roadmap 8c) | 14 | 13 | 93% |
| **TOTAL** | **392** | **349** | **89%** |

> Counts 2026-10-30 ko actual checkbox lines se dobara verify hue — har `## PHASE n` section
> ke andar ke `- [ ]`/`- [x]` boxes gine gaye (SECTION 0/1/2 ke headers, Tracker table,
> Pending summary, Milestones aur FINAL CHECKLIST is count me nahi — wo alag sections
> hain). Phases 18–27 ab tracker me include hain. FINAL CHECKLIST aur Milestones alag
> release-level gates hain.

### ⏳ Abhi kya pending hai (sirf yehi baaki)
- **Device/manual tests** — har phase ke `Test:` boxes + Phase 15 ke 10 box (7 manual + 3 edge cases); **2-phone sync LIVE PASS (2026-09-27)**
- **Phase 13 (1 box)** — runtime console-warnings device check (ESLint setup + 0-warning run ✓ done)
- **Phase 16 (12 box)** — backend 2 box DONE (deploy + env); ab `npx eas-cli login` + builds (user)
- **Phase 17 (3 box)** — screenshots + GitHub repo + push (local git commit ✓ done; remote push commands box me hain)
- **Phases 18–27** — code/automated checks done; manual device/deploy gates remain (Liked, Podcasts, Signals, AI Playlist, AI Assistant, Lyrics, Transcripts, Share Links, Lyrics Sharing, Copy/QR)

---

## 🎯 Milestones

- [x] **M1:** Project runs on phone (Phase 0) — 2 Android phones, Expo Go
- [x] **M2:** Songs load and play (Phase 6) — device pe search + playback verified
- [ ] **M3:** Playlists save (Phase 9) — restart-persistence device run pending
- [x] **M4:** Group room syncs (Phase 11) — 2-phone live sync PASS
- [x] **M5:** Backend deployed (Phase 12) — LIVE `punjabi-beats-api.vercel.app` + probe 3/3
- [ ] **M6:** APK built (Phase 16)
- [ ] **M7:** Released! 🎉

---

## ❤️ PHASE 18: Liked Songs / Favorites

### Storage and State
- [x] Add `@pb_liked_songs` AsyncStorage key
- [x] Add defensive `getLikedSongs()` and `saveLikedSongs()` helpers
- [x] Add `likedSongsStore.ts` with `load`, `isLiked`, `toggleLiked`, `removeLiked`, and `clearLiked`
- [x] Deduplicate liked songs by `song.id`
- [x] Restore liked songs after app restart

### Song Actions
- [x] Add optional liked-state props to `components/SongItem.tsx`
- [x] Add heart button to Home, Search, Mood, Recent, and Playlist song rows
- [x] Add heart button to the full player for the current song
- [x] Keep playlist, queue, YouTube, and room actions unchanged
- [x] Add haptic feedback and accessible labels for like/unlike

### Library and Screen
- [x] Add a `Liked Songs` entry to `app/(tabs)/library.tsx`
- [x] Create `app/liked.tsx`
- [x] Show liked-song count and empty state
- [x] Support individual playback, Play All, and Shuffle
- [x] Support removing songs from the Liked Songs screen
- [x] Preserve MiniPlayer spacing and existing navigation patterns

### Verification
- [x] Add pure logic coverage for toggle/dedupe behavior
- [x] Run `npm test`
- [x] Run `npm run typecheck`
- [x] Run `npm run lint`
- [x] Run `npx expo-doctor`
- [ ] Manually verify save, remove, restart persistence, Play All, and Shuffle

**Phase 18 Complete?** `[~]` (code + automated checks complete; device manual verification remains)

---

## 🎙️ PHASE 19: Podcasts (Production Roadmap 12a)

> Spec `docs/superpowers/specs/2026-10-29-podcasts-design.md` + plan
> `docs/superpowers/plans/2026-10-30-podcasts-plan.md`. FR ids REQUIREMENTS.md
> FR-9 me add hue (original v1 out-of-scope revise hua). Roadmap (production
> checklist) Phase 12 me `[~]` status note bhi hai. Local-only — koi backend.

### Core Pure Logic
- [x] RSS/ATOM parser — `core/podcast/rss.ts` (stack walker, unescape-once leaf reads, malformed item skip, `itunes:duration` H:MM:SS + seconds, CDATA, itunes:image artwork)
- [x] Episode adapters — `core/podcast/episode.ts` (`stableEpisodeId` fnv1a64 reuse, RSS/lookup rows → `PodcastEpisode`, `episodeToSong` full-stream `Song`, previewOnly false)
- [x] Progress policy — `core/podcast/progress.ts` (played = ≥95% ya sticky, duration-0 never played, position clamp, `mergeProgress` previous-metadata rehydrate)
- [x] Stable episode id = audioUrl hash — resume/played keys stable across restarts

### Service and Storage
- [x] iTunes service — `services/podcastService.ts` (`searchShows` / `searchEpisodes` / `getShowById` / `getShowEpisodes` RSS-first + `lookup` entity=podcastEpisode fallback, 10s AbortController)
- [x] Storage keys — `@pb_podcast_shows` (saved shows) + `@pb_podcast_progress` (episodeId → entry, denormalized title/showTitle/artwork/audio) — `services/storage.ts`, guest-compatible
- [x] Flag — `podcasts_enabled` default off + `EXPO_PUBLIC_PODCASTS_ENABLED` opt-in (blend/jam pattern); `.env` + `.env.example`

### State and Playback
- [x] `stores/podcastStore.ts` — search/saved/detail/progress slice, `playEpisode` (existing `playSong` pipeline + `initialPosition` ms resume), `resumeFromProgress`, `selectContinueListening` (latest 5, unplayed)
- [x] `hooks/usePodcastProgress.ts` — 10s throttled position ticks + pause-transition flush + unmount flush; root `_layout.tsx` me global mount (flag off → zero-op)
- [x] Podcast song registry (`isPodcastSongId`) — itunes source songs se distinguish

### Screens
- [x] Library tab Podcasts entry card (Blend/Jam pattern ke saath)
- [x] `/podcast/index` — 350ms debounced search (shows + episodes sections), continue-listening rows, saved shows horizontal
- [x] `/podcast/[id]` — hero (art/title/artist/genre), save/unsave chip with toast + haptic, episode list (EpisodeRow)
- [x] `components/PodcastGate.tsx` (flag-only upsell, login nahi) + `components/EpisodeRow.tsx` (played ✅ / resume % / duration/format)

### Verification
- [x] `test-podcast.mjs` — 11 assertions (RSS/ATOM parse, malformed, duration/date formats, adapter invariants, 95% boundary, sticky/clamp)
- [x] Wired root + mobile `npm test` chains (`test:podcast`)
- [x] `npx tsc --noEmit` — 0 errors (`allowImportingTsExtensions` + explicit `.ts` imports for Node type-stripping)
- [x] `npm run lint` — 0 warnings
- [x] RSS region live probe verified (2026-10-29: search + lookup + RSS enclosure full mp3)
- [ ] Manual device pass — search, play full episode, kill-app resume, 95% played badge, save/unsave (flag `EXPO_PUBLIC_PODCASTS_ENABLED=true`)

**Phase 19 Complete?** `[~]` (code + automated checks complete; manual device pass with `EXPO_PUBLIC_PODCASTS_ENABLED=true` remains — koi server deploy nahi chahiye)

---

## 📊 PHASE 20: Play Signals / Data Foundation (Roadmap 13a)

> Spec `docs/superpowers/specs/2026-10-29-signals-design.md` + plan
> `docs/superpowers/plans/2026-10-30-signals-plan.md`. FR ids REQUIREMENTS.md
> FR-10 me. Invisible plumbing — koi screen change nahi, koi backend nahi.

### Pure Core
- [x] `core/signals/schema.ts` — `SIGNALS_VERSION`, `buildSignal` (fnv1a id), `isSignalName` guard, `normalizeLedger` (version mismatch + partial corruption), `pushSignal` cap 1000 oldest-drop
- [x] `core/signals/skip.ts` — 30s floor / 80% neutral / 95% complete, `classifyPlayback` (remote + !manual exclusion)
- [x] `core/signals/stats.ts` — `applySignal`/`aggregateSignals` raw counters (likes/playlistAdds net clamp), `tasteSongScore` flat weights, `artistStatsFromSignals` (blend TasteArtist parity), `topSongIds` (13b seed)

### Service and Boot
- [x] `services/signalsService.ts` — analytics sink bridge, `@pb_play_signals` + `@pb_taste_stats` keys, persisted history 250ms debounced queue, `loadSignals()` restore, `getTasteStats`/`getRecentSignals` (13b consumers)
- [x] `core/bootstrap.ts` — analytics facade live (`enabled: true` + sink) + ledger restore step (Phase 0 stub ka pehla real wiring)

### Player and Store Wiring
- [x] `playerStore` — play_start emit (remote tagged), outgoing-track classify in `PlaybackActiveTrackChanged`, `manualAdvancePending`/`autoAdvancePending`/`lastSongRemote` flags (failure skip suppressed)
- [x] `searchStore.addRecentSearch` → `search_query` (≥2 chars)
- [x] `likedSongsStore.toggleLiked` → `song_like`/`song_unlike`
- [x] `playlistStore add/remove` → `playlist_add`/`playlist_remove`

### Verification
- [x] `test-signals.mjs` — 9 assertions (schema guard, policy boundaries, remote exclusion, net clamp, weights, cap oldest-drop, version/corruption guards, rebuild determinism)
- [x] Wired root + mobile test chains (`test:signals`)
- [x] `test-player.mjs` playerStore dependency-contract mock update (analytics + skip)
- [x] `npx tsc --noEmit` 0 · `npm run lint` 0 · root `npm test` green
- [ ] Manual: runtime pe signal appends + stats growth check (device run)

**Phase 20 Complete?** `[~]` (code + automated checks complete; device runtime check pending - koi deploy nahi chahiye)

---

## 🏳️ PHASE 21: AI Playlist V1 (Roadmap 13b)

> Spec `docs/superpowers/specs/2026-10-29-ai-playlist-design.md` + plan
> `docs/superpowers/plans/2026-10-30-ai-playlist-plan.md`. FR ids
> REQUIREMENTS.md FR-11 me. 13a taste stats ka pehla consumer.

### Server (Vercel)
- [x] `api/_aiPlaylistCore.js` pure helpers — `buildAiPrompt` (user text quoted-slot isolation), `parseAiResponse` (validate/dedupe/cap 15), 2-window `rateLimitBucket` (10/day + 4/hour per device), `buildGeminiRequest`/`extractGeminiText`
- [x] `api/ai-playlist.js` handler — POST guard, fail-closed `no_key` 400, 429 rate limit + Retry-After, 20s AbortController, `responseMimeType: application/json`, 502 upstream
- [x] `GEMINI_MODEL` override (default `gemini-2.5-flash`)

### Client Core and Service
- [x] `core/ai/playlist.ts` pure — `sanitizeAiTracks`, `normalizeName` (feat/remix/bracket strip), `matchScore` tiers (exact → substring → token overlap), `planMatchedRows`/`dedupePlanRows`/`countPlayable` (`AI_MIN_PLAYABLE = 3`), history merge cap 10
- [x] `services/aiPlaylistService.ts` — `generatePlaylist` (server POST 25s, taste context 13a `compactTaste`, deviceId), `resolveCandidates` (search chain + previewOnly drop), `AiPlaylistError` class + `describeAiPlaylistError` Hinglish strings, history load/append

### Store and Screen
- [x] `stores/aiPlaylistStore.ts` — generate/refine/removeRow/playAll/saveAsPlaylist (playlistStore reuse, name `AI: {prompt}`), quota echo, toast+haptics
- [x] `app/ai-playlist.tsx` — prompt input (max 240), history chips, disclosure strip hamesha, preview rows (matched mark + remove), refine composer, Play All / Save
- [x] `components/AiPlaylistGate.tsx` — `ai_playlist_enabled` flag guard (PodcastGate pattern)
- [x] Library card #4 — `app/(tabs)/library.tsx`
- [x] `@pb_ai_prompts` storage keys (`services/storage.ts`)

### Verification
- [x] `test-ai-playlist.mjs` — 10 assertions (server core: guards/prompt isolation/gemini shapes/parse/rate windows; client core: sanitize/match tiers/plan dedupe/history cap)
- [x] Wired root + mobile test chains (`test:ai`)
- [x] `probe-ai-playlist.mjs` — local handler self-test (405/no_key/400/rate 429/Retry-After) + `--live` mode
- [x] `npx tsc --noEmit` 0 · `npm run lint` 0 · root `npm test` green
- [ ] Manual: `GEMINI_API_KEY` Vercel env me set + `npx vercel` deploy (USER — deploy order rule)
- [ ] Manual: `EXPO_PUBLIC_AI_PLAYLIST_ENABLED=true` mobile/.env + screen se generation pass (device)

**Phase 21 Complete?** `[~]` (code + automated checks complete; Gemini key setup + deploy + device pass remain)

---

## 🏳️ PHASE 22: AI Assistant V1 (Roadmap 13c)

> Spec `docs/superpowers/specs/2026-10-29-ai-assistant-design.md` + plan
> `docs/superpowers/plans/2026-10-30-ai-assistant-plan.md`. FR ids
> REQUIREMENTS.md FR-12 me. Same `GEMINI_API_KEY` reuse — koi naya env nahi.

### Server (Vercel)
- [x] `api/_aiAssistantCore.js` pure — `normalizeAssistantRequest` (turns guard), `buildAssistantPrompt` (intent protocol + turns/taste isolation), `parseAssistantResponse` (per-action args validation, default replies), limiter reuse custom limits
- [x] `api/ai-assistant.js` handler — 405/no_key/bad_request fail-closed, 429 + Retry-After, 20s abort, 502 upstream; limits 20/day + 5/hour
- [x] `api/_aiPlaylistCore.js` limiter generalize (optional limits param — 13b defaults unchanged)

### Client Core and Service
- [x] `core/ai/assistant.ts` pure — `matchLocalQuickCommand` (pause/next/prev OFFLINE), `validateAssistantReply` second guard, `makeTurnWindow` (6), `truncateReply`/`defaultReplyFor`/`describeAction`
- [x] `services/aiAssistantService.ts` — `sendMessage` (quick → shuffle → server flow), `executeAssistantAction` (searchSongs resolve + playerStore/playlistStore local execution), `AiAssistantError` + Hinglish describe; privacy-safe taste (sirf top-5 artist names)

### Store and Screen
- [x] `stores/assistantStore.ts` — messages cap 20 (`@pb_ai_chat`), optimistic user bubble, failed-mark + retryLast, clearChat, quota echo
- [x] `app/ai-assistant.tsx` — chat bubbles + action result cards (tap→play), disclosure strip, quota pill, input bar (max 240), clear confirm
- [x] `components/AiAssistantGate.tsx` — `ai_assistant_enabled` flag guard
- [x] featureFlags — `ai_assistant_enabled` registry + `EXPO_PUBLIC_AI_ASSISTANT_ENABLED` env hook (+ 13b ka miss hota `EXPO_PUBLIC_AI_PLAYLIST_ENABLED` hook ab add — catch)
- [x] Library card #5 — `app/(tabs)/library.tsx` (+ AI chat entry)

### Verification
- [x] `test-ai-assistant.mjs` — 8 assertions (request guards, prompt isolation, per-action parse, custom-limit windows, quick commands, validator, turn window)
- [x] Wired root + mobile test chains (`test:assistant`)
- [x] `probe-ai-assistant.mjs` — local handler self-test (12 checks incl. 6th-hit 429 + Retry-After) + `--live` mode
- [x] `npx tsc --noEmit` 0 · `npm run lint` 0 · root `npm test` green
- [ ] Manual: `npx vercel` deploy (same GEMINI key — koi naya env nahi) + `EXPO_PUBLIC_AI_ASSISTANT_ENABLED=true` mobile/.env + device chat pass

**Phase 22 Complete?** `[~]` (code + automated checks complete; deploy + device pass remain)

---

## 🏳️ PHASE 23: Lyrics V1 (Roadmap 7a)

> Spec `docs/superpowers/specs/2026-10-29-lyrics-design.md` + plan
> `docs/superpowers/plans/2026-10-30-lyrics-plan.md`. FR ids
> REQUIREMENTS.md FR-13 me. LRCLIB free/keyless — backend deploy nahi.

### Core and Cache
- [x] Lyrics types — `LyricsLine`, `LyricsData`, versioned `LyricsCacheEnvelope`, `LyricsErrorCode`
- [x] `core/lyrics/lyrics.ts` pure — standard/multi-timestamp LRC parser, offset handling, sorted lines, `lineAt` boundary lookup, plain fallback helpers
- [x] Pure cache helpers — restore shape/version guard, `cacheGet`/`cachePut`, oldest-drop cap 50
- [x] `services/storage.ts` — `@pb_lyrics` raw read/write (version envelope core-owned)

### Service and UI
- [x] `services/lyricsApi.ts` — cache-first LRCLIB exact artist/title/duration lookup + scored search fallback, title cleanup, 10s abort
- [x] LRCLIB production behavior — `Lrclib-Client` identity header, sequential requests, 429/503 `Retry-After` + jitter backoff
- [x] `components/LyricsGate.tsx` + `EXPO_PUBLIC_LYRICS_ENABLED` bootstrap hook/`.env.example`; flag off default/direct route zero-network
- [x] `app/lyrics.tsx` — synced current-line highlight, scroll-follow latch, tap-line seek, plain approx highlight, differentiated not-found/network retry states
- [x] `app/player.tsx` Lyrics icon only while flag enabled; `_layout.tsx` modal registration + MiniPlayer hidden on lyrics route

### Verification
- [x] `test-lyrics.mjs` — 7 tests (fractions, multi-timestamp, offset/meta/junk/sort, line boundaries, plain fallback, envelope guards, cap 50)
- [x] Wired root + mobile test chains (`test:lyrics`)
- [x] `probe-lyrics.mjs` — deterministic local parser checks + optional keyless `--live https://lrclib.net`
- [x] `npx tsc --noEmit` 0 · `npm run lint` 0 · root `npm test` green
- [ ] Manual: `EXPO_PUBLIC_LYRICS_ENABLED=true` mobile/.env + device synced/plain/not-found + tap-seek pass

> Live smoke 2026-10-30 ko attempt hua: LRCLIB ne `503` + `Retry-After: 1`
> do baar diya. Probe ne required backoff honor kiya; local deterministic checks
> pass hain. Upstream available hone par same `--live` command re-run karna hai.

**Phase 23 Complete?** `[~]` (code + automated checks complete; flag opt-in + device pass remain)

---

## 🏳️ PHASE 24: Podcast Transcripts V1 (Roadmap 7b)

> Spec `docs/superpowers/specs/2026-10-30-podcast-transcripts-design.md` + plan
> `docs/superpowers/plans/2026-10-30-podcast-transcripts-plan.md`. FR ids
> REQUIREMENTS.md FR-14 me. Publisher files only; no backend/key/AI upload.

### RSS, Types, and Pure Core
- [x] Transcript refs/types — MIME union, episode refs, common segments/transcript, source-bound position envelope
- [x] RSS discovery — official/default + alternate Podcast Namespace prefixes, HTTPS/type guards, dedupe, max 10 refs
- [x] Episode adapters — RSS refs preserve; iTunes and progress-rebuilt episodes honest empty refs
- [x] `core/podcast/transcript.ts` — VTT/SRT/JSON/HTML/plain parsers, 5,000-segment cap, safe text-only HTML handling
- [x] Pure helpers — format priority, timestamp parser, JSON word coalescing, segment boundary, text/speaker search, version/source/cap-50 positions

### Service and State
- [x] `podcastTranscriptService.ts` — 10s HTTPS fetch, 2 MiB Content-Length/body guard, MIME parser dispatch, one-entry memory cache, honest errors
- [x] `@pb_transcript_positions` storage — versioned raw read/write; full transcript body never persisted
- [x] `transcriptStore.ts` — stale-request token, open/retry/close/search, play-or-seek jump, 750ms position persistence, toast+haptics

### UI
- [x] `EpisodeRow` sibling transcript action (no nested Pressable), visible only for RSS episode refs
- [x] Podcast detail transcript entry → static `/podcast/transcript` route
- [x] Transcript screen — virtualized rows, search/hit count, timed current highlight + follow latch, untimed non-seek rows, saved-position restore, MiniPlayer padding

### Verification
- [x] `test-podcast.mjs` extended to 12 tests (namespace refs/MIME alias/dedupe/adapter preservation)
- [x] `test-transcript.mjs` — 12 tests (five formats, guards/caps, search, boundaries, source-bound positions)
- [x] Root + mobile chains wired (`test:transcript`) + `probe-transcript.mjs` local fixtures and official live VTT pass (2026-10-30)
- [x] `npx tsc --noEmit` 0 · `npm run lint` 0 · root `npm test` green (13 suites)
- [ ] Manual: `EXPO_PUBLIC_PODCASTS_ENABLED=true`; RSS show transcript icon + timed follow/search/jump + plain fallback + position restore on device

**Phase 24 Complete?** `[~]` (code + automated checks complete; RSS-backed device pass remains)

---

## 🏳️ PHASE 25: Canonical Share Links V1 (Roadmap 8a)

> Spec `docs/superpowers/specs/2026-10-30-share-links-design.md` + plan
> `docs/superpowers/plans/2026-10-30-share-links-plan.md`. FR ids
> REQUIREMENTS.md FR-15 me. Stateless HMAC; no share DB/new dependency.

### Server Core and Endpoint
- [x] `_shareCore.js` five-kind strict schemas — caps/code/HTTPS guards, private-field drop, canonical payload
- [x] HMAC v1 token — 30-day expiry, max 8 KiB, signature length + timingSafeEqual, tamper/future/expiry guards
- [x] Safe preview HTML — escaped metadata, OG/Twitter/canonical, app-scheme button, CSP/nosniff/no-referrer
- [x] `api/share.js` POST create + GET JSON/HTML resolve + OPTIONS CORS, fixed `SHARE_PUBLIC_BASE_URL`
- [x] Fail-closed env/client-token guard, 30/hour + 100/day limiter/Retry-After, `vercel.json` budget, root `.env.example`

### Client Core, Service, and Landing
- [x] `core/share/share.ts` — safe builders, second payload guard, response-origin/path guard, typed action allowlist, legacy fallback parity
- [x] `shareService.ts` — create/resolve, device ID + existing publish-token barrier, native sheet, signed failure → legacy fallback
- [x] `shareStore.ts` — stale token guard, bounded catalog resolution, track play, partial playlist import/play, typed navigation target
- [x] `SocialShareGate` + `/share` card screen — expiry disclosure, five kinds, loading/error/retry, direct flag-off zero resolve
- [x] `EXPO_PUBLIC_SOCIAL_SHARE_ENABLED` bootstrap/`.env.example`; API base documented

### Existing Share Integrations
- [x] Player track + playlist detail upgraded to wrappers; flag-off text output preserved
- [x] Group room + Blend + Jam upgraded; raw code/app-scheme fallback preserved

### Verification
- [x] `test-share.mjs` — 13 tests (five schemas, HMAC/tamper/expiry, HTML/CSP, limiter, parity/actions/origin guard)
- [x] Root + mobile chains wired (`test:share`) — total 14 suites
- [x] `probe-share.mjs` local handler checks — CORS/env/auth/schema/create/JSON/HTML/tamper/expiry/429 all pass
- [x] `npx tsc --noEmit` 0 · `npm run lint` 0 · root `npm test` green
- [ ] Manual/deploy: Vercel `SHARE_SIGNING_SECRET` + `SHARE_PUBLIC_BASE_URL`, deploy, enable mobile flag/API base, five-kind two-device/WhatsApp/tamper/offline-fallback pass

**Phase 25 Complete?** `[~]` (code + automated checks complete; env deploy + cross-device preview pass remain)

---

## 🏳️ PHASE 26: Selected Lyrics Sharing V1 (Roadmap 8b)

> Spec `docs/superpowers/specs/2026-10-30-lyrics-sharing-design.md` + plan
> `docs/superpowers/plans/2026-10-30-lyrics-sharing-plan.md`. FR ids
> REQUIREMENTS.md FR-16 me. Existing Phase 8a endpoint/env reuse.

### Core and Share Schema
- [x] Lyrics pure selection — contiguous range max 4, line 160/combined 280 Unicode code-point caps, synced/plain excerpt timestamp semantics
- [x] Server `_shareCore.js` sixth `lyrics` kind — strict reject/private drop, optional timestamp 0, HTTPS cover, escaped OG excerpt
- [x] Client share core — lyrics builder/second guard/fallback attribution/typed play action; old five-kind v1 parity preserved
- [x] Share service/store — `shareLyrics`, signed text, track resolver reuse, play then optional seek (0 valid), lyrics-specific feedback

### Lyrics and Landing UI
- [x] `/lyrics` long-press selection mode — anchor/range, previous follow restore, song-change clear, invalid-range warning, selected+active styles
- [x] Header Cancel/count/Share controls with busy guard; plain selection works without false line seek
- [x] `/share` lyrics quote card — optional cover, individual lines, attribution/timestamp, Play Track action

### Verification
- [x] `test-lyrics.mjs` extended to 11 tests (range/bounds/code-point caps/synced zero/plain null)
- [x] `test-share.mjs` extended to 15 tests + `probe-share.mjs` lyrics JSON/escaped HTML checks
- [x] tsc 0 · lint 0 · root 14-suite chain/probe green; no new dependency/env/token version
- [ ] Manual/deploy: server-first redeploy, enable lyrics+social flags, synced/plain selection + 5th-line/281-char + recipient seek + API-off fallback pass

**Phase 26 Complete?** `[~]` (code + automated checks complete; server-first deploy + two-device UX pass remain)

---

## 🏳️ PHASE 27: Copy Link + QR Composer V1 (Roadmap 8c)

> Spec `docs/superpowers/specs/2026-10-30-share-copy-qr-design.md` + plan
> `docs/superpowers/plans/2026-10-30-share-copy-qr-plan.md`. FR ids
> REQUIREMENTS.md FR-17 me. Existing Phase 8a endpoint/env reuse.

### Dependencies and Compatibility
- [x] SDK 51 dependencies via Expo CLI — `expo-clipboard ~6.0.3`, `react-native-svg 15.2.0`, `react-native-qrcode-svg`
- [x] RN 0.74 Metro text-encoding transformer configured; no native directory edits

### Core, Service, and State
- [x] Pure helpers — canonical URL guard, QR 2400-char cap, private-safe fingerprint, six-kind signed messages
- [x] Low-level share service split from cycle-free facade; flag-off exact immediate legacy behavior preserved
- [x] Composer store — stale guard, max-10 expiry-aware memory cache, create/retry/native/copy/QR/error actions

### UI and Integrations
- [x] Reusable `ShareQrModal` — QR 220/ecl L/quiet zone, copy/close, renderer error isolation, no file/gallery access
- [x] Global `ShareComposerSheet` — Native Share/Copy/QR, loading/error/retry/expiry, accessibility actions
- [x] `/share` recipient landing Copy Link + QR derived from strict API base/token
- [x] Track/playlist/room/Blend/Jam/lyrics wrappers migrated through facade; six screens remain thin

### Verification
- [x] `test-share.mjs` extended to 17 tests (URL/fingerprint/signed-message/QR boundaries + prior security parity)
- [x] `npx expo install --check` clean + `npx expo-doctor` 17/17
- [x] Temporary web export succeeds with QR Metro transformer (1,390 modules bundled)
- [x] tsc 0 · lint 0 · root 14-suite chain/probe green; audit reviewed without forced SDK-breaking fixes
- [ ] Manual: flag-off immediate share; flag-on six composers; Android/iOS/Web copy; second-device QR scan; API-off fallback; long-URL QR guard

**Phase 27 Complete?** `[~]` (code + automated/Metro gates complete; cross-platform composer device pass remains)

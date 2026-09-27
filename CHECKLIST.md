# ✅ Punjabi Beats — Development Checklist

> **Legend:** `[ ]` = Pending · `[x]` = Done · `[~]` = In Progress · `[!]` = Blocked

---

## 📦 PHASE 0: Project Setup

- [x] Create Expo project: `npx create-expo-app mobile --template expo-template-blank-typescript@sdk-51`
- [x] Project `mobile/` folder me ready (SDK 51: expo ~51.0.28, RN 0.74.5)
- [x] Install Expo Router: `npx expo install expo-router react-native-safe-area-context react-native-screens expo-linking expo-constants expo-status-bar`
- [x] Install audio: `npx expo install expo-av`
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
- [ ] Test: App runs on Expo Go via QR scan (user device test — `cd mobile && npx expo start`)

**Phase 0 Complete?** `[~]`

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
- [x] iTunes primary integration (`country=IN`, entity=song)
- [x] Optional JioSaavn mirror (env-based, fail-safe)
- [x] Response mapping (iTunes flat → Song)
- [x] Error handling with fallback
- [x] Test: `searchSongs('Diljit')` returns songs — live probe-verified (`probe-apis.mjs`: Diljit/AP Dhillon/Karan Aujla → 30 songs each)

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
- [ ] Test: Connection established (device — 2-phone test, Phase 10/11 ke saath)

### Zustand Stores
- [x] `playerStore.ts` — currentSong, queue, index, isPlaying, position (+ shuffle/repeat/volume)
- [x] `playlistStore.ts` — playlists, add, remove, create, delete
- [x] `roomStore.ts` — roomCode, isHost, members, connectionStatus (+ naam FR-5.11)
- [ ] Test: State updates correctly (pure logic `npm test` → 65 assertions PASS; zustand store transitions + device run pending)

**Phase 1 Complete?** `[x]` (code ✓ tsc clean; device tests baaki)

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

- [x] `playerStore.ts` implemented (expo-av module-level Sound, strict TS; **2026-09-27 double-play fix**: generation token + serialized load queue + `disposePlayer` cleanup — sim test `test-loadqueue.mjs` 3/3 PASS)
- [x] `playSong(song, queue)` action (+ `initialPosition`/`startPaused`/`remote` options)
- [x] `togglePlay()` action (+ idempotent `play`/`pause` for sync)
- [x] `playNext()` action (shuffle/repeat logic FR-2.9/2.10 ke saath)
- [x] `playPrev()` action
- [x] `seek(position)` action (+ roomSync throttle)
- [x] Audio.Sound setup — `configureAudio()` (silent-mode iOS, duck Android)
- [x] Load sound on song change
- [x] Unload old sound — `unloadAsync()` (load se pehle)
- [x] Progress tracking (every 500ms) — `progressUpdateIntervalMillis: 500`
- [x] Auto-next on finish — `didJustFinish` → `playNext()` (+ audio-error pe skip)
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
- [ ] Test: Create room, share code, join from 2nd device (2 physical devices chahiye — manual)

**Phase 10 Complete?** `[x]` (code ✓ tsc clean; 2-device manual test baaki)

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
- [x] Auto-reconnect (SDK built-in: 6 attempts, 1s→30s cap, reconnect pe channel auto-resubscribe)
- [ ] Test: 2 devices sync within 200ms (manual — Phase 12 deploy + 2 phones chahiye)

**Phase 11 Complete?** `[x]` (code ✓ tsc clean + `npm test` sync logic ✓; 2-device latency test — backend LIVE, phones chahiye)

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
- [x] Volume control — playerStore `setVolume` + full-player VolumeSlider (FR-2.11; local-only, sync me kabhi broadcast nahi)
- [x] Recently played screen — `/recent` route + Home header clock icon (last 20, FR-8.1)
- [x] Share song — full-player header share button (RN `Share` API, preview URL ke saath)
- [x] Share playlist — playlist detail header share (top 10 songs + count)
- [x] Presence (online users) — host roster + `member-join`/`member-leave`/`member-list` events + 30s heartbeat + stale-prune (`roomSync`) — FR-5.10
- [x] User names — Room tab naam field (persist `@pb_room_name`, default `Guest-XXXX`) + members list me naam — FR-5.11

**Phase 14 Complete?** `[x]` (code ✓ tsc clean; 2-device presence live test — backend LIVE hai, ab possible)

---

## 🧪 PHASE 15: Testing

### Manual Testing
- [ ] Test on Android phone 1 (device chahiye — `cd mobile && npx expo start` + QR)
- [ ] Test on Android phone 2 (2-phone sync test — **Phase 12 deploy ke turant baad**)
- [ ] Test on iPhone (Expo Go)
- [ ] Test on tablet (`ios.supportsTablet: true` set hai; player artwork width-se clamp hota hai)
- [ ] Test on slow network (3G) — 8s axios timeouts + shimmer skeletons ready hain
- [ ] Test offline mode — API fail pe `[]` + empty states + "Try Again" retry UI ready hain
- [ ] Test while app in background — background audio **jaan-boojh kar off** (REQUIREMENTS me koi FR/NFR nahi): `staysActiveInBackground: false` + app.json me `UIBackgroundModes` nahi. Foreground/background transition test karo; agar playback chahiye to dono jagah enable karna hoga
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
| Phase 0: Project Setup | 19 | 18 | 95% |
| Phase 1: Data Layer | 28 | 25 | 89% |
| Phase 2: UI Components | 12 | 12 | 100% |
| Phase 3: Home Screen | 11 | 10 | 91% |
| Phase 4: Mood Screen | 7 | 6 | 86% |
| Phase 5: Search Screen | 12 | 12 | 100% |
| Phase 6: Audio Player | 12 | 11 | 92% |
| Phase 7: Mini Player | 9 | 8 | 89% |
| Phase 8: Full Player | 10 | 9 | 90% |
| Phase 9: Playlists | 12 | 12 | 100% |
| Phase 10: Group Room | 10 | 9 | 90% |
| Phase 11: Real-Time Sync | 12 | 11 | 92% |
| Phase 12: Backend (Vercel) | 10 | 10 | 100% |
| Phase 13: Polish | 10 | 9 | 90% |
| Phase 14: Extra Features (P2) | 8 | 8 | 100% |
| Phase 15: Testing | 17 | 5 | 29% |
| Phase 16: Build & Deploy | 15 | 3 | 20% |
| Phase 17: Documentation | 11 | 8 | 73% |
| **TOTAL** | **225** | **186** | **83%** |

> Counts 2026-09-27 ko actual checkbox lines se auto-verify hue (indented sub-boxes
> jaise Phase 12 ke env vars bhi count me). `Test:` / device / account wale boxes
> isi liye pending hain — code + `npm test` (65 assertions) + tsc + lint already green hain.

### ⏳ Abhi kya pending hai (sirf yehi baaki)
- **Device/manual tests** — har phase ke `Test:` boxes + Phase 15 ke 12 box (9 manual + 3 runtime); **backend LIVE hai — 2-phone sync test ab possible hai**
- **Phase 13 (1 box)** — runtime console-warnings device check (ESLint setup + 0-warning run ✓ done)
- **Phase 16 (12 box)** — backend 2 box DONE (deploy + env); ab `npx eas-cli login` + builds (user)
- **Phase 17 (3 box)** — screenshots + GitHub repo + push (local git commit ✓ done; remote push commands box me hain)
- **Phase 0 (1 box)** — Expo Go QR-scan smoke test

---

## 🎯 Milestones

- [ ] **M1:** Project runs on phone (Phase 0)
- [ ] **M2:** Songs load and play (Phase 6)
- [ ] **M3:** Playlists save (Phase 9)
- [ ] **M4:** Group room syncs (Phase 11)
- [x] **M5:** Backend deployed (Phase 12) — LIVE `punjabi-beats-api.vercel.app` + probe 3/3
- [ ] **M6:** APK built (Phase 16)
- [ ] **M7:** Released! 🎉

# Punjabi Beats — Redesign + Multi-Source + Group Listening (2026-11)

Is build me teen bade kaam hue: **UI redesign ("Dhol Sunset" theme)**, **multi-source
music jo HAMESHA in-app bajti hai**, aur **group listening jo ab zero setup me
chalta hai**. Neeche har change ka detail hai.

## −1. Update (2026-11-02, shaam) — 7 naye features: queue/timer/radio/recos/reactions/moderation/downloads

**Playback + queue (Phase 5 completion):**
- **Dedicated Queue screen** (`app/queue.tsx`) — player ke "Queue me N songs"
  link se khulti hai. Upcoming list: tap = jump, ↑↓ = reorder, ✕ = remove,
  broom = clear-all, neeche **Save as playlist** (playlistStore reuse + name
  validation). PlayerStore me 4 naye actions (`playSongNext`, `removeFromQueue`,
  `moveInQueue`, `clearUpcoming`) — zustand state + TrackPlayer queue dono
  sync (pure ops `core/queue/ops.ts`, 15 naye tests).
- **Sleep timer** (`core/playback/sleepTimer.ts` + `stores/sleepTimerStore.ts`)
  — player utility row me 🌙 sheet: 15/30/45/60 min ya "Is gaane ke baad"
  (end-of-track grace 700ms). Room me host/follow ke waqt pause skip hota hai
  (room sync playback ka owner hai). 12 tests.
- **Song Radio** (`core/catalogue/radio.ts` + `services/radioService.ts`) —
  player me 📻 button: seed artist ke same-artist songs se 25-track queue
  (word-subset matching — "Diljit Dosanjh" ↔ "Diljit Dosanjh feat. X" match,
  "AP Dhillon" nahi). Seed pehle bajta hai. 4 tests.

**Recommendations (Phase 13 v1):**
- **Made for You ✨** — Home da pehla section: signals ledger (play/complete/
  like/skip counters) se weighted artist ranking (`core/recommendations/rank.ts`,
  6 tests) → top 2 positive artists → round-robin fetch → recently played +
  current queue exclude. <5 signals ho to section chhup jata hai (koi fake
  personalization nahi).

**Chat moderation (Phase 9/2 slice):**
- **Message reactions** — 5 emojis (👍❤️😂🔥😮), toggle semantics (dobara tap
  = remove), idempotent merge (`core/chat/reactions.ts`), roomSync
  `chat-reaction` event, echo-safe. 10 tests.
- **Block + Report** — ChatBubble long-press → custom action sheet (RN Alert
  Android 3-button limit ki wajah se): react / block / unblock / report.
  Blocklist local AsyncStorage + incoming messages filter; reports local
  queue + best-effort Supabase push (`core/moderation/moderation.ts` +
  `services/moderationService.ts`). Naya migration
  **`004_moderation_account.sql`**: `reports` + `user_blocks` tables (RLS
  self-only) + `request_account_deletion()` RPC. 8 tests.

**Downloads v1 (Phase 6, flag-gated `downloads_enabled`):**
- **Download manager** — `core/downloads/stateMachine.ts` (pure reducer:
  queued/downloading/downloaded/failed/retry, 9 tests) +
  `services/downloadsService.ts` (expo-file-system `pb-downloads/` dir,
  zustand store, AsyncStorage persist).
- **Offline playback** — `playerStore.resolveTrack` ab downloads ko FIRST
  check karta hai (`getDownloadedUrl` sync): downloaded gaana network
  resolve ke bina local file se bajta hai. Preview-only tracks download
  nahi hote (honest — 30s clip download bekaar).
- **Downloads screen** (`app/downloads.tsx`) — library se entry (flag off to
  hidden): play/delete/retry/clear-all + storage usage. v1 note: progress
  coarse (0→50→100), pause/resume v2 me resumable API ke saath.

**Auth completion (Phase 1 slices):**
- `signOutEverywhere()` (Supabase global scope — sab devices ke refresh
  tokens revoke) + `deleteAccount()` (004 RPC: PII anonymize + global
  signout) — profile screen pe "Log out of all devices" + "Delete account"
  (confirm dialog ke saath), authStore wrapped.

**Verify:** tsc clean, eslint 0 warnings, **156 node:test + 191 logic + 67
youtube-match + loadqueue — sab green** (logic suite 124 → 191, 67 naye
checks).

## 0. Update (2026-11-02) — ONLY full songs + ALL new songs

**"Only play full song":**
- **Full-only policy** (`services/musicApi.ts`): search, trending aur new feeds
  ab 30s previews (iTunes) results se **filter kar dete hain** jab full songs
  available hain — user ko sirf full songs dikhti hain. Zero-full edge case me
  previews last resort rehte hain (honest "30s" badge + play-time full-upgrade
  try). `EXPO_PUBLIC_FULL_ONLY=0` se purana behavior.
- **Player enforcement** (`stores/playerStore.ts`): native TrackPlayer queue ab
  full tracks ko **prefer** karta hai — jab queue me ek bhi full track hai,
  30s clip us queue me nahi jaata (na current, na auto-advance). Single preview
  tap abhi bhi bajta hai (dead air se better) — badge honest rehta hai.
- **Wrong-song audio bug fix**: per-song upgrade + `resolveFullAudioStream` ka
  loose fallback ("title match fail to koi bhi JioSaavn full song laga do")
  hataya — ab **strict title match**. Galat gaane ka audio bajana 30s preview
  se bhi bura hai.
- **Upgrade timeout 2.5s → 7s**: pehle slow network pe resolution ka wait na
  hote hi 30s pe kaat dete the; ab full-stream resolution ka poora wait hota
  hai (dead-mirror cache slow path skip karata hai).
- Live smoke test: `searchSongs("Karan Aujla")` → 15 songs, **0 true previews**
  (200 iTunes previews filtered); `resolveFullAudioStream` ne fake 30s clip ko
  real 257s Audius full stream me upgrade kiya.

**"All new song":**
- **Naya `getNewSongs()`** — latest releases teen sources se (sab parallel):
  1. JioSaavn `latest punjabi songs <year>` + `new punjabi songs <year>`
     (probe: sach me 2026 releases — Karan Aujla "Ashke", Sidhu "Kaali Hoodie",
     Satinder Sartaaj "Guzarish"; CDN stale hone pe audio guard khud filter)
  2. YouTube Music `latest punjabi songs <year>` (Piped) — live smoke test me
     10 current Punjabi drops mile (IYKYK, Rap Killa, Hood Boy…)
  3. Audius `tracks/trending?time=week` — hamesha-live fallback (probe: release
     dates Oct-2026, full durations)
- **Home tab** ab **SectionList** hai: "New Songs 🆕" section (12 songs) +
  "Trending Now 🔥" — har section apna queue banata hai (New pe tap → New
  queue, auto-next section ke andar). Pull-to-refresh dono refresh karta hai.
- `Song.year` field add hua (JioSaavn metadata) — freshness ke liye.
- 5 naye regression tests (full-only drop, last-resort previews, getNewSongs
  merge order, player full-preference, lone-preview still plays).

**Spotify source ("spotipy api", 2026-11-02):**
- **Naya `services/spotifyApi.ts`** — Spotify Web API client-credentials token
  (cached ~1h, 401 pe auto-retry) + track search + `/browse/new-releases`
  (launch-day official albums, market IN). `spotipy` Python library isi Web
  API ka wrapper hai — RN app me Python nahi chalta, isliye direct axios.
- **Full-only rule bana rehta hai**: Spotify full audio NAHI deta (Premium
  OAuth SDK ke bina) — Spotify songs **metadata-only** hain (unresolved,
  YT Music jaisa treatment) aur play-time pe `resolveFullAudioStream` se
  JioSaavn/Audius **full stream** resolve hote hain. Upgrade hone par badge
  audio ka source dikhata hai (Spotify → JioSaavn remap).
- **Search**: Spotify results merge order me full sources ke baad, 30s previews
  se pehle aate hain (official metadata accurate hai); true-preview filter se
  exempt (unresolved ≠ 30s clip).
- **New Songs feed**: Spotify new-releases ab 4th source hai (JioSaavn →
  Spotify → YT Music → Audius).
- **UI**: Spotify badge (green `#1DB954`) + search me "Spotify" filter chip.
- **Optional by design**: `EXPO_PUBLIC_SPOTIFY_CLIENT_ID`/`_SECRET` (ya secure
  `EXPO_PUBLIC_SPOTIFY_TOKEN_URL` proxy) blank → source khud skip, koi crash/
  latency nahi. Production me token proxy recommended (secret client bundle me
  visible hota hai).
- Tests: Spotify catalogue merge + full-only exemption, token cache (1 request
  for 2 searches), no-creds skip, getNewSongs launch-day merge, player
  spotify→full-stream resolution (19 player + 17 music-api assertions).

**Payments OUT OF SCOPE — app free-forever (2026-11-02, user decision):**
- App te **sab kuch free hai — kabhi payments, subscriptions, entitlements ya
  billing nahi aayega**. Plan ka Phase 14 permanently out of scope mark ho
  gaya (ROADMAP.md).
- Code saaf kiya: `premium_enabled` flag registry se hata diya,
  `EXPO_PUBLIC_PREMIUM_ENABLED` `.env.example` se hata, test sweep update.
  Koi entitlement/billing code repo me tha hi nahi — docs te flag hi the.
- Build order ab: auth completion → queue screen + reactions →
  privacy/block/report → downloads → push → recommendations →
  events/integrations. In-app ticketing vi kabhi nahi (external redirect).

**17-phase plan → repo mapping + Phase 0 gaps closed (2026-11-02):**
- **Naya `ROADMAP.md`** — bahar ka 17-phase architecture plan (Auth → Catalogue
  → … → Widgets) is repo ke actual files/migrations/APIs pe map kiya. Result:
  Phase 8 (share), 10 (Blend) ✅ already shipped; 0/1/3/4/5/6/7/9/11/12/13 🟡
  partial; 2/15/16/17 ⬜, 14 ❌ out of scope (free-forever). Federated
  catalogue design (live sources, no local tracks table) deliberate divergence
  document kiya. Adapted build order:
  auth completion → queue screen + reactions → privacy/block/report →
  downloads → push → recommendations → events/integrations.
- **Flags poore kiye**: `downloads_enabled`, `events_enabled` ab env se bhi
  map hote hain (`EXPO_PUBLIC_DOWNLOADS_ENABLED` etc.) — registry ke saare
  env-controllable flags documented; `.env.example` me saari keys add.
- **Error pipeline live**: `ErrorBoundary` ab `reportError()` ko feed karta
  hai; dev builds me console reporter (bootstrap), production reporter remote
  SDK ke liye hook ready.
- Tests: 18 naye Phase 0 checks (flag env mapping sweep, error-reporting
  pipeline: null no-op / context delivery / throwing-reporter isolation) —
  logic suite 107 → 125, sab green (156 node:test + 125 logic + 67 ytm +
  loadqueue).

## 1. UI Redesign — "Dhol Sunset"

- **New identity** (`mobile/constants/colors.ts`): deep midnight base
  (`#08080F`) + sunset gradient (`#FF512F` → `#DD2476`) primary. Har screen jo
  `colors` use karti hai automatically naye look me aa gayi.
- **Home**: hero card ab gradient hai (expo-linear-gradient), white CTA button,
  glow shadow. Popular artists rings naye primary tone me.
- **Player**: warm gradient glow background (top se fade), aur **source badge**
  ("YT Music • Full song" / "JioSaavn • Full song" / "Audius • 30s preview" type)
  jo batata hai kaun sa source baj raha hai.
- **MiniPlayer**: pink-tinted border + primary glow.
- **SongItem**: har song pe **colored source badge** (JioSaavn green / YT Music
  red / Audius purple / iTunes pink / Gaana orange / Jamendo blue) + honest
  "30s" chip preview-only tracks pe.
- **Search**: **source filter chips** (All / JioSaavn / YT Music / Audius /
  iTunes) — ek tap me kisi ek source ke results; count bhi chip pe dikhta hai.
- **Room**: green "Live sync ready" card (transport naam ke saath) jab sync
  default pe chal raha ho; warning card sirf tab jab sach me transport na ho.
- Legacy hardcoded amber colors sab screens/components se clean kiye.

## 2. Multi-source playback — music HAMESHA in-app

**Policy fix (sabse zaroori bug):** pehle jab YouTube Music track ka stream
resolve nahi hota tha, app `Linking.openURL` se **YouTube app khol deti thi** —
music app se bahar chali jaati thi. Ab:

- `stores/playerStore.ts` — external open + alert **hila diya gaya**. Stream na
  mile to queue ke agle playable track pe auto-skip hota hai. Test bhi update
  (`test-player.mjs`) jo ab enforce karta hai ki `opened`/`alerts` empty rahen.
- `services/musicApi.ts` — `playVeromeSongWithRefresh` ka YouTube link-out bhi
  hataya (in-app only, throw + skip).
- **YouTube Music in-app resolution hardening**:
  - `getPipedAudioUrl` ab 5 default public Piped instances + env instance ko
    **parallel race** karta hai (pehla live jeeta; pehle sequential 6×8s tak
    latk sakta tha). webm/opus streams filter (RN TrackPlayer m4a/mp3 hi
    reliably bajata hai).
  - `searchYouTubeMusicSongs` ab **do paths** se catalogue laata hai: apna
    backend (`EXPO_PUBLIC_YOUTUBE_MATCH_URL`) ya seedha Piped
    `filter=music_songs` search — bina kisi backend deploy ke YT Music search.
  - Agar koi bhi Piped instance live na ho: YT Music track in-app **iTunes
    preview** pe fall back karta hai. Kabhi external app nahi.
- **Source attribution bug fix**: Audius aur Jamendo mappers `source` field set
  nahi kar rahe the — ab badges + source filter dono sources ke liye kaam karte
  hain.
- **Live probe results (2026-11)**: Audius search 200 + stream 302 (FULL songs,
  `audio/mpeg` 200 verified), iTunes 200. Public Piped instances is network se
  dead hain (5/5) — isliye Piped optional bridge hai; apna live instance
  `EXPO_PUBLIC_PIPED_API` me do to YT Music full streams milte hain.

## 3. Group listening — zero-setup kaam karta hai

- **Naya `services/groupTransport.ts`** — ek transport layer, do backends:
  1. **Supabase Realtime broadcast (DEFAULT)** — public publishable key bundled
     hai; **na Vercel deploy chahiye, na Apinator account**. Client-to-client
     `channel.send`, `self: false`.
  2. **Apinator + `/api/publish`** — jab `EXPO_PUBLIC_APINATOR_KEY` set ho
     (purana setup, as-is preserved).
- `roomSync.ts` ka poora orchestration (echo guard, sequence numbers, presence,
  chat, queue-add, late-joiner resync) backend-agnostic hai — ab transport
  functions `groupTransport` se aate hain.
- **LIVE VERIFIED**: do independent clients ne same room channel join kiya,
  B ne `song-change` broadcast kiya, A ne receive kiya
  (`scripts/probe-supabase-room-live.mjs`) — roundtrip ✅.
- `.env.example` update: Apinator ab optional; publish URL sirf Apinator mode
  ke liye.

## 4. Docs

- `README.md`, `QUICKSTART.md`, `AGENTS.md`, `mobile/.env.example` — naye
  architecture ke hisaab se.

## 5. Quality gates (sab green)

- `npx tsc --noEmit` — 0 errors (strict)
- `npm run lint` — 0 warnings
- `npm test` — 14 suites, 0 fail (2026-11-02 update ke baad: 151 node:test + 107 logic + 67 youtube-match + loadqueue scenarios — sab pass)
- Live probes: Audius full-song playback ✅ · Supabase room roundtrip ✅ · full-only search ✅ · getNewSongs ✅

## Kaise chalayein

```bash
cd mobile
npm install
cp .env.example .env      # defaults kaafi hain — group rooms bina setup chalenge
npx expo start            # Expo Go me QR scan
```

Group room test: do phones pe app kholo → Room tab → ek pe Create Room, doosre
pe 6-digit code → dono pe same song same position pe chalega. Optional YouTube
Music full streams ke liye `EXPO_PUBLIC_PIPED_API` me live Piped instance do.

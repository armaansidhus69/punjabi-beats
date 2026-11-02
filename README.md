# 🎵 Punjabi Beats

Punjabi music app — **Expo React Native** (mobile), **zero-setup group rooms**
(Supabase Realtime broadcast) + optional Apinator/Vercel transport. Search Punjabi
songs across multiple sources (JioSaavn / YouTube Music bridge / Audius / iTunes /
Jamendo / Gaana), make playlists, and — the fun part — **group rooms jahan sabke
devices pe ek hi song sync chalta hai**.

> Full development status: [`mobile/docs/CHECKLIST.md`](./mobile/docs/CHECKLIST.md) · Deep-dive setup: [`QUICKSTART.md`](./QUICKSTART.md) · Spec: [`mobile/docs/REQUIREMENTS.md`](./mobile/docs/REQUIREMENTS.md)

## ✨ Features

- **"Dhol Sunset" UI (2026-11 redesign)** — midnight base + sunset gradient
  identity, gradient hero card, source-colored badges har song pe, chip-based
  multi-source picker search me, glowing mini player, aur cleaner room screen
- **Multi-source playback — hamesha IN-APP** — JioSaavn (320kbps full) → Audius
  (full) → YouTube Music bridge (Piped search + streams, optional live instance)
  → iTunes preview fallback; **kabhi bhi YouTube/external app nahi khulta** —
  stream na mile to player queue ke agle playable track pe skip karta hai;
  source filter chips (All / JioSaavn / YT Music / Audius / Spotify / iTunes) search me
- **Spotify catalogue (optional source, 2026-11)** — official metadata + launch-day
  new releases. Spotify full audio NAHI deta — Spotify songs play-time pe
  JioSaavn/Audius se full stream resolve hote hain (full-only policy bana rehta
  hai). Credentials blank → source khud skip
- **Full songs ONLY (2026-11)** — search/trending/new feeds 30s previews filter
  kar dete hain jab full songs available hain; player bhi native queue me
  full tracks ko prefer karta hai (30s clip kabhi full track ki jagah nahi
  bajta); strict title-match upgrade — galat gaane ka audio kabhi nahi lagta
- **New Songs feed (2026-11)** — home pe "New Songs 🆕" section: latest
  releases JioSaavn `latest punjabi songs <year>` queries → YouTube Music →
  Audius trending week se, har open pe fresh
- **Group rooms with ZERO setup** — transport ab dual hai
  (`mobile/services/groupTransport.ts`): default **Supabase Realtime broadcast**
  (public key bundled — na Vercel deploy, na Apinator account chahiye) ya
  **Apinator + /api/publish** (jab `EXPO_PUBLIC_APINATOR_KEY` set ho). Room tab
  live transport + connection status dikhata hai
- **Search** — open-source JioSaavn stream (Punjabi + Hindi) → Audius → optional
  Reverbio-style YouTube/Piped bridge → iTunes fallback;
  larger searches page through the catalogue and keep full-song priority;
  **full-song priority** — artist expansion + per-song upgrade se 30s preview bhi full
  me upgrade hota hai; debounced, recent-search chips, empty/no-results states
- **Moods** — 8 mood cards (Romantic, Sad, Party, …) → curated query se gaane
- **Player** — full-screen modal player: seek bar, shuffle, repeat one/all,
  **volume slider**, rotating album art, swipe-down-to-close, auto-next
- **Mini player** — har screen pe persistent, tap se full player
- **Playlists** — create/delete/rename-free simple library, add-to-playlist sheet,
  duplicate check, AsyncStorage persist, **share playlist**
- **Group room** — 6-digit code se room banao/jao; host + members list (**presence**),
  display **names**, connection status, **playback sync** (song/play/pause/seek) real-time,
  room chat + queue add (koi bhi member)
- **Recently played** — last 20 history screen
- **Polish** — dark theme, toasts, haptics, empty/error states, Reanimated press animations

## 📸 Screenshots

(Screenshots add karne hain — phone se capture honge)

## 🛠 Tech stack

| Layer | Stack |
|---|---|
| Mobile | Expo SDK 51 · React Native 0.74 · TypeScript (strict) · Expo Router |
| State | Zustand 5 (player/playlist/room/search stores) |
| Audio | react-native-track-player@4.1.2 (native service + notification controls) |
| Realtime | `services/groupTransport.ts`: Supabase Realtime broadcast (default, zero-setup) ya `@apinator/client` (WebSocket channels) |
| Backend | Vercel serverless `api/publish.js` + `@apinator/server` (HTTP trigger) |
| Data | Open-source JioSaavn API + Audius (free, no key) + iTunes previews · AsyncStorage |

## 📂 Project structure

```
├── api/publish.js          # OPTIONAL Vercel function — Apinator trigger (server-side secret)
├── mobile/                 # Expo app
│   ├── app/                # routes: (tabs)/, player, mood/, playlist/, room/, recent
│   ├── components/         # SongItem, MiniPlayer, PlayerControls, MoodCard, …
│   ├── stores/             # Zustand: player, playlist, room, search
│   ├── services/           # musicApi, apinator, roomSync, storage
│   ├── utils/              # syncPayload (wire format), haptics, format
│   └── constants/          # colors, typography, spacing, moods, layout
├── mobile/docs/            # CHECKLIST (live status), REQUIREMENTS, PLAN, PROMPT
├── vercel.json             # backend deploy config
└── probe-*.mjs             # headless API/self-test scripts (node)
```

## 🚀 Setup

### Prerequisites
- Node 18+ · npm · Expo Go app on your phone (ya Android Studio/Xcode emulator)
- Free [Apinator](https://apinator.io) account (realtime) — optional for local UI dev

### 1) Mobile app

```bash
cd mobile
npm install
cp .env.example .env     # phir .env me values bharo (keys wahi hain)
npx expo start           # QR scan karo — Expo Go me app chalegi
```

`mobile/.env` keys (values kabhi code me commit mat karo):

| Key | Kyun chahiye |
|---|---|
| `EXPO_PUBLIC_APINATOR_KEY` | socket key (public) |
| `EXPO_PUBLIC_PUBLISH_URL` | `https://YOUR-APP.vercel.app/api/publish` (Phase 12 deploy ke baad) |
| `EXPO_PUBLIC_ITUNES_COUNTRY` | optional, default `IN` |
| `EXPO_PUBLIC_JIOSAAVN_BASE` | optional self-hosted JioSaavn API override (default: `https://saavn.sumit.co`) |
| `EXPO_PUBLIC_PIPED_API` | optional live Piped API for YouTube bridge audio resolution |
| `EXPO_PUBLIC_SPOTIFY_CLIENT_ID` / `_SECRET` | optional Spotify Web API source (search + new releases; blank = skip) |
| `EXPO_PUBLIC_SPOTIFY_TOKEN_URL` | optional secure token proxy for production (secret server-side rakho) |
| `EXPO_PUBLIC_FULL_ONLY` | `0` = purana behavior (30s previews bhi list me); default full-songs-only |

### 2) Backend (Vercel) — room sync broadcast ke liye

```bash
# root pe (mobile/ nahi):
npx vercel               # login + deploy
# Vercel dashboard → Settings → Environment Variables:
#   APINATOR_APP_ID, APINATOR_KEY, APINATOR_SECRET (+ optional APINATOR_CLUSTER)
# phir deploy ka URL mobile/.env → EXPO_PUBLIC_PUBLISH_URL me daal ke re-deploy
```

Server keys + hygiene notes: [`.env.example`](./.env.example) (sirf server pe —
`.vercelignore` `mobile/` ko upload hi nahi karta). Verify:

```bash
node probe-publish.mjs                              # local handler self-test (6 checks)
node probe-publish.mjs --live https://YOUR-APP.vercel.app   # deployed endpoint check
```

## ✅ Quality gates

```bash
cd mobile && npx tsc --noEmit   # 0 TypeScript errors (strict mode)
node probe-publish.mjs          # backend handler test
```

Manual/device tests ke liye phase-wise list: [`mobile/docs/CHECKLIST.md`](./mobile/docs/CHECKLIST.md).

## 📚 Development Docs

- [`mobile/docs/CHECKLIST.md`](./mobile/docs/CHECKLIST.md) — 18-phase live status (tick counts)
- [`mobile/docs/REQUIREMENTS.md`](./mobile/docs/REQUIREMENTS.md) — FR/NFR spec (feature ids)
- [`mobile/docs/PLAN.md`](./mobile/docs/PLAN.md) — architecture + phase plan
- [`mobile/docs/PROMPT.md`](./mobile/docs/PROMPT.md) — original build prompt / UI-UX spec

## 🤝 Contributing

Dekho [`CONTRIBUTING.md`](./CONTRIBUTING.md) — short version: branch banao,
`tsc` clean rakho, CHECKLIST tick karo, **secrets kabhi commit mat karo**.

## 📄 License

[MIT](./LICENSE) — free to use, modify, share.

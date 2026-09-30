# 🎵 Punjabi Beats

Punjabi music app — **Expo React Native** (mobile) + **Vercel serverless** (room-sync
broadcast backend). Search Punjabi songs, make playlists, and — the fun part —
**group rooms jahan sabke devices pe ek hi song sync chalta hai** (Apinator realtime).

> Full development status: [`docs/CHECKLIST.md`](./docs/CHECKLIST.md) · Deep-dive setup: [`QUICKSTART.md`](./QUICKSTART.md) · Spec: [`docs/REQUIREMENTS.md`](./docs/REQUIREMENTS.md)

## ✨ Features

- **Search** — multi-source chain (JioSaavn mirrors → Audius → iTunes) se Punjabi songs;
  **full-song priority** — artist expansion + per-song upgrade se 30s preview bhi full
  me upgrade hota hai; debounced, recent-search chips, empty/no-results states
- **Moods** — 8 mood cards (Romantic, Sad, Party, …) → curated query se gaane
- **Player** — full-screen modal player: seek bar, shuffle, repeat one/all,
  **volume slider**, rotating album art, swipe-down-to-close, auto-next
- **Mini player** — har screen pe persistent, tap se full player
- **Playlists** — create/delete/rename-free simple library, add-to-playlist sheet,
  duplicate check, AsyncStorage persist, **share playlist**
- **Group room** — 6-digit code se room banao/jao; host + members list (**presence**),
  display **names**, connection status, **playback sync** (song/play/pause/seek) real-time
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
| Realtime | `@apinator/client` (WebSocket channels) |
| Backend | Vercel serverless `api/publish.js` + `@apinator/server` (HTTP trigger) |
| Data | iTunes Search API + Audius (free, no key) · AsyncStorage |

## 📂 Project structure

```
├── api/publish.js          # Vercel function — Apinator trigger (server-side secret)
├── mobile/                 # Expo app
│   ├── app/                # routes: (tabs)/, player, mood/, playlist/, room/, recent
│   ├── components/         # SongItem, MiniPlayer, PlayerControls, MoodCard, …
│   ├── stores/             # Zustand: player, playlist, room, search
│   ├── services/           # musicApi, apinator, roomSync, storage
│   ├── utils/              # syncPayload (wire format), haptics, format
│   └── constants/          # colors, typography, spacing, moods, layout
├── docs/                   # CHECKLIST (live status), REQUIREMENTS, PLAN, PROMPT
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
| `EXPO_PUBLIC_JIOSAAVN_BASE` | optional mirror (dead mirrors ke liye fallback) |

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

Manual/device tests ke liye phase-wise list: [`docs/CHECKLIST.md`](./docs/CHECKLIST.md).

## 📚 Development Docs

- [`docs/CHECKLIST.md`](./docs/CHECKLIST.md) — 18-phase live status (tick counts)
- [`docs/REQUIREMENTS.md`](./docs/REQUIREMENTS.md) — FR/NFR spec (feature ids)
- [`docs/PLAN.md`](./docs/PLAN.md) — architecture + phase plan
- [`docs/PROMPT.md`](./docs/PROMPT.md) — original build prompt / UI-UX spec

## 🤝 Contributing

Dekho [`CONTRIBUTING.md`](./CONTRIBUTING.md) — short version: branch banao,
`tsc` clean rakho, CHECKLIST tick karo, **secrets kabhi commit mat karo**.

## 📄 License

[MIT](./LICENSE) — free to use, modify, share.

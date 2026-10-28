# PROMPT: Punjabi Beats Mobile App Builder

## ROLE
You are a senior React Native + Expo developer. Build a complete, production-ready 
Punjabi Music Streaming mobile app called "Punjabi Beats".

## TECH STACK (STRICT - No substitutions)
- Framework: React Native (v0.74+) with Expo SDK 51+
- Language: TypeScript
- Navigation: Expo Router (file-based, v3+)
- State: Zustand (lightweight, no Redux)
- Storage: AsyncStorage + expo-secure-store
- Audio: react-native-track-player@4.1.2 (native service + notification controls)
- Real-time: Apinator (@apinator/client v2.0.0)
- HTTP: Axios
- UI: React Native Paper + custom components
- Icons: @expo/vector-icons (Ionicons)
- Animations: react-native-reanimated v3

## APIs (All FREE, no key required)
1. Music Search (PRIMARY): open-source JioSaavn API
   - Endpoint: `https://saavn.sumit.co/api/search/songs?query={q}&page={page}&limit=40`
   - Full Punjabi + Hindi streams, with pagination for larger result lists.
   - Self-host the MIT-licensed API and set `EXPO_PUBLIC_JIOSAAVN_BASE` for production.
   - Audius and iTunes IN-store remain fallback sources.
   - Optional Reverbio-style YouTube/Piped bridge: set `EXPO_PUBLIC_YOUTUBE_MATCH_URL`
     for metadata search and `EXPO_PUBLIC_PIPED_API` for audio resolution.
2. Real-time Sync: Apinator (WebSocket + HTTP trigger)
3. Backend: Vercel Serverless (api/publish.js)

## APP STRUCTURE (Expo Router)
app/
├── _layout.tsx              # Root layout + providers
├── (tabs)/
│   ├── _layout.tsx          # Bottom tab navigator
│   ├── index.tsx            # Home (moods + trending)
│   ├── search.tsx           # Search screen
│   ├── library.tsx          # Playlists
│   └── room.tsx             # Group Room
├── player.tsx               # Full-screen player modal
├── mood/[id].tsx            # Mood-based playlist
├── playlist/[id].tsx        # Playlist detail
└── room/[code].tsx          # Active room
components/
├── SongItem.tsx             # Song list row
├── MiniPlayer.tsx           # Bottom mini player
├── MoodCard.tsx             # Mood grid card
├── PlayerControls.tsx       # Play/pause/next/prev
└── ProgressBar.tsx          # Seek bar
stores/
├── playerStore.ts           # Current song, queue, isPlaying
├── playlistStore.ts         # User playlists
└── roomStore.ts             # Group room state
services/
├── musicApi.ts              # JioSaavn + iTunes
├── apinator.ts              # Real-time client
└── storage.ts               # AsyncStorage wrapper
types/
└── index.ts                 # Song, Playlist, Room types

## FEATURES TO BUILD (Priority Order)

### P0 - MUST HAVE (Week 1)
1. Home screen with 8 mood cards (Romantic, Sad, Bhangra, Party, Folk, Sufi, Old, Trending)
2. Trending Punjabi songs list (auto-fetch on launch)
3. Search screen with real-time results
4. Audio player: play, pause, next, previous, seek
5. Mini player (persistent at bottom)
6. Full-screen player with album art + controls
7. Personal playlists (create, add song, delete)
8. Persistent storage (AsyncStorage)

### P1 - SHOULD HAVE (Week 2)
9. Group Room: create room with 6-digit code
10. Group Room: join with code
11. Real-time sync: song change, play/pause, seek
12. Room indicator (host vs joined)
13. Leave room functionality
14. Toast notifications (react-native-toast-message)

### P2 - NICE TO HAVE (Week 3)
15. Shuffle + Repeat modes
16. Volume control
17. Recently played (last 20)
18. Share song (React Native Share API)
19. Presence: show online users in room
20. User names when joining room

## CRITICAL IMPLEMENTATION NOTES

### 1. Audio Player (react-native-track-player)
```typescript
import TrackPlayer from 'react-native-track-player';
await TrackPlayer.setupPlayer();
await TrackPlayer.add({ id: song.id, url: song.preview, title: song.title, artist: song.artist });
await TrackPlayer.play();
// MUST call TrackPlayer.reset() before loading a new queue (double-play guard)
```

### 2. Apinator SDK Import (ESM only)
```typescript
import { Apinator } from '@apinator/client';
// NO .min.js build exists — use ESM import
const client = new Apinator({ appKey: 'apk_xxx', cluster: 'eu' });
client.connect();
const channel = client.subscribe('room-' + code);
channel.bind('song-change', (data) => {
  // IMPORTANT: SDK auto-parses JSON. Do NOT JSON.parse again.
  const msg = typeof data === 'string' ? JSON.parse(data) : data;
});
```

### 3. Music API Response Mapping
```typescript
// iTunes Search API returns flat results
const song: Song = {
  id: String(r.trackId),
  title: r.trackName,
  artist: r.artistName || 'Unknown',
  // 100x100 artwork ko upgrade karo
  cover: r.artworkUrl100?.replace('100x100bb', '600x600bb') ?? '',
  // 30-second preview — null wale songs skip karo
  preview: r.previewUrl,
  duration: r.trackTimeMillis ?? 30000,
};
```

### 4. Playlist Storage Schema
```typescript
type Playlist = { id: string; name: string; songs: Song[]; createdAt: number };
// Key: '@pb_playlists'
// Value: JSON.stringify(Playlist[])
```

### 5. Error Handling (MANDATORY)
- Open-source JioSaavn primary — Audius and iTunes IN-store fallback se
- Apinator disconnect → auto-reconnect
- No internet → show cached songs + offline toast
- Audio load fail → skip to next song

## UI/UX REQUIREMENTS

### Colors (Dark Theme)
- Background: `#0a0a0f`
- Surface: `#12121a`
- Card: `#1f1f2e`
- Primary: `#ffb347` (orange)
- Text: `#ffffff`
- Subtext: `#888888`
- Border: `#2a2a40`

### Typography
- Headings: System font, 700 weight
- Body: System font, 400 weight
- Sizes: 28 (h1), 18 (h2), 14 (body), 12 (caption)

### Screens Layout
- Bottom tabs: Home, Search, Library, Room (4 tabs)
- Mini player: fixed above tab bar (60px height)
- Full player: modal, swipe down to close
- Cards: rounded 15px, hover scale 1.03
- Song row: 45px artwork + title + artist + actions

## DELIVERABLES
1. Complete Expo project (all files)
2. `app.json` with proper config
3. `package.json` with exact versions
4. `eas.json` for building APK
5. README with setup steps
6. All TypeScript types defined
7. No `any` types (use proper interfaces)
8. Comments on complex logic

## DO NOT
- ❌ Use class components (use functional + hooks)
- ❌ Use Redux (use Zustand)
- ❌ Hardcode secrets (use .env + expo-constants)
- ❌ Use expo-av (removed from Expo SDK 52+; use react-native-track-player)
- ❌ Skip error boundaries
- ❌ Ignore TypeScript errors

## SUCCESS CRITERIA
- App launches without crashes
- Search returns Punjabi songs
- Audio plays with 320kbps
- Playlists persist after app restart
- Group room syncs within 200ms
- Works on Android 8+ and iOS 13+
- APK size under 50MB

## START BY
1. Run: `npx create-expo-app punjabi-beats --template blank-typescript`
2. Install all dependencies
3. Set up Expo Router
4. Build in the order of P0 → P1 → P2
5. Test each feature before moving on

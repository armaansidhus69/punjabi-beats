# 📋 Punjabi Beats — Development Plan

## Project Overview
| Field | Value |
|---|---|
| **App Name** | Punjabi Beats |
| **Type** | Mobile App (Android + iOS) |
| **Framework** | React Native + Expo SDK 51 |
| **Language** | TypeScript |
| **Duration** | 3 weeks (part-time) |
| **Team Size** | 1 developer |
| **Cost** | ₹0 (100% free stack) |

---

## 🎯 Goals

### Primary Goal
Ek complete Punjabi music streaming app jo dost alag-alag shehron se bhi **same song** sun saken.

### Success Metrics
- ✅ App crashes without errors
- ✅ 5000+ Punjabi songs searchable
- ✅ Group room sync under 200ms
- ✅ Playlists persist forever
- ✅ APK under 50MB
- ✅ Works on Android 8+ and iOS 13+

---

## 📅 Week-by-Week Plan

### 🗓️ WEEK 1: Foundation + Core Player

| Day | Task | Deliverable |
|---|---|---|
| **Day 1** | Project setup | Expo project running on phone |
| | • `npx create-expo-app` | |
| | • Install deps (zustand, axios, react-native-track-player, etc.) | |
| | • Setup Expo Router | |
| | • Setup dark theme constants | |
| **Day 2** | Music API integration | Songs load ho rahe hain |
| | • iTunes API wrapper (IN store, probe-verified queries) |
| | • iTunes fallback | |
| | • Song type definition | |
| | • Test with "Diljit" | |
| **Day 3** | Home screen | Mood cards + trending list |
| | • 8 mood cards grid | |
| | • Trending songs list | |
| | • SongItem component | |
| | • Loading states | |
| **Day 4** | Audio player | Songs play ho rahe hain |
| | • react-native-track-player setup | |
| | • playerStore (Zustand) | |
| | • Play/pause/next/prev | |
| | • Progress bar + seek | |
| **Day 5** | Mini player + Full player | Complete player UI |
| | • MiniPlayer component | |
| | • Full-screen modal player | |
| | • Album art rotation | |
| | • Swipe to close | |
| **Day 6** | Search screen | Real-time search |
| | • Search input | |
| | • Debounced API call | |
| | • Results list | |
| | • Recent searches | |
| **Day 7** | Playlists (basic) | Create + add songs |
| | • playlistStore | |
| | • AsyncStorage wrapper | |
| | • Create playlist modal | |
| | • Add-to-playlist sheet | |

**Week 1 Milestone:** App plays Punjabi songs, search works, playlists save ho rahi hain. ✅

---

### 🗓️ WEEK 2: Group Room + Polish

| Day | Task | Deliverable |
|---|---|---|
| **Day 8** | Apinator setup | Real-time connection working |
| | • Apinator client init | |
| | • Subscribe to channel | |
| | • Test event flow | |
| **Day 9** | Backend serverless | Publish API working |
| | • `/api/publish.js` on Vercel | |
| | • Environment variables | |
| | • Test trigger from app | |
| **Day 10** | Group Room UI | Create + Join room |
| | • Room tab screen | |
| | • Create room (6-digit code) | |
| | • Join room input | |
| | • Room code display | |
| **Day 11** | Real-time sync | Songs sync across devices |
| | • Song change broadcast | |
| | • Play/pause broadcast | |
| | • Seek broadcast | |
| | • Handle incoming events | |
| **Day 12** | Room polish | Room experience smooth |
| | • Room indicator (host/joined) | |
| | • Leave room | |
| | • Connection status | |
| | • Toast notifications | |
| **Day 13** | Testing + bug fixes | Stable app |
| | • Test on 2+ devices | |
| | • Fix edge cases | |
| | • Handle network errors | |
| **Day 14** | UI polish | Beautiful app |
| | • Animations (Reanimated) | |
| | • Loading skeletons | |
| | • Empty states | |
| | • Error screens | |

**Week 2 Milestone:** Group room kaam kar raha hai, alag devices pe sync ho raha hai. ✅

---

### 🗓️ WEEK 3: Features + Build

| Day | Task | Deliverable |
|---|---|---|
| **Day 15** | Shuffle + Repeat | Player modes |
| **Day 16** | Recently Played | History screen |
| **Day 17** | Share feature | Share song/playlist |
| **Day 18** | Presence (optional) | Online users list |
| **Day 19** | Testing | All features tested |
| **Day 20** | Build APK | Android APK ready |
| **Day 21** | Build iOS + Release | Both builds ready |

**Week 3 Milestone:** App store-ready! 🎉

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────┐
│           REACT NATIVE APP (Expo)           │
│  ┌───────────────────────────────────────┐  │
│  │  UI Layer (Expo Router + Paper)       │  │
│  ├───────────────────────────────────────┤  │
│  │  State Layer (Zustand Stores)         │  │
│  │  • playerStore  • playlistStore       │  │
│  │  • roomStore                          │  │
│  ├───────────────────────────────────────┤  │
│  │  Service Layer                        │  │
│  │  • musicApi  • apinator  • storage    │  │
│  ├───────────────────────────────────────┤  │
│  │  Native Layer (react-native-track-player, AsyncStorage) │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
         │              │              │
         ▼              ▼              ▼
   ┌─────────┐    ┌──────────┐   ┌──────────┐
   │ iTunes  │    │ Apinator │   │  Vercel  │
   │  API    │    │WebSocket │   │ Function │
   │(free)   │    │ (free)   │   │ (free)   │
   └─────────┘    └──────────┘   └──────────┘
```

---

## 🧰 Dependencies

```json
{
  "dependencies": {
    "expo": "~51.0.0",
    "expo-router": "~3.5.0",
    "react-native-track-player": "^4.1.2",
    "expo-secure-store": "~13.0.0",
    "expo-constants": "~16.0.0",
    "expo-status-bar": "~1.12.0",
    "@apinator/client": "^2.0.0",
    "axios": "^1.7.0",
    "zustand": "^4.5.0",
    "react-native-paper": "^5.12.0",
    "@react-native-async-storage/async-storage": "^1.23.0",
    "react-native-reanimated": "~3.10.0",
    "react-native-gesture-handler": "~2.16.0",
    "react-native-safe-area-context": "^4.10.0",
    "react-native-screens": "^3.31.0",
    "react-native-toast-message": "^2.2.0",
    "@expo/vector-icons": "^14.0.0"
  },
  "devDependencies": {
    "@babel/core": "^7.24.0",
    "@types/react": "~18.2.0",
    "typescript": "~5.3.0"
  }
}
```

---

## 🎯 Risk Management

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Public JioSaavn host unavailable | Medium | High | Self-host the MIT-licensed API with `EXPO_PUBLIC_JIOSAAVN_BASE`; Audius/iTunes remain fallbacks |
| Apinator free tier limit | Low | Medium | Cache events, throttle broadcasts |
| Audio not loading | Low | High | Skip song, log error |
| AsyncStorage full | Low | Medium | Limit playlists to 50 songs each |
| iOS build issues | High | Medium | Test on Expo Go first |
| APK size > 50MB | Medium | Low | Enable Proguard, remove unused assets |

---

## 📦 Deployment Plan

### Development
- **Testing:** Expo Go app (QR scan)
- **Sharing:** Expo dev server

### Production
- **Android:** EAS Build → APK → Upload to Play Store
- **iOS:** EAS Build → IPA → Upload to App Store
- **Backend:** Vercel (already deployed)

### Cost
| Item | Cost |
|---|---|
| Expo (dev) | ₹0 |
| EAS Build (free tier) | ₹0 (30 builds/month) |
| Vercel | ₹0 |
| Apinator | ₹0 |
| JioSaavn API | ₹0 |
| **Total** | **₹0** |

---

## 🎉 Definition of Done

- [ ] All P0 features working
- [ ] All P1 features working
- [ ] 0 TypeScript errors
- [ ] 0 ESLint warnings
- [ ] Tested on 2+ Android devices
- [ ] Tested on 1+ iOS device
- [ ] APK generated and installed
- [ ] README written
- [ ] GitHub repo pushed
- [ ] Vercel deployed

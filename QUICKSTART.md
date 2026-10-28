# ⚡ Punjabi Beats — Quick Start (5 Minutes)

## Prerequisites
- Node.js 18+ installed
- Expo Go app on your phone
- Apinator account (free)

## Step 1: Clone & Setup (2 min)
```bash
npx create-expo-app punjabi-beats --template blank-typescript
cd punjabi-beats
```

## Step 2: Install Deps (2 min)
```bash
npx expo install expo-router expo-secure-store expo-constants
npm install zustand axios @apinator/client@2.0.0 react-native-paper react-native-track-player@4.1.2
```

## Step 3: Configure (1 min)
Create `.env`:
```
EXPO_PUBLIC_APINATOR_KEY=apk_xxxxxxxxxxxxx
EXPO_PUBLIC_APINATOR_CLUSTER=eu
EXPO_PUBLIC_PUBLISH_URL=https://YOUR-VERCEL-APP.vercel.app/api/publish
EXPO_PUBLIC_ITUNES_COUNTRY=IN
# Optional: self-host the open-source JioSaavn API for production reliability.
# EXPO_PUBLIC_JIOSAAVN_BASE=https://your-jiosaavn-api.example.com
# Optional: configure a live Piped API for Reverbio-style YouTube bridge playback.
# EXPO_PUBLIC_PIPED_API=https://your-piped-api.example.com
```
> Music source = open-source JioSaavn API (full Punjabi/Hindi streams), with
> Audius and iTunes fallback. Default host `https://saavn.sumit.co` hai;
> production me reliability ke liye MIT-licensed API ko self-host karke
> `EXPO_PUBLIC_JIOSAAVN_BASE` set kar sakte ho.

## Step 4: Run
```bash
npx expo start
```
Scan QR with Expo Go → App opens! 🎉

## Step 5: Test
1. Search "Diljit" → songs aane chahiye
2. Tap song → play hona chahiye
3. Create playlist → save hona chahiye
4. Create room → code milega

## Done! 🚀
Aage ke features ke liye `mobile/docs/CHECKLIST.md` follow karo.

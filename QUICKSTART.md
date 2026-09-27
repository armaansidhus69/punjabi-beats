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
npx expo install expo-router expo-av expo-secure-store expo-constants
npm install zustand axios @apinator/client@2.0.0 react-native-paper
```

## Step 3: Configure (1 min)
Create `.env`:
```
EXPO_PUBLIC_APINATOR_KEY=apk_xxxxxxxxxxxxx
EXPO_PUBLIC_APINATOR_CLUSTER=eu
EXPO_PUBLIC_PUBLISH_URL=https://YOUR-VERCEL-APP.vercel.app/api/publish
EXPO_PUBLIC_ITUNES_COUNTRY=IN
```
> Music source = iTunes Search API (free, no key). Saare JioSaavn mirrors
> dead hain (2026-09-24 verified) — koi mirror revive ho to
> `EXPO_PUBLIC_JIOSAAVN_BASE` env me set kar dena.

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
Aage ke features ke liye `CHECKLIST.md` follow karo.

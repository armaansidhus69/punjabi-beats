# CLAUDE.md — Punjabi Beats (Full Songs Architecture)

Music streaming & synchronized group listening app: **Expo React Native app** (`mobile/`) + **Vercel serverless backend** (`api/`).

## Quick Commands

Run commands from the designated directory (never mix them up):

```bash
# Quality Gates (must run and pass with 0 errors before committing):
npm test                             # Root: runs all 17 headless test suites
cd mobile && npx tsc --noEmit        # Strict TypeScript typecheck (0 errors)
cd mobile && npm run lint            # ESLint --max-warnings=0

# Development:
cd mobile && npx expo start          # Mobile dev server (Web / iOS / Android)
npx vercel dev                       # Backend local dev server

# Builds & Deployments:
cd mobile && npx expo export --platform web && npx eas-cli deploy --prod --non-interactive  # Deploy web to EAS Hosting
cd mobile && npx eas-cli build --platform android --profile preview                        # Build Android standalone APK
npx vercel --prod                                                                           # Deploy serverless backend
```

## Architecture & Code Guidelines

1. **Two Packages, Two `node_modules`**:
   - Backend & test suites live at root (`package.json`).
   - Mobile app lives in `mobile/` (`mobile/package.json`).
   - When adding dependencies to mobile, ALWAYS run `npx expo install <package>` inside `mobile/`.

2. **Full-Song Audio Playback Pipeline**:
    - Music source fallback chain in `mobile/services/musicApi.ts`:
      `JioSaavn (320kbps full song) → Audius (full song) → YouTube Match / Piped Bridge → metadata-only fallback for full-song upgrade`.
    - **Full-only playback**: metadata-only and preview-only rows are resolved on-demand for the active track; a verified full stream is required before native playback.
   - **Player Screen (`mobile/app/player.tsx`)**:
     - Authentic native music player UI with spinning circular vinyl disc artwork (`SongArtwork`).
     - NO visible video embed boxes or switch buttons.
      - Android / iOS and web use the TrackPlayer-compatible in-app stream path; no external link or embedded YouTube fallback is used.

3. **Performance & Instant Playback Rules**:
    - In `mobile/stores/playerStore.ts`, resolve the **active song** first when tapping play.
    - Do NOT run heavy resolution on the remaining 30-100 queue tracks upfront — direct/full upcoming rows hydrate in bounded background batches, while metadata-only rows wait until activation.
    - `resolveFullAudioStream` has a bounded timeout guard and in-flight/negative caching to prevent repeated slow-network stalls.

4. **Secrets & Environment Separation (Strict)**:
   - Server secret keys (`APINATOR_APP_ID`, `APINATOR_SECRET`, `PUBLISH_CLIENT_TOKEN`) live ONLY in Vercel environment variables.
   - Client values live in `mobile/.env` (prefixed with `EXPO_PUBLIC_*`).
   - NEVER commit `.env` or hardcode tokens.

5. **Headless Test Compatibility**:
   - `mobile/services/storage.ts` MUST be imported via `require('../services/storage')` inside functions (not static top-level `import`) to avoid dragging `@react-native-async-storage/async-storage` into Node test environments.

6. **Coding Conventions**:
   - Strict TypeScript, no `any`.
   - Comments and commit messages match the existing Hinglish / conventional commits style (`feat(scope):`, `fix(scope):`, `docs:`).
   - Every user-facing action has toast + haptic feedback (`utils/haptics.ts`, `react-native-toast-message`).

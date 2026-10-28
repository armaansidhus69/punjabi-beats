# AGENTS.md — Punjabi Beats

Group music listening app: **Expo React Native app** (`mobile/`) + **Vercel serverless backend** (root `api/`). Room-sync via Apinator realtime (WebSocket). Two packages, two `node_modules` — deps install separately.

For Expo/RN specifics, also read [`mobile/AGENTS.md`](./mobile/AGENTS.md) (Expo docs-first rule, `npx expo install`, CNG rules).

## Commands

Tests and backend code live at root; nothing else does. Running things from the wrong directory is the most common mistake.

```bash
# Backend deploys (root, NOT cd mobile):
npx vercel

# Quality gates — run all before declaring done:
cd mobile && npx tsc --noEmit        # strict, must be 0 errors
cd mobile && npm run lint            # eslint --max-warnings=0
npm test                             # root: runs all 5 test suites sequentially

# Single suite (root):
node test-logic.mjs
node test-loadqueue.mjs
node test-youtube-match.mjs
node test-player.mjs
node test-music-api.mjs
```

- Test suites import `mobile/**/*.ts` directly via Node's built-in type stripping — need modern Node (24.x used; see note "Node >= 23.6" in `test-logic.mjs` header). Root `package.json` has `"type": "module"`.
- Tests are deterministic (fixtures, no network). The many `probe-*.mjs` scripts are separate **live** API probes: `node probe-publish.mjs` = local handler self-test; `node probe-publish.mjs --live https://<deploy>` = deployed endpoint check.
- Mobile dev server: `cd mobile && npx expo start` (separate `npm install` inside `mobile/`).

## Secrets & env split (strict)

- Server keys (`APINATOR_APP_ID`, `APINATOR_KEY`, `APINATOR_SECRET`, `PUBLISH_CLIENT_TOKEN`) live **only** in Vercel env vars — never in `mobile/` or client code.
- Client env = `mobile/.env`, only `EXPO_PUBLIC_*` (public values).
- **Deploy order matters**: `PUBLISH_CLIENT_TOKEN` must be set in Vercel *before* deploying — without it every `/api/publish` POST returns 401/500 and room sync breaks instantly (handler is fail-closed). Client must set the same value as `EXPO_PUBLIC_PUBLISH_TOKEN`.
- `mobile/.env` also gates optional providers and Supabase: blank/placeholder values make features skip silently (by design). `EXPO_PUBLIC_AUTH_ENABLED=false` for guest-only builds. `EXPO_PUBLIC_APINATOR_CLUSTER` must match server `APINATOR_CLUSTER` (default `eu`).
- Never remove `.vercelignore` (it keeps `mobile/` out of backend deploys) or `.gitignore`.

## Architecture flow (not obvious from filenames)

- Room sync: client → `POST /api/publish` with `x-publish-token` header (timing-safe compare) → Apinator channel broadcast → `mobile/services/roomSync.ts` on each device. `api/youtube-match.js` is the second function (Spotify→YouTube matching only returns videoId/metadata, never audio URLs).
- Music source fallback chain in `mobile/services/musicApi.ts`: JioSaavn → Audius → optional YouTube/Piped bridge → iTunes. Each source's mapper → common `Song`.
- `mobile/services/storage.ts` is imported via `require()` (not static `import`) on purpose: a static import drags AsyncStorage into the Node test path and breaks headless tests (`ERR_MODULE_NOT_FOUND`).
- Zone boundaries: screens render only; logic goes in `stores/` or `services/`. Wire format for room events is `mobile/utils/syncPayload.ts`.

## Conventions (from CONTRIBUTING.md)

- TypeScript strict, no `any`. Comments are in Hinglish — match the existing tone.
- Every user-facing action gets toast + haptic feedback (reuse `utils/haptics.ts`, `react-native-toast-message`).
- `mobile/docs/CHECKLIST.md` is the live progress record: when completing a feature, tick its box and **recalculate the Progress Tracker totals from actual checkbox counts**. Feature commits reference the FR id from `mobile/docs/REQUIREMENTS.md`.
- Commits follow `feat(scope):` / `fix(scope):` / `docs:` / `chore:` (conventional commits).
- Supabase: migrations in `supabase/migrations/`; only anon/publishable keys go in `mobile/.env`.

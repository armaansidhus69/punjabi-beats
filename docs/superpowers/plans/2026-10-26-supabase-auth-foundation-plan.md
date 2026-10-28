# Supabase Authentication Foundation — Implementation Plan

## 1. Add the client dependencies and configuration

- Install `@supabase/supabase-js` and `react-native-url-polyfill` with the
  Expo-compatible installer.
- Add `EXPO_PUBLIC_SUPABASE_URL` and
  `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to `.env.example`.
- Keep the legacy `EXPO_PUBLIC_SUPABASE_ANON_KEY` name accepted as a temporary
  fallback so existing local setup notes do not break.
- Do not add service-role credentials.

## 2. Implement the Supabase client boundary

- Create `mobile/core/auth/supabaseClient.ts`.
- Polyfill URL handling once.
- Use AsyncStorage for persisted sessions on native and web.
- Enable persistence and token refresh; disable URL session detection for the
  initial password-only flow.
- Return `null`/configured state when public configuration is absent instead of
  throwing during bootstrap.

## 3. Implement auth and profile services

- Create `mobile/core/auth/authService.ts`.
- Define stable app-level auth error codes.
- Wrap sign-up, sign-in, password reset, sign-out, current-session lookup, and
  auth-state subscription.
- Add Google OAuth with web redirect handling and native deep-link completion.
- Add profile read/update helpers using RLS-backed `profiles` rows.
- Add device upsert after a successful account session.
- Keep all direct Supabase calls inside the auth service.

## 4. Reconcile the existing local identity/session layer

- Extend identity mapping for Supabase account users.
- Stop treating manually persisted access/refresh tokens as the source of
  truth.
- Keep guest session creation unchanged when auth is disabled or unconfigured.
- On sign-in/sign-up, save account identity metadata while leaving existing
  playlists, history, likes, and player state untouched.
- On sign-out, restore a guest session without clearing local music data.

## 5. Add guarded auth routes and an auth context/store

- Add an auth store/provider with loading, session, identity, and error state.
- Add `/auth/login`, `/auth/register`, `/auth/forgot-password`, and
  `/auth/profile` screens using current theme primitives.
- Keep routes unlinked while `auth_enabled` is false.
- Provide a small internal route entry point for beta testing without changing
  the default guest navigation.
- Use Expo Router redirects compatible with the current Expo Router version,
  not the newer protected-route API.

## 6. Add the Supabase database migration

- Create `supabase/migrations/001_profiles_devices.sql`.
- Add `profiles` and `devices` tables, updated-at triggers, profile creation
  trigger, RLS, and owner-only policies.
- Use `auth.users` as the identity source and never query Supabase's internal
  auth schema from the app.
- Make the migration idempotent where practical.

## 7. Add deterministic service tests

- Test unconfigured guest-safe behavior without network access.
- Test error-code mapping with mocked Supabase responses.
- Test identity/session transitions without touching real credentials.
- Keep existing playback, queue, music API, and liked-song tests unchanged.

## 8. Verify and document

- Run root tests, typecheck, lint, Expo Doctor, and web bundling.
- Verify that the app still opens as a guest when Supabase variables are absent.
- Verify the web DOM has no nested-button warning.
- Update the production checklist only for work actually verified.
- Report the exact Supabase dashboard setup still required for real sign-in.

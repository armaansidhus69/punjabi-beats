# Punjabi Beats — Supabase Authentication Foundation

## Status

Design approved in chat on October 26, 2026. This document defines the first
Supabase-backed authentication slice before implementation begins.

## Goal

Add a real account boundary to Punjabi Beats without replacing the existing
guest/local experience or changing playback, queue, playlists, search, rooms,
liked songs, or local history.

The first slice establishes a safe Supabase integration and implements the
smallest useful account flow:

- Email/password registration.
- Email/password login.
- Google OAuth login.
- Session restoration.
- Email-verification state handling.
- Logout.
- Password-reset request.
- Basic profile creation/update.
- Guest-to-account transition without deleting local data.

The feature remains behind `auth_enabled`, which is disabled by default.

## Existing constraints

- The app uses Expo SDK 51, React Native, Expo Router, Zustand, AsyncStorage,
  and TrackPlayer.
- The current app starts as a guest and must continue to do so when Supabase is
  not configured or authentication is disabled.
- Existing local storage keys are not yet user-scoped. The first auth slice must
  preserve those records rather than pretending that cloud library sync already
  exists.
- Supabase service-role credentials must never be shipped in the mobile or web
  bundle.
- Existing room publishing tokens and music-provider credentials are separate
  concerns and must not be mixed with Supabase auth.

## Architecture

### Supabase client boundary

Add `mobile/core/auth/supabaseClient.ts` as the only module that constructs the
Supabase client. It reads:

```text
EXPO_PUBLIC_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

Existing local setups may use `EXPO_PUBLIC_SUPABASE_ANON_KEY`; the client keeps
that name as a temporary public-key fallback during the migration.

The client uses a storage adapter compatible with the existing local runtime so
that sessions can be restored on native and web. Auto-refresh and session
persistence are enabled when configuration is present. URL-based OAuth session
detection is not required for this first email/password slice.

If either public variable is missing, the module reports that Supabase is not
configured and the app continues in guest mode. It must not throw during root
bootstrap.

### Auth service boundary

Add `mobile/core/auth/authService.ts`. UI and stores must call this service,
not Supabase APIs directly.

The service exposes:

- `isSupabaseConfigured()`
- `getAuthSession()`
- `getCurrentUser()`
- `subscribeToAuthState(listener)`
- `registerWithPassword(email, password, displayName?)`
- `signInWithPassword(email, password)`
- `requestPasswordReset(email, redirectTo?)`
- `signOut()`
- `getProfile(userId?)`
- `updateProfile(input)`

The service translates Supabase errors into stable app-level errors with a
small error-code set such as `not_configured`, `invalid_credentials`,
`email_not_verified`, `email_in_use`, `weak_password`, `network`, and
`unknown`.

### Session and identity model

Supabase Auth is the source of truth for authenticated sessions. The existing
`AppSession` remains the app-facing session shape, but authenticated sessions
must no longer depend on manually storing access or refresh tokens in the
existing session JSON record.

Session behavior:

1. Root bootstrap initializes the local migration and guest identity first.
2. If auth is disabled or Supabase is not configured, the current guest session
   remains active.
3. If auth is enabled and Supabase has a persisted session, the auth service
   maps it to the existing account identity.
4. Auth state changes update the app identity/session boundary.
5. Logout restores a local guest session and does not erase playlists, history,
   liked songs, or the queue.

The old guest session record is retained as a local compatibility record until
the account transition is complete. A future library-sync phase will add an
explicit ownership and upload migration; this auth slice must not silently
upload or delete local data.

### Profile data

Supabase's managed `auth.users` table owns credentials and provider identities.
The app-owned profile table is:

```sql
profiles
├── id              uuid primary key references auth.users(id)
├── display_name    text
├── username        text unique nullable
├── avatar_url      text nullable
├── country         text nullable
├── status          text not null default 'active'
├── created_at      timestamptz not null default now()
└── updated_at      timestamptz not null default now()
```

A database trigger creates a profile row for newly registered users. Profile
reads and updates are restricted to the signed-in owner through Row Level
Security. Public profile discovery is deliberately deferred to the social
phase.

### Device records

Add a minimal device table for future push notifications and multi-device
visibility:

```sql
devices
├── device_id       text primary key
├── user_id         uuid not null references auth.users(id) on delete cascade
├── device_name     text nullable
├── platform        text not null
├── push_token      text nullable
├── last_active_at  timestamptz not null default now()
├── created_at      timestamptz not null default now()
└── updated_at      timestamptz not null default now()
```

The client may upsert its own device record after authentication. Push-token
registration remains disabled until the notification provider is selected.
Users can only read or update their own device rows.

### Supabase-to-roadmap mapping

Supabase replaces the custom auth endpoints for this phase:

| Roadmap operation | Supabase operation |
|---|---|
| `POST /v1/auth/register` | `auth.signUp` |
| `POST /v1/auth/login` | `auth.signInWithPassword` |
| `POST /v1/auth/refresh` | Supabase client auto-refresh |
| `POST /v1/auth/logout` | `auth.signOut` |
| `GET /v1/me` | `auth.getUser` plus `profiles` query |
| `PATCH /v1/me/profile` | `profiles` update through RLS |

The app must not query Supabase's internal `auth` schema directly. Account
deletion and revoking other sessions require a trusted Edge Function or server
operation and are deferred.

## UI and routing

Add guarded auth routes:

```text
mobile/app/auth/_layout.tsx
mobile/app/auth/login.tsx
mobile/app/auth/register.tsx
mobile/app/auth/forgot-password.tsx
mobile/app/auth/profile.tsx
```

The routes are not linked from the existing guest UI while
`auth_enabled === false`. The initial UI must support:

- Email and password input.
- Registration display name.
- Loading and disabled-submit states.
- User-readable validation errors.
- Email-verification pending state after registration.
- Password-reset request confirmation.
- Logout from profile/settings.

Phone OTP, active-session management, account switching, account deletion, and
social profile discovery are not part of this implementation. Google OAuth is
supported through the configured Supabase provider.

## Bootstrap and failure behavior

Core bootstrap remains best-effort:

- A missing Supabase configuration is a normal guest-mode condition.
- A Supabase network failure must not stop playback or prevent local screens
  from opening.
- Auth listener registration must be idempotent and cleaned up if mounted by a
  React lifecycle owner.
- Supabase auth errors are surfaced only from auth UI or explicit account
  actions; they must not become global fatal errors.

## Security rules

- Only `EXPO_PUBLIC_SUPABASE_URL` and the public anon key may be present in the
  client environment.
- Never add a service-role key to `.env`, source, tests, or logs.
- Enable RLS on `profiles` and `devices`.
- Use owner-based policies for profile and device reads/writes.
- Do not treat local guest IDs or room publish tokens as authenticated user IDs.
- Do not claim that local data is cloud-backed until the library-sync phase is
  implemented.

## Implementation files

Expected files for the first slice:

```text
mobile/core/auth/supabaseClient.ts
mobile/core/auth/authService.ts
mobile/core/auth/identity.ts
mobile/core/auth/sessionManager.ts
mobile/core/bootstrap.ts
mobile/core/featureflags/featureFlags.ts
mobile/stores/authStore.ts
mobile/components/AuthShell.tsx
mobile/app/auth/_layout.tsx
mobile/app/auth/login.tsx
mobile/app/auth/register.tsx
mobile/app/auth/forgot-password.tsx
mobile/app/auth/profile.tsx
mobile/.env.example
mobile/package.json
mobile/package-lock.json
supabase/migrations/001_profiles_devices.sql
```

Existing playback, room, playlist, music API, and liked-song files should not
be changed unless required to connect the auth boundary.

## Validation criteria

### Automated

- Existing root test suite passes unchanged.
- TypeScript passes with strict checking.
- ESLint passes with zero warnings.
- Expo Doctor remains clean.
- Auth service unit tests cover configured, unconfigured, success, and mapped
  error paths.

### Manual smoke checks

1. Start with no Supabase variables: app opens as guest and playback remains
   available.
2. Enable `auth_enabled` with a configured project: login/register routes open.
3. Register a user: profile row is created and verification state is shown.
4. Log in: session survives app restart.
5. Log out: guest mode returns and local playlists/history/liked songs remain.
6. Request password reset: confirmation appears without exposing credentials.
7. Inspect the web build: no service-role key or nested-button warning is
   introduced.

## Non-goals

- No full catalogue migration.
- No cloud playlist/history sync.
- No OAuth provider setup.
- No phone/OTP provider setup.
- No custom auth API server.
- No payments, chat, Blend, downloads, or room authorization changes.
- No rewrite of existing local storage or playback architecture.

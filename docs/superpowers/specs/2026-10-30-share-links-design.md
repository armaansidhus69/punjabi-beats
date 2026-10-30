# Phase 8a — Canonical Share Links V1 (Design)

> Roadmap: `mobile/docs/PRODUCTION_ROADMAP_CHECKLIST.md` → Phase 8 Social
> sharing. Date: 2026-10-30. Approved: **stateless signed Vercel links + Open
> Graph preview** (Approach A). V1 entities: track, playlist, group room,
> Blend, and Jam. Budget ₹0; no share database.

## 1. Purpose

Punjabi Beats ka share action sirf raw text/code na bheje. Recipient ko ek
tamper-proof HTTPS link mile jo messaging/social apps me title/description/image
preview dikhaye, browser fallback de, aur installed app me safe share landing
route khole. Existing local/native shares network failure ya flag-off pe fallback
rahengi.

## 2. Goals / Non-goals

**Goals**
- Signed, versioned, stateless token: server validates metadata then HMAC signs
- Public HTTPS Open Graph/Twitter preview; button opens
  `punjabi-beats://share?token=...`
- Mobile resolve screen validates token payload again before any action
- Track play, playlist import/play, room open, Blend join, Jam join
- Existing native share sheet; old raw-code/text fallback remains reliable
- `social_share_enabled` default false + `EXPO_PUBLIC_SOCIAL_SHARE_ENABLED`
- Server secrets stay Vercel-only; no user IDs, audio URLs, chat, or signals in
  tokens

**Non-goals (later)**
- Album/artist/Wrapped/event links (models/screens not production-ready)
- Selected lyric line sharing (selection/share-card UX is separate Phase 7/8)
- Device-generated image cards, QR/copy-link UI
- Instagram/Facebook platform SDK integrations
- Open/click analytics (would require consent + durable event sink)
- Universal/App Links that open HTTPS directly in app (associated domains and
  production web domain deployment); v1 web page has explicit app-scheme button
- Server-side image-card generation

## 3. Share entity contract

Common token payload (server-owned fields):

```js
{
  v: 1,
  kind: 'track' | 'playlist' | 'room' | 'blend' | 'jam',
  data: { /* strict per-kind shape below */ },
  iat: 1234567890, // epoch seconds
  exp: 1234567890  // iat + 30 days
}
```

Per-kind safe metadata:
- **track**: `{title<=120, artist<=120, cover?: https URL}`
- **playlist**: `{name<=80, totalCount:0..5000, tracks:[{title<=120,
  artist<=120}]}`; descriptors cap 10
- **room**: `{code:/^\d{6}$/, name?:<=80}`
- **blend**: `{code:8 confusion-safe chars, name?:<=80}`
- **jam**: `{code:8 confusion-safe chars, name?:<=80,
  roomType?:'jam'|'party'}`

All strings trim/control-character strip. No local song/playlist/user IDs,
stream/preview URLs, provider IDs, emails, or private room state. Cover URL only
for track preview and must be HTTPS.

## 4. Token core — `api/_shareCore.js`

- `normalizeShareRequest(body, nowSec)` → strict payload or null
- token: `v1.<base64url(canonical-json)>.<base64url(HMAC-SHA256)>`
- `signSharePayload(payload, secret)`
- `verifyShareToken(token, secret, nowSec)`:
  - token max 8 KiB, exactly 3 parts/version v1
  - signature length check + `timingSafeEqual`
  - JSON/schema revalidation, `iat` skew max +5m, not expired
- expiry: 30 days; replay before expiry is intentional sharing behavior
- `sharePreview(payload)` gives escaped title/description/image + entity label
- `renderShareHtml(payload, token, publicUrl)`:
  - all metadata/attributes HTML escaped
  - OG/Twitter/canonical tags
  - strict CSP, `nosniff`, no-referrer
  - plain branded body + explicit “Open Punjabi Beats” scheme link
  - no remote scripts or publisher HTML
- `shareRateLimitBucket(state,key,nowMs)`: 30/hour + 100/day best-effort

## 5. Endpoint — `api/share.js`

`OPTIONS` returns CORS preflight for Expo web (`GET, POST, OPTIONS`;
`content-type` + `x-publish-token`). Other methods get 405.

### POST create

Request: `{kind, data, deviceId}` + existing `x-publish-token` header.

Why reuse `PUBLISH_CLIENT_TOKEN`: it is already the app-client barrier deployed
for room sync, so Phase 8a adds no second fake-public secret. Honest boundary
same hai: client token obfuscation/casual-abuse barrier, real user auth nahi.

Flow:
1. method/env guard: `SHARE_SIGNING_SECRET`, `SHARE_PUBLIC_BASE_URL`,
   `PUBLISH_CLIENT_TOKEN`; missing → fail closed
2. timing-safe client-token compare
3. IP + device key rate limit; 429 + `Retry-After`
4. normalize/sign
5. return `{token, url, expiresAt}` where URL is
   `${SHARE_PUBLIC_BASE_URL}/api/share?token=...`

### GET resolve/preview

- `?token=...&format=json`: verify and return `{payload}` with CORS + private
  no-store (mobile resolver)
- normal GET: verify and return escaped HTML with public cache bounded by token
  expiry (`s-maxage` capped one day)
- invalid/tampered/expired → 400/410 minimal safe HTML or JSON; never reflect raw
  token metadata
- POST body/token length limits before parsing expensive work

`SHARE_PUBLIC_BASE_URL` is fixed env—not Host header—to avoid host-header link
poisoning. `vercel.json` adds 256 MiB / 10s function budget.

## 6. Client pure core — `mobile/core/share/share.ts`

- TypeScript discriminated unions mirroring the five payload kinds
- `buildTrackShare`, `buildPlaylistShare`, `buildRoomShare`,
  `buildBlendShare`, `buildJamShare`: strict trim/caps; no sensitive fields
- `validateResolvedShare(raw, nowSec)` second guard (kind/data/version/expiry)
- `fallbackShareText(entity)` preserves useful old text/code when API is down
- `shareAction(payload)` maps only to allowlisted action:
  - track → resolve by title+artist
  - playlist → resolve descriptors, import/play
  - room → `/room/<6 digits>`
  - blend → `/blend/join?code=<8 chars>`
  - jam → `/jam/join?code=<8 chars>`

Server/client schema parity gets fixture tests to prevent drift.

## 7. Client service/state

### `services/shareService.ts`

- base `EXPO_PUBLIC_API_BASE_URL` (existing public env slot), 15s timeout
- POST `/api/share` with `EXPO_PUBLIC_PUBLISH_TOKEN`, device identity
- `createShareLink(entity)` validates response HTTPS origin/path/token
- `shareEntity(entity)`: flag-enabled API attempt → native `Share.share`; on
  network/no-key/rate error use `fallbackShareText` and still open share sheet;
  toast honestly says link fallback when relevant
- `resolveShareToken(token)`: GET JSON + client second guard
- no token/body logging

### `stores/shareStore.ts`

- landing state: `payload`, `loading`, `error`, `busy`, resolved songs
- request-token stale response guard
- `openToken`, `retry`, `clear`
- `performPrimaryAction`:
  - track: `searchSongs`, drop unusable result, `playerStore.playSong`
  - playlist: resolve up to 10 descriptors (bounded concurrency), preview list;
    primary action saves local playlist then optionally Play All
  - room/Blend/Jam: return typed navigation target; screen performs router call
- every action toast + haptic

## 8. UI and integrations

### Share landing — `app/share.tsx`

- `SocialShareGate` checks `social_share_enabled`; direct disabled route makes
  zero resolve calls
- `useLocalSearchParams<{token?:string}>`; token shape/length guard before store
- card by kind, expiry note, preview descriptors, loading/error/retry
- primary action labels: Play Track / Import Playlist / Open Room / Join Blend /
  Join Jam
- no arbitrary route from payload; only typed `shareAction` target

### Existing share buttons

Upgrade handlers in:
- `app/player.tsx` (track)
- `app/playlist/[id].tsx` (playlist)
- `app/room/[code].tsx` (room)
- `app/blend/[id].tsx` (Blend)
- `app/jam/[id].tsx` (Jam)

When flag off, current legacy `Share.share` behavior remains unchanged. When on,
screens call `shareEntity`; service owns signed-link/fallback handling. This avoids
regressing already-shipped local share actions while new network behavior remains
rollout-gated.

## 9. Error/security handling

- HMAC key only server; client barrier token never presented as real auth
- strict per-kind allowlist + caps both before signing and after resolving
- timing-safe signatures/client-token compare
- HTML escaping/CSP; HTTPS image only; no user-provided outbound action URLs
- token max 8 KiB, POST JSON max 16 KiB
- expired/tampered token cannot route or execute
- rate state best-effort per serverless instance (documented; durable limiter
  later with auth/Redis)
- share API failure never blocks raw text/code native sharing

## 10. Testing

- `test-share.mjs` pure:
  - each kind normalize/invalid caps/codes/private-field drop
  - deterministic sign/verify, tamper, wrong key, expiry/future iat/token cap
  - preview + HTML escaping/CSP/scheme link
  - 2-window limiter boundaries
  - client second guard + action allowlist + fallback text
- `probe-share.mjs`: local handler 405/no-env/unauthorized/bad request/create/
  GET JSON/GET HTML/tamper/429; `--live <base>` guard smoke
- root/mobile chain `test:share` (14 total suites)
- mobile tsc/lint zero

## 11. Delivery and docs

- env deploy order:
  1. Vercel `SHARE_SIGNING_SECRET` + `SHARE_PUBLIC_BASE_URL`; existing
     `PUBLISH_CLIENT_TOKEN` already required
  2. deploy `npx vercel`
  3. mobile `EXPO_PUBLIC_API_BASE_URL`, existing publish token, and
     `EXPO_PUBLIC_SOCIAL_SHARE_ENABLED=true`
- REQUIREMENTS FR-15
- ROADMAP Phase 8 canonical/native/preview/entity rows `[~]`; analytics/cards/
  social SDK/copy/QR remain `[ ]`
- CHECKLIST PHASE 25 + actual tracker recount
- commit:
  `feat(share): Phase 8a — signed canonical links and OG previews (flag off)`

## 12. Manual verification

- Android/iOS native sheet for all five kinds
- WhatsApp/message preview URL opens safe web card
- Open button launches `/share` and typed primary action
- tampered/expired token safe error
- server offline still shares legacy text/code
- flag off: legacy actions work, direct `/share` is gated

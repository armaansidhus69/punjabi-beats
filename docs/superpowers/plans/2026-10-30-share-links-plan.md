# Phase 8a — Canonical Share Links V1 Implementation Plan

Design: `docs/superpowers/specs/2026-10-30-share-links-design.md`

Architecture: stateless HMAC token + one Vercel GET/POST endpoint, mirrored
strict client validator, gated share landing, and backwards-compatible native
share wrappers. No DB/new dependency. Existing `PUBLISH_CLIENT_TOKEN` is reused
only as the documented app-client barrier; `SHARE_SIGNING_SECRET` never leaves
Vercel.

Verified anchors:
- app scheme `punjabi-beats` (`mobile/app.json`)
- API root env slot already exists: `EXPO_PUBLIC_API_BASE_URL`
- device identity: `core/auth/identity.ts#getOrCreateDeviceIdentity`
- existing share handlers: player, playlist detail, room, Blend, Jam
- direct join routes already work: `/room/[code]`, `/blend/join?code=`,
  `/jam/join?code=`
- playlist store: synchronous `createPlaylist`, async `addSongToPlaylist`
- feature registry already has `social_share_enabled` default false; env hook
  missing

## Steps

1. **Server pure core — `api/_shareCore.js`**
   - constants: token v1, max token 8 KiB, request JSON 16 KiB,
     TTL 30 days, rate 30/hour + 100/day
   - safe scalar helpers: control-strip/trim/cap, HTTPS cover, explicit
     confusion-safe 8-char invite alphabet, 6-digit room code
   - `normalizeShareRequest(body, nowSec)` constructs canonical ordered
     `{v,kind,data,iat,exp}`; only five kind fields copied; private/unknown
     fields dropped; playlist descriptors cap 10 / totalCount clamp
   - `validateSharePayload(raw, nowSec, {allowExpired?})` for verify path;
     +5m iat skew, exact exp/iat bounds
   - `signSharePayload(payload, secret)` →
     `v1.base64url(JSON).base64url(HMAC-SHA256)`
   - `verifyShareToken(token, secret, nowSec)` discriminated result:
     `{ok:true,payload}` or `{ok:false,error:'invalid'|'expired'}`;
     max/parts/version/signature length + timingSafeEqual before JSON use
   - `sharePreview(payload)`, `escapeHtml`, `renderShareHtml` with OG/Twitter,
     canonical, CSP/nosniff/referrer, explicit scheme button
   - `shareRateLimitBucket(Map,key,nowMs)` two windows + Retry-After
   - `tokenMatches` app-client header helper (same honest pattern as publish)

2. **Server handler — `api/share.js` + `vercel.json`**
   - methods GET/POST + OPTIONS CORS preflight; others 405 + Allow
   - env helper normalizes `SHARE_PUBLIC_BASE_URL` HTTPS/no trailing slash;
     missing signing/base/client token → fail closed 500 `no_key`
   - POST:
     - serialized body length <=16 KiB
     - timing-safe `x-publish-token`
     - deviceId guard <=64; key = forwarded IP + device
     - rate 429 + Retry-After
     - normalize/sign → `{token,url,expiresAt}`
   - GET:
     - token query single string/max8 KiB
     - verify; invalid 400, expired 410
     - `format=json`: CORS `*`, no-store JSON `{payload}`
     - default: HTML `text/html; charset=utf-8`, CSP/security headers,
       `s-maxage<=86400`
   - Vercel function budget 256 MiB/10s

3. **Client types + pure core — `mobile/core/share/share.ts`**
   - discriminated `ShareEntity` / `ResolvedSharePayload` / `ShareAction`
     types (global `types/index.ts` only for Song reuse; share-specific types
     stay module-local/exported)
   - entity builders from app values:
     `buildTrackShare(song)`, `buildPlaylistShare(playlist)`, room/Blend/Jam
     builders; no IDs/audio URLs
   - strict `validateResolvedShare(raw, nowSec)` mirrors server fields/caps,
     token expiry and code patterns
   - `fallbackShareText(entity)` preserves current useful text/code/scheme
     behavior
   - `shareAction(payload)` typed allowlist; never accepts raw route string
   - `validateCreateResponse(raw, expectedBase)` HTTPS host/path/token/expiry

4. **Client service — `mobile/services/shareService.ts`**
   - errors: `no_key|unauthorized|rate_limited|bad_request|network|invalid`
   - config: `EXPO_PUBLIC_API_BASE_URL` + existing
     `EXPO_PUBLIC_PUBLISH_TOKEN`; 15s axios/fetch timeout
   - `createShareLink(entity)`: device identity → POST `/api/share`; strict
     response guard
   - `shareEntity(entity)`: haptic → if flag enabled try signed URL; otherwise
     fallback text; call RN `Share.share`; signed failure gets info/error toast
     but sheet still opens with fallback
   - `resolveShareToken(token)`: max/shape guard → GET format=json → client
     second validation; never log token/body
   - wrappers `shareTrack`, `sharePlaylist`, `shareRoom`, `shareBlend`,
     `shareJam` keep screens thin

5. **Landing store — `mobile/stores/shareStore.ts`**
   - state: token/payload/loading/error/busy/resolvedSongs
   - request token guards stale resolve; `openToken`, `retry`, `clear`
   - descriptor resolver: `searchSongs(title artist, 5)`, prefer full stream,
     fallback playable preview; bounded 3-at-a-time, dedupe song IDs
   - `performTrack`: resolve/play first; not-found honest
   - `performPlaylist`: resolve descriptors; create `Shared: <name>`, add songs;
     return playlist id + songs for Play All button
   - room/blend/jam returns `shareAction` target only; screen router executes
   - toast/haptic all user actions

6. **Gate + landing route — `components/SocialShareGate.tsx`, `app/share.tsx`**
   - gate pattern: `social_share_enabled`; guest allowed
   - default screen wraps inner component so flag-off mounts no resolve effect
   - token param single/max8 KiB; `openToken` effect + cleanup
   - cards for five kinds, expiry/“shared link” disclosure, playlist descriptor
     preview and resolved status
   - primary actions: Play / Import / Open Room / Join Blend / Join Jam;
     playlist optional Play All after import
   - strict screen switch over typed action; router targets constructed locally
   - loading, invalid, expired, network + retry states

7. **Flag/env wiring**
   - `initializeFeatureFlags`: `EXPO_PUBLIC_SOCIAL_SHARE_ENABLED === 'true'`
   - `.env.example`: API base + social flag note (publish token already present)
   - direct route gated; existing legacy share buttons remain usable while flag
     false

8. **Upgrade track + playlist share handlers**
   - `app/player.tsx`: replace direct `Share.share` body with `shareTrack` wrapper
   - `app/playlist/[id].tsx`: `sharePlaylist` (top 10 descriptors + count)
   - remove now-unused RN Share imports; wrapper owns haptic/fallback/toast
   - exact legacy text output asserted through pure fallback tests

9. **Upgrade room + Blend + Jam share handlers**
   - room: code + optional title → `shareRoom`; preserve six-digit raw-code text
   - Blend: name + inviteCode → `shareBlend`; keep old `blendShareText` as
     fallback parity or route through core
   - Jam: title + inviteCode + normalized room type (`listening_party` maps to
     payload `party`) → `shareJam`
   - remove duplicate screen-level Share imports/haptics

10. **Tests — `test-share.mjs`**
    - server: normalize each kind; private-field drop; string/count/code/URL
      guards; canonical sign/verify; tamper/wrong secret/expired/future/token
      cap; HTML escape/CSP/scheme/canonical; limiter hourly/daily; token auth
    - client: builders exclude IDs/URLs, second validator rejects drift,
      response base/path guard, typed action mapping, fallback text parity
    - use shared fixture array to compare server-normalized data with client
      validator (schema drift guard)
    - root + mobile chains append `test:share` (14 suites)

11. **Probe — `probe-share.mjs`**
    - local handler mock with env sandbox: GET/POST 405, no_key, unauthorized,
      bad request, create, resolve JSON, escaped HTML/security headers,
      tampered/expired, rate 429 + Retry-After
    - `--live <base>` read-only/guard smoke (do not mass-create tokens)

12. **Gates, docs, commit**
    - mobile tsc 0 / lint 0 / root npm test 14 suites
    - local probe pass; script-char + phrase + `git diff --check`
    - REQUIREMENTS FR-15; Phase 8 canonical/preview/native/five entities `[~]`;
      analytics/cards/social SDK/copy/QR `[ ]`
    - CHECKLIST Phase 25 + actual checkbox tracker recount
    - commit:
      `feat(share): Phase 8a — signed canonical links and OG previews (flag off)`

## Deploy/manual gates

1. Generate Vercel-only secret (>=32 random bytes) as `SHARE_SIGNING_SECRET`.
2. Set `SHARE_PUBLIC_BASE_URL=https://<your-vercel-app>`; confirm existing
   `PUBLISH_CLIENT_TOKEN` remains set; deploy root `npx vercel`.
3. Mobile `.env`: `EXPO_PUBLIC_API_BASE_URL` same base,
   `EXPO_PUBLIC_PUBLISH_TOKEN` matching existing server barrier,
   `EXPO_PUBLIC_SOCIAL_SHARE_ENABLED=true`.
4. Test five share kinds across two devices + WhatsApp preview; tamper/expiry
   and server-offline fallback.

## Risks locked

- Client token is public obfuscation, not user auth; strict schema/rate/HMAC are
  primary safety boundaries.
- Serverless rate Map is best-effort per instance; durable limiter waits for
  authenticated/Redis infrastructure.
- Playlist imports resolve descriptors against current catalog; unavailable
  tracks show partial result count, never fake success.
- 30-day expiry trades durable canonical identity for revocable/rotatable
  stateless links; UI displays expiry date.
- HTTPS universal-link auto-open is deferred; explicit scheme button is honest
  v1 fallback.

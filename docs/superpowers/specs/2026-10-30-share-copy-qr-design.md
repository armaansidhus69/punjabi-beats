# Phase 8c — Copy Link + QR Composer V1 (Design)

> Roadmap: Phase 8 "Copy link and QR/share code". Date: 2026-10-30.
> Approved: **reusable share composer with Native Share, Copy Link, and QR**.
> Builds on Phase 8a/8b signed links; no new backend schema/env/database.

## 1. Purpose

Flag-enabled share buttons should offer deliberate choices instead of always
opening the OS sheet: user can share normally, copy the canonical HTTPS link,
or show a scannable QR. Signed-link creation happens once per composer session;
legacy text sharing remains available if the API is unavailable.

## 2. Scope / non-goals

**Goals**
- One reusable composer for track, playlist, room, Blend, Jam, and lyrics
- Actions: Native Share, Copy Link, Show QR
- Signed link generated once and cached in memory for repeated actions
- `/share` recipient landing also exposes Copy Link + Show QR
- Flag-off keeps current immediate legacy native share behavior
- QR overload/error handling; no app crash on oversized token

**Non-goals**
- Save QR/image to gallery
- Device-generated lyric/share image cards
- Short server lookup codes (stateless tokens stay the source of truth)
- Universal/App Links, NFC, nearby sharing
- Clipboard history/read access
- Server changes beyond existing signed-link endpoint

## 3. Dependencies and Expo compatibility

Install from `mobile/` using Expo CLI (no Bun lock):

```bash
npx expo install expo-clipboard react-native-svg react-native-qrcode-svg
```

Expected SDK 51-compatible native versions:
- `expo-clipboard ~6.0.3` (Android/iOS/Web, Expo Go)
- `react-native-svg 15.2.0` (Android/iOS/Web, Expo Go)
- current `react-native-qrcode-svg` JS package with peer `react-native-svg>=14`

Project uses React Native 0.74.5. Current `react-native-qrcode-svg` documents a
required text-encoding Metro transformer for RN <0.75. Add
`mobile/metro.config.js`:

```js
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
config.transformer = {
  ...config.transformer,
  babelTransformerPath: require.resolve(
    'react-native-qrcode-svg/textEncodingTransformation',
  ),
};
module.exports = config;
```

No `ios/`/`android/` manual changes (CNG rule). Run `npx expo install --check`
and `npx expo-doctor` after install.

## 4. Pure link helpers

Extend `mobile/core/share/share.ts`:
- `SHARE_QR_MAX_URL_CHARS = 2400`
- `shareEntityFingerprint(entity)` canonical safe-data key (kind + data only;
  never fallback text/audio URL)
- `canonicalShareUrl(apiBase, token)`:
  - HTTPS base only, no credentials/query/hash/path
  - v1 token regex/max guard
  - returns `<origin>/api/share?token=...` or null
- `canRenderShareQr(url)` → HTTPS canonical URL and length <=2400
- `signedShareMessage(entity,url)` moves current service switch into pure core
  so composer/native paths cannot drift

Tests cover origin/token/length guards, stable fingerprint/private-field
exclusion, every entity signed message, QR exact boundary/over-boundary.

## 5. Composer architecture

### 5.1 Facade — `services/shareComposerFacade.ts`

Existing screens keep thin wrappers (`shareTrack`, `sharePlaylist`, etc.), but
imports move from `shareService` to the facade:
- build strict `ShareEntity`
- if `social_share_enabled` false → call current legacy `shareEntity` directly
- if true → haptic + `shareComposerStore.open(entity)`; no network in screen

`shareService.ts` stays low-level:
- `createShareLink`, `resolveShareToken`
- `openNativeShare(entity, signedUrl?)` (pure message helper + RN Share)
- no import of composer store (avoids cycle)

### 5.2 Store — `stores/shareComposerStore.ts`

State:
- `visible`, `entity`, `created`, `loading`, `error`, `qrVisible`, `qrError`

Actions:
- `open(entity)`: reset UI, show immediately, load cached result or generate
- `retryLink()`: request-token stale guard; create once
- `nativeShare()`: signed URL when available, otherwise legacy fallback
- `copyLink()`: only enabled when result ready; call
  `Clipboard.setStringAsync(url)` directly from press action (no pre-await,
  important for WebKit clipboard user gesture)
- `showQr()` / `hideQr()`: requires `canRenderShareQr`
- `setQrError(message)` from QR renderer callback
- `close()`: invalidate request and clear volatile UI

Module cache: max 10 entries keyed by `shareEntityFingerprint`, FIFO/LRU-lite.
Expiry guard checks `expiresAt > now`; expired cached result regenerates.

If signed API fails:
- composer shows honest error + Retry
- Native Share remains enabled and uses legacy fallback text
- Copy/QR disabled because there is no canonical URL

## 6. UI components

### `components/ShareComposerSheet.tsx`

Global RN `Modal`, mounted once in root layout (AddToPlaylistSheet pattern):
- entity label/summary
- loading/error/retry status
- three 48px actions: Native Share / Copy Link / Show QR
- expiry caption when signed link exists
- close/backdrop actions
- toast + haptic for copy/share/QR errors

### `components/ShareQrModal.tsx`

Reusable nested modal/panel:
- `QRCode` size 220, `ecl="L"`, quiet zone 12, dark modules/white background
- displays entity label and “Scan to open Punjabi Beats”
- Copy Link secondary action
- `onError` hides renderer and shows safe message
- URL >2400 never reaches QR component
- no `getDataURL`, filesystem, gallery, or permissions

## 7. Existing share flow migration

Screens already call wrappers, so only import source changes:
- player track
- playlist detail
- group room
- Blend
- Jam
- lyrics excerpt

Flag behavior:
- **off**: wrapper immediately opens exact legacy native text sheet (current UX)
- **on**: wrapper opens composer; user picks action

No entity schema/token changes. Phase 8a/8b server deployment remains valid.

## 8. `/share` landing additions

Recipient already has `token` and `EXPO_PUBLIC_API_BASE_URL`:
- derive URL with `canonicalShareUrl` (never from payload)
- Copy Link button calls Clipboard directly
- Show QR opens same `ShareQrModal`
- Play/import/join primary action remains unchanged
- invalid API base/token hides copy/QR, never constructs guessed URL

## 9. Errors and safety

- Clipboard URL is public signed link, so do **not** mark it sensitive
- Never copy raw token alone; copy canonical HTTPS URL
- QR only renders strict canonical HTTPS URL <=2400 chars
- QR generation errors isolated by `onError`; action remains copy/share capable
- Composer cache memory-only, max10, expiry-aware; no AsyncStorage token archive
- Closing sheet invalidates late create response
- Native fallback always available even when API/Clipboard/QR fails

## 10. Testing

- Extend `test-share.mjs` pure helper cases
- Component/store compile/lint guards
- `probe-share.mjs` unchanged for endpoint; local handler still passes
- `npx expo install --check`, `npx expo-doctor`
- tsc/lint/root 14-suite chain green
- Metro startup/export smoke ensures transformer resolves

## 11. Delivery

- REQUIREMENTS FR-17
- ROADMAP Copy/QR row `[~]` (copy + display QR done; short share code/image
  save remains deferred)
- CHECKLIST PHASE 27 + actual tracker recount
- commit:
  `feat(share): Phase 8c — copy-link and QR composer (flagged)`

## 12. Manual verification (later consolidated)

- Flag off: share buttons still immediately open legacy sheet
- Flag on: all six entities open composer
- signed create once; Native Share/Copy/QR repeat without duplicate request
- Android/iOS/Web copy result
- scan QR on second device → HTTPS preview → app button
- API offline: composer retry + legacy native share
- oversized/malformed URL never crashes QR renderer

# Phase 8c — Copy Link + QR Composer V1 Implementation Plan

Design: `docs/superpowers/specs/2026-10-30-share-copy-qr-design.md`

Architecture: new facade decides legacy-vs-composer without creating an import
cycle. Composer store uses low-level signed-link service; one global sheet and
one reusable QR modal serve all six entities. Existing server/token schemas stay
unchanged.

## Steps

1. **Install SDK-compatible dependencies (mobile/)**
   - `npx expo install expo-clipboard react-native-svg react-native-qrcode-svg`
   - verify package resolutions expected for SDK 51 (`expo-clipboard ~6.0.3`,
     SVG 15.2.0; QR peer accepts SVG >=14)
   - add `mobile/metro.config.js` using Expo default config +
     `react-native-qrcode-svg/textEncodingTransformation` because RN 0.74.5
   - run `npx expo install --check` immediately; no native directory edits

2. **Pure share helpers — `mobile/core/share/share.ts`**
   - constants: QR URL max 2400, cache cap 10
   - `shareEntityFingerprint(entity)`: JSON of `{kind,data}` only, stable field
     order from builders; fallback text/audio URL excluded
   - `canonicalShareUrl(apiBase,token)`: strict HTTPS origin-only base + v1
     token regex/max → `/api/share?token=`; reject creds/path/query/hash
   - `canRenderShareQr(url)`: canonical endpoint, HTTPS, token, <=2400
   - export `signedShareMessage(entity,url)` by moving current service switch;
     every six-kind message fixture tested

3. **Low-level service refactor — `services/shareService.ts`**
   - keep `createShareLink`, `resolveShareToken`, errors/config
   - export `openNativeShare(entity, signedUrl?)`: signed pure message when URL,
     exact legacy fallback otherwise; native Share + error feedback
   - keep `shareEntity(entity)` only for legacy/safe immediate flow; when called
     by facade flag-off it must not hit API
   - remove entity-builder wrappers from this file after all imports migrate

4. **Composer store — `stores/shareComposerStore.ts`**
   - state: visible/entity/created/loading/error/qrVisible/qrError
   - module cache Map max10, fingerprint key, expired entry evict; deterministic
     oldest insertion eviction
   - request token stale guard
   - `open(entity)`: visible immediately, cache hit or `retryLink`
   - `nativeShare`: low-level service with created URL or fallback
   - `copyLink`: require created; first async call is
     `Clipboard.setStringAsync(created.url)`; success boolean guard + toast/haptic
   - `showQr`: require `canRenderShareQr`; otherwise honest warning
   - QR error callback; close invalidates request/volatile UI

5. **Cycle-free facade — `services/shareComposerFacade.ts`**
   - strict builders + six public wrappers
   - helper `start(entity|null)`:
     - invalid → warning/toast false
     - social flag off → `openNativeShare(entity)` immediate
     - flag on → tap haptic + `useShareComposer.getState().open(entity)`
   - migrate imports in player/playlist/room/Blend/Jam/lyrics from
     `shareService` to facade; behavior otherwise unchanged

6. **QR + composer UI**
   - `components/ShareQrModal.tsx`: QRCode 220/ecl L/quietZone12,
     white background, label, Copy action, close; `onError` callback; never
     mount QR when URL invalid/long
   - `components/ShareComposerSheet.tsx`: global transparent Modal,
     entity summary, loading/error/retry, Native Share always enabled,
     Copy/QR only signed-ready, expiry caption, backdrop/close
   - accessibility roles/labels, 44–48px actions, dark theme parity
   - mount once in `app/_layout.tsx` beside existing global sheets

7. **Recipient landing — `app/share.tsx`**
   - derive canonical URL from API base + already-validated token through pure
     helper; no payload URL
   - local QR-visible state + `ShareQrModal`
   - action row: Copy Link (Clipboard direct) + Show QR; hidden if helper null
   - toast/haptic/errors; existing primary play/import/join unchanged

8. **Tests — extend `test-share.mjs`**
   - fingerprint stable, private fallback/audio exclusion, kind/data sensitivity
   - canonical URL valid + base creds/path/query/hash/http/token guards
   - QR exact 2400/2401 and wrong path guards
   - signed messages all six kinds and canonical URL presence
   - existing HMAC/schema/legacy tests remain green
   - suite count remains 14; assertion count increases

9. **Compatibility and build gates**
   - tsc 0, lint 0, root npm test green, probe-share pass
   - `npx expo install --check`
   - `npx expo-doctor`
   - `npx expo export --platform web --output-dir <approved opencode temp path>`
     to prove Metro transformer/Clipboard/QR bundle without workspace artifacts
   - no `ios/`/`android/` creation/edit

10. **Docs + commit**
    - REQUIREMENTS FR-17
    - ROADMAP Copy/QR row `[~]`; note no image save/short code
    - CHECKLIST PHASE 27 + actual tracker recount
    - script-char/phrase/BOM + diff check
    - commit:
      `feat(share): Phase 8c — copy-link and QR composer (flagged)`

## Risks / fixed decisions

- RN 0.74 transformer is mandatory; export smoke is a release gate.
- QR max2400 avoids renderer capacity exceptions; Copy/Native remain available.
- Clipboard copy is initiated directly by press action for WebKit gesture rules.
- Signed links/tokens stay memory-only cache, max10, expiry-aware.
- No backend redeploy needed for 8c itself; it consumes Phase 8a endpoint.

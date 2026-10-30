# Phase 8b — Selected Lyrics Sharing V1 Implementation Plan

Design: `docs/superpowers/specs/2026-10-30-lyrics-sharing-design.md`

Approach: existing pure lyrics core + signed-share v1 schema extend karo; lyrics
screen me local selection interaction, service wrapper, same `/share` landing.
No dependency/new endpoint/env. Deploy updated server before mobile because old
server sixth kind reject karega (old five kinds/tokens unaffected).

## Steps

1. **Pure lyrics selection — `mobile/core/lyrics/lyrics.ts`**
   - constants `LYRICS_SHARE_MAX_LINES=4`, `LYRICS_SHARE_MAX_CHARS=280`,
     per-line 160
   - `selectionRange(anchor,target,total)`:
     integer/in-bounds guard, ordered contiguous indices, >4 → null
   - `lyricsExcerpt(lines,indices,synced)`:
     - exact contiguous sorted/unique/in-bounds indices
     - trim/control/whitespace normalization
     - Unicode code-point caps via `Array.from`
     - 1..4 lines only; combined `join('\n')` <=280
     - result `{lines,startMs}`; synced uses first selected line time including
       0, plain returns `startMs:null`
   - extend `test-lyrics.mjs`: forward/backward, one/exact4/fifth, invalid
     bounds/noncontiguous/duplicate, empty/control, line160/161, total280/281,
     synced zero/nonzero, plain null

2. **Server share schema — `api/_shareCore.js`**
   - add `lyrics` kind; `normalizeLyricsData`
   - title/artist <=120, lines 1..4, each <=160 code points, joined <=280,
     integer startMs 0..86_400_000 optional, HTTPS cover optional
   - strict private field drop (fullLyrics/sourceUrl/audioUrl/songId)
   - preview title/description/image/label for excerpt
   - existing token version/TTL/signature unchanged
   - handler needs no structural change; same endpoint/env/rate/auth

3. **Client share core — `mobile/core/share/share.ts`**
   - unions/maps add `lyrics`; `LyricsShareData`
   - shared code-point helper/normalizer mirrors server
   - `buildLyricsShare(song,lines,startMs?)` returns safe data + attributed
     native fallback quote; no song/audio/source IDs in `data`
   - `validateResolvedShare` picks sixth kind
   - `shareAction(lyrics)` returns `play_track` query + optional `startMs`
     (update action type; existing track has no startMs)
   - preview/client parity fixtures in `test-share.mjs`

4. **Service/store extension**
   - `shareService.ts`: signed message switch `lyrics`; export
     `shareLyrics(song,lines,startMs?)`
   - `shareStore.ts`: track action uses query for both track/lyrics; after
     `playSong`, `seek(startMs)` when defined (0 is valid); lyrics-specific
     success/not-found toast
   - existing track/playlist/join behavior unchanged

5. **Lyrics screen selection — `mobile/app/lyrics.tsx`**
   - state: `selectionAnchor:number|null`, `selectedIndices:number[]`,
     `sharing`; previous-follow ref
   - long press line:
     - haptic; set anchor/current index; pause following
   - selection mode tap computes `selectionRange(anchor,index,total)` then
     `lyricsExcerpt`; invalid keeps previous range + warning haptic/toast
   - non-selection tap preserves current synced seek behavior
   - Pressable long-press guard prevents release accidentally seeking
   - song ID change clears selection; retry/fetch state unaffected
   - selected + active combined styles/accessibilityState
   - header selection controls: Cancel, `N/4 lines`, Share icon/button
   - Share builds excerpt and awaits `shareLyrics`; success clears selection,
     failure keeps it; local busy prevents double sheet
   - cancel restores previous follow boolean, not forced true

6. **Share landing — `mobile/app/share.tsx`**
   - kind/primary label switches add lyrics (`Shared Lyrics`, `Play Track`)
   - quote card: optional cover, each line, song/artist, optional timestamp
   - same `performPrimaryAction`; no payload route/URL
   - old cards unchanged

7. **Tests + probe**
   - `test-share.mjs` fixture array adds lyrics; assertions:
     server limits/private drop, HMAC round-trip, escaped OG excerpt,
     client builder/guard/action startMs 0 + nonzero, fallback attribution,
     old kind parity unchanged
   - `probe-share.mjs`: create lyrics payload with `<>&` line, JSON resolve,
     HTML escaped check (uses same endpoint; no extra rate burst beyond existing)
   - root suite count stays 14

8. **Gates and self-review**
   - tsc 0, lint 0, root tests green, probe pass
   - script-char/phrase/BOM scan, `git diff --check`
   - security inspect: signed data contains excerpt only; old token tests green

9. **Docs + commit**
   - REQUIREMENTS FR-16
   - ROADMAP Phase 7 selected-line sharing `[~]`; Phase 8 shared entity note
     includes capped lyrics; image cards/copy/QR remain `[ ]`
   - CHECKLIST PHASE 26 + actual tracker recount
   - commit:
     `feat(lyrics): Phase 8b — signed selected-line sharing (excerpt capped)`

## Manual/deploy order

1. Deploy updated root `api/share.js` (same Phase 8a env; no new values).
2. Ship mobile with both `EXPO_PUBLIC_LYRICS_ENABLED=true` and
   `EXPO_PUBLIC_SOCIAL_SHARE_ENABLED=true` for signed behavior.
3. Test synced/plain selection, backward range, 5th-line/281-char guard,
   recipient play+seek, malicious text escaping, flag/API fallback.

## Risks locked

- 4/280 cap reduces accidental over-sharing but is not legal advice/safe harbor.
- Selection is volatile UI state; song change/navigation clears it.
- Timestamp is an optional integer only—no LRCLIB URL or full lyrics linkage.
- Existing v1 tokens stay verifiable because token version/signature framing do
  not change; only allowlisted kind set grows.

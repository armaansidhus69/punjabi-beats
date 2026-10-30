# Phase 8b — Selected Lyrics Sharing V1 (Design)

> Roadmap: Phase 7 "Share selected lines" + Phase 8 share-entity coverage.
> Date: 2026-10-30. Approved: **signed lyric excerpts** (Approach A).
> Builds on Phase 7a LRCLIB lyrics and Phase 8a signed-share infrastructure.
> No new dependency/backend function/env.

## 1. Purpose

Listener lyrics screen se chhota, attributed excerpt choose karke native share
sheet + signed HTTPS preview bhej sake. Recipient safe Punjabi Beats landing par
excerpt dekh kar matching track play kare; synced excerpt ho to first selected
timestamp ke paas seek ho.

## 2. Scope and content boundary

**Goals**
- 1–4 contiguous visible lyric lines select
- Combined excerpt max 280 Unicode code points; each line max 160
- Song title + artist attribution; optional HTTPS cover; optional first-line
  `startMs`
- Signed `lyrics` payload, OG preview, native fallback quote, `/share` landing
- Recipient Play Track action; synced excerpt seeks to first selected timestamp
- Works for synced and plain lyrics (plain has no timestamp action)

**Non-goals**
- Full-song lyrics export/share
- Non-contiguous line collage
- Image lyric cards, custom fonts/backgrounds
- Translation, copy/QR, social platform SDKs
- Report incorrect lyrics
- Legal characterization of excerpt limits: 4 lines/280 chars is a product
  minimization boundary, not a copyright safe-harbor claim

## 3. Share schema extension

Phase 8a token remains `v1`; existing five-kind tokens remain valid. Add sixth
kind `lyrics`:

```js
{
  kind: 'lyrics',
  data: {
    title: string,       // 1..120
    artist: string,      // 1..120
    lines: string[],     // 1..4, each 1..160, combined <=280
    startMs?: number,    // integer 0..86_400_000
    cover?: string       // HTTPS only
  }
}
```

Never include song ID, LRCLIB record/source URL, full lyrics, cache contents,
audio/preview URL, user ID, or room data. Server `_shareCore.js` and client
`core/share/share.ts` both normalize/validate the same limits; parity tests cover
drift.

`sharePreview`:
- title: `Lyrics: <song> — <artist>`
- description: selected lines joined with ` / ` (escaped; cap already applied)
- optional track cover
- label: `Shared lyrics excerpt`

## 4. Pure selection core

Extend `mobile/core/lyrics/lyrics.ts`:
- `LYRICS_SHARE_MAX_LINES = 4`
- `LYRICS_SHARE_MAX_CHARS = 280`
- `selectionRange(anchor, target, totalLines)` → ordered indices or null
  - min/max anchor-target makes contiguous range
  - out-of-bounds or >4 → null
- `lyricsExcerpt(lines, indices)` → normalized selected text or null
  - indices must be contiguous/unique/in bounds
  - line trim/control strip, empty drop is invalid
  - each line max160 and joined code-point count <=280 (`Array.from`, not UTF-16
    `.length`)
  - returns `{lines, startMs}` where `startMs` only when source is synced;
    caller passes synced boolean so plain `timeMs:0` never creates false seek

Pure tests cover forward/backward ranges, exact 4/over 4, bounds, empty/control,
line/combined caps, synced zero timestamp vs plain no timestamp.

## 5. Lyrics screen selection UX

`mobile/app/lyrics.tsx`:
- long-press a line enters selection mode with anchor=index
- while selecting, tap any line selects the contiguous anchor→tap range
- range >4 or excerpt >280: keep previous valid range, warning haptic + toast
- selected rows get distinct border/background; active playback highlight remains
  visible within selected style
- header selection state: Cancel, `N/4 lines`, Share
- Share disabled while no valid excerpt or service busy
- normal mode unchanged: synced tap seeks; plain tap disabled
- starting selection pauses auto-follow; cancel/share completion restores prior
  follow choice (does not force follow on)
- song change clears selection immediately

Actions:
- long-press/tap selection → selection haptic
- Share → `shareLyrics(currentSong, excerpt.lines, excerpt.startMs)`
- service handles signed attempt vs legacy fallback; success closes selection
- native sheet failure leaves selection so user can retry

## 6. Client share extension

`core/share/share.ts`:
- `LyricsShareData`, add `lyrics` to kind/data/payload unions
- `buildLyricsShare(song, lines, startMs?)`
- fallback text:
  `“line 1\nline 2”\n— <title>, <artist> · Punjabi Beats`
- `shareAction(lyrics)` → `{type:'play_track', query, startMs?}`
- validators enforce excerpt caps and integer timestamp

`services/shareService.ts`:
- `shareLyrics` wrapper
- signed message includes short attribution + HTTPS URL; never includes audio URL

`stores/shareStore.ts`:
- track resolver reused for lyrics
- after `playSong`, call player seek when `startMs` is present (0 valid)
- success toast `Shared lyrics track chal raha hai`

## 7. Share landing UI

`mobile/app/share.tsx` adds lyrics card:
- quote-mark icon/optional cover
- selected lines rendered individually (no HTML)
- title + artist attribution
- timestamp chip when present
- primary `Play Track` button

Routing stays typed locally; lyrics payload cannot provide a route or URL action.
Existing tokens/cards unchanged.

## 8. Error/security behavior

- Server rejects zero lines, >4, empty line, line >160, combined >280,
  non-integer/out-of-range startMs, non-HTTPS cover
- Client second guard repeats all checks
- HTML renderer escapes excerpt and all metadata
- Selection state never persists; only share token carries chosen excerpt
- Signed endpoint flag/env failure opens plain native quote (no lost user action)
- Existing token version remains v1; old five-kind links stay valid. Deploy
  server first, then mobile—an old server correctly rejects the new kind.

## 9. Testing

- Extend `test-lyrics.mjs`: pure range/excerpt boundaries
- Extend `test-share.mjs`:
  - server lyrics normalize/private-field drop/limits
  - HMAC round-trip + HTML escaping for lyric lines
  - client builder excludes full lyrics/audio/source IDs
  - second guard + play action timestamp 0/nonzero
  - fallback attribution
- Extend `probe-share.mjs` valid lyrics create/JSON/HTML check
- Existing 14-suite chain remains; assertion counts increase
- tsc/lint zero

## 10. Delivery

- No new env; redeploy updated `api/share.js` **before** enabling the mobile
  build with lyrics sharing
- REQUIREMENTS FR-16
- ROADMAP Phase 7 selected-line share `[~]`; Phase 8 entity row annotation adds
  lyrics excerpt; image cards/copy/QR remain `[ ]`
- CHECKLIST PHASE 26 + actual tracker recount
- commit:
  `feat(lyrics): Phase 8b — signed selected-line sharing (excerpt capped)`

## 11. Manual verification

- synced: long-press, backward/forward 1–4 range, share, recipient Play Track
  seeks to first line (including timestamp 0)
- plain: excerpt shares, recipient plays without false seek
- fifth line / >280 chars warns and preserves prior valid selection
- malicious `<>&` text renders escaped in web preview
- signed API offline/flag off still opens attributed native quote

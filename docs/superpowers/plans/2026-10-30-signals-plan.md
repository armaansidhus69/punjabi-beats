# Signals Data Foundation — Implementation Plan (Phase 13a)

Design: `docs/superpowers/specs/2026-10-29-signals-design.md`
Pattern: same layering as Blend/Jam/Podcasts phases — pure logic first, then
service/boot wiring, then tests + gates. Screens untouched (koi UI change nahi
— ye invisible plumbing hai). Guest-compatible, local-only, koi backend.

## Steps

1. **Types** — `mobile/types/index.ts` appended section:
   `SignalName`, `PlaySignal`, `SignalsLedger`, `TasteSongStats`,
   `TasteStatsMap`, `TasteStats`, `QueryTally` (spec Section 3 shapes).

2. **Pure core — `mobile/core/signals/schema.ts`**:
   - `SIGNALS_VERSION = 1`; `createLedger()`, `normalizeLedger(raw)` (version
     mismatch → fresh; per-signal schema guard → partial drop, valid bachte).
   - `buildSignal(fields, nowIso, idBytes)` → `PlaySignal` (id =
     `fnv1a64Hex([name, songId ?? query, nowIso])` — reuse blend hash).
   - `isSignalName(name): name is SignalName` guard (fail-closed).

3. **Pure core — `mobile/core/signals/skip.ts`**:
   - `MIN_SIGNAL_DURATION_MS = 30_000`, `SKIP_THRESHOLD_PCT = 80`,
     `COMPLETE_THRESHOLD_PCT = 95`; `completedPct(positionMs, durationMs)`
     (duration <= 0 → 0).
   - `classifyPlayback({durationMs, positionMs, ended, manual, remote}) →
     'play_complete' | 'play_skip' | null` (spec Section 4 table exact
     boundaries; <80% & !manual → null).

4. **Pure core — `mobile/core/signals/stats.ts`**:
   - `aggregateSignals(signals)` → `TasteStats` (remote excluded; likes/
     playlistAdds net with >=0 clamp; queries tally lowercase key).
   - `applySignal(stats, signal)` → new TasteStats (incremental upsert, pure).
   - `tasteSongScore(stats)` — 1.0*completions + 0.5*plays + 2.0*likes +
     1.5*playlistAdds − 0.5*skips (spec 3.3, flat).
   - `artistStats(stats)` — artists rollup, shape parity w/ blend
     `TasteArtist` ({name lowercase, count}) + per-artist net score.

5. **Service — `mobile/services/signalsService.ts`**:
   - Keys: `@pb_play_signals` (SignalsLedger envelope), `@pb_taste_stats`
     (TasteStats).
   - `recordSink(name, properties?)` — analytics sink; playback events ke liye
     `applySignal` + ledger append + cap 1000 oldest-drop; async queued persist
   - `loadSignals()` (restore + normalize) boot pe.
   - `getTasteStats()`, `getSignalCount()` — 13b consumers.
   - Property-key validation per name (fail-closed spec Section 7).

6. **Boot** — `core/bootstrap.ts`: `configureAnalytics({ enabled: true, sink:
   recordSink })` (lazy import — bootstrap ordering pe break na ho; seedha
   import signal service ka galat cycle ho to dynamic `await import`).

7. **Player wiring** — `mobile/stores/playerStore.ts`:
   - `playSong`: play_start emit (remote = options?.remote === true).
   - `PlaybackActiveTrackChanged`: outgoing track ka position/duration pehle
     state se read → `classifyPlayback` → emit complete/skip/nothing.
   - `autoAdvancePending` internal flag: load-failure auto-advance pe set,
     agle track-change pe consume (1 use) — skip signal suppress.
   - `playNext/playPrev`: manual = true (room remote 'next' bhi manual hi
     momot hai — session me source manual hai; remote exclusion play_start pe
     hi bharosa karta hai).

8. **Store emit call sites** (one-line `void trackEvent(...)` fire-and-forget):
   - `searchStore.addRecentSearch` → `search_query` (query).
   - `likedSongsStore.toggleLiked` → `song_like` / `song_unlike` (song fields).
   - `playlistStore.addSongToPlaylist` / `removeSongFromPlaylist` →
     `playlist_add` / `playlist_remove`.

9. **Tests** — root `test-signals.mjs` (pure core only, service/player nahi):
   - schema guard: unknown name, missing ts/id — fail-closed.
   - skip policy boundaries: 30s floor, 79.9/80/94.9/95%, ended, !manual.
   - aggregate: remote exclusion, net likes/playlist clamp >= 0, query tally
     lowercase merge.
   - tasteSongScore + artistStats: weights + blend shape parity.
   - normalizeLedger: version mismatch, partial corruption, oldest-drop cap
     1000 (service-level cap bhi test-pure — mutable array helper).
   - Wire root `package.json` (`test:signals` + `npm test` chain append) aur
     `mobile/package.json` mirror.

10. **Gates** — `cd mobile && npx tsc --noEmit` (0) · `npm run lint` (0
    warnings, unused imports nahi) · root `npm test` green (6+1 suites).

11. **Roadmap + commit** — Phase 13 "Data foundation" rows `[~]` + status
    note (AI playlist rows `[ ]` honest); CHECKLIST.md PHASE 20 section;
    REQUIREMENTS.md FR-10 (10.1..10.6). Commit
    `feat(signals): Phase 13a — local signal ledger + taste stats (flagless)`.

## Notes / risks

- **Analytics sink race**: boot pe `bootstrap.ts` pehle chal sakta hai — service
  sink async import pe to fallback recordSink no-op, later live ho jayega.
- **Recents remote plays** is phase me nahi fix hote (service-level exclusion
  kaafi hai taste me); recents list UX unchanged.
- Podcasts episodes player pipeline se aate — completedPct high hoga,
  30s floor unhe suppress nahi karega (long durations); `play_start` seeds
  songId = episode.id (progress id same fnv1a hash — 专辑 coherent).
- Property pakad me artistNames legacy field handling: song.artist comma-sep
  blend pattern. Kuch songs me artist "Artist1, Artist2" hota — split pure
  normalize helper me, core only.

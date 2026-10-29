# Phase 13a — Signals Data Foundation (Design)

> Roadmap: `mobile/docs/PRODUCTION_ROADMAP_CHECKLIST.md` → "Phase 13 — AI and
> recommendations → Data foundation". FR ids REQUIREMENTS.md me FR-10 ke saath
> implementation plan me add honge.
> Date: 2026-10-29. Approved scope: **data foundation only** — AI playlist
> (LLM call, server key) alag 13b phase hai.

## 1. Purpose

AI playlist/assistant ka data base abhi khali hai — aaj app me:

- koi skip/complete signal nahi (`playNext()` sirf track advance karta hai)
- recents sirf play-invocation se banta hai, **remote room-follow plays bhi
  ghuste hain** (taste skew) aur timestamps/percent-played kahin save nahi
  hote
- like/playlist/search mutations ka aapas me koi ledger nahi — Blend snapshot
  har baar full-state recompute karta hai, deltas gayab hain
- Phase 0 ka `core/analytics` facade stub hai: boot pe
  `configureAnalytics({ enabled: false })`, aur **zero call sites**

Ye phase sirf **signal capture + aggregation** banata hai, local-first.
Koi LLM call, koi Supabase table, koi backend deploy nahi.

## 2. Goals / Non-goals

**Goals**
- Play/skip/complete, like/unlike, playlist add/remove, search query — sab
  ek capped local ledger + derived counters me.
- Remote (room-follow) plays record ho par **taste stats se exclude** hon.
- Guest mode me bhi fully kaam kare (AsyncStorage).
- Pure logic headless-testable (Node type-stripping, existing test pattern).
- Consumer API: `getTasteStats()` — 13b AI playlist ka seed input.

**Non-goals (13b ya baad)**
- AI playlist generation, assistant UI, prompt history (13b)
- Supabase signal sync / any new backend artifact
- Blend snapshot v2 weighting change (blend untouched; fusion 13b/baad me)
- Per-search-result clicks recording (NFR-4.3 no-tracking — queries only)
- Room activity ledger (reaction_log already DB-level hai; room follow sirf
  playback signal ke `remote: true` size me capture hota hai)

## 3. Data model

### 3.1 Ledger — `@pb_play_signals`

Envelope object, append-only signals array, **max 1000** (oldest drop):

```ts
/** ledger shaape — version mismatch pe content discard, fresh start */
interface SignalsLedger {
  version: 1;
  signals: PlaySignal[];   // oldest-first order, newest last
}

type SignalName =
  | 'play_start'      // song begins (local input OR remote follow — remote flag)
  | 'play_complete'   // outgoing track ended ya >=95% position
  | 'play_skip'       // manual next/prev, completedPct < 80%
  | 'song_like' | 'song_unlike'
  | 'playlist_add' | 'playlist_remove'
  | 'search_query';   // query >= 2 chars (search screen guard already)

interface PlaySignal {
  id: string;          // fnv1a64Hex([name, songId ?? query, ts]) — debug dedupe
  name: SignalName;
  /** search_query pe null */
  songId: string | null;
  artistNames: string[];   // song.artist comma-split lowercase (blend parity)
  provider: SongSource | null;
  durationMs: number;      // static events pe 0
  positionMs: number;
  completedPct: number;    // 0..100 pure math (durationMs <= 0 → 0)
  ended: boolean;          // track-complete / queue-end coordinate pe
  manual: boolean;         // user-initiated action (skip classification me)
  remote: boolean;         // room-follow play (taste exclude)
  ts: string;              // ISO — service Date.now() se
}

/** ledger schema version — mismatch pe discard + rebuild */
const SIGNALS_VERSION = 1;
/** search queries ka seed tally — song-level stats se alag */
type QueryTally = Record<string, string>;  // lowercased query → latest raw form
```

### 3.2 Derived — `@pb_taste_stats`

**Raw counters hi store hote hain** — weights consumer ke waqt lagte hain
(pure), taaki weight tuning data corrupt na kare:

```ts
interface TasteSongStats {
  plays: number;          // play_start, !remote
  completions: number;    // play_complete, !remote
  skips: number;          // play_skip, !remote
  likes: number;          // song_like NET of song_unlike (>= 0 clamp)
  playlistAdds: number;   // playlist_add NET of playlist_remove (>= 0 clamp)
  lastTs: string;         // latest contributing signal ka ISO
}
type TasteStatsMap = Record<string, TasteSongStats>;  // key = songId

interface TasteStats { songs: TasteStatsMap; queries: QueryTally; }
```

Artists aggregation consumer-side pure: `core/signals/stats.ts` me
`artistStats(stats)` — song stats ke artistNames par plays/completions/skips
ka net rollup, blend `TasteArtist` shape parity ({name: lowercase, count}).

### 3.3 Weights (consumer facade, pure — data me NAHI)

`tasteSongScore(stats) = 1.0*completions + 0.5*plays + 2.0*likes +
1.5*playlistAdds − 0.5*skips` — flat scoring 13a me; completedPct-diversify
tuning 13b me dekhi jayegi.

## 4. Skip / complete policy (pure — `core/signals/skip.ts`)

Track change pe outgoing track ka playerStore position/duration input hota
hai:

```
durationMs <= 30_000           → koi playback signal nahi (short/preview clips)
completedPct >= 95 OR ended    → play_complete (ended flag pass-through)
80 <= completedPct < 95        → koi signal nahi (neutral zone)
completedPct < 80 & manual     → play_skip
completedPct < 80 & !manual    → koi signal nahi
```

`manual` source-of-truth: playerStore error-auto-advance path
(load-failure → internal auto skip) ek internal flag set karega
(`autoAdvancePending`) jo agle track-change pe consume hota hai — failure
skips signal emit nahi karte (song ki galti thi, user ki pasand nahi).
Manual `playNext()/playPrev()` auto flag off rakhte hain. Automatic
queue-advance (TrackPlayer self-advance after track complete) bhi bina
manual action aata hai, par uski position >= 95% hoti hai — complete branch
me sahi classify hoti hai.

## 5. Recording bus — analytics facade finally live

- `core/analytics/analytics.ts` ka existingisclosed API reuse:
  `configureAnalytics({ enabled: true, sink })` boot pe (`core/bootstrap.ts`).
- `services/signalsService.ts` sink implement karta hai. **Core sirf
  interface know karta hai** — `AnalyticsSink` type facade me hai; service
  core ke pure builders/validators import karta hai, core service ko import
  nahi karta (dependency direction correct rahi).
- `recordSignal(...)` → build + validate (schema guard) → ledger
  append + cap + taste-stats increment; AsyncStorage writes queued
  promisified (likedSongsStore persistQueue pattern), play path block nahi
  hoti. Peak throughput: ~1 write/song event, wholly background.
- Search/liked/playlist store mutations se one-line fire-and-forget
  `trackEvent` calls (~6 call sites) — stores me sirf emit, baaki logic
  service/core me.
- App start: `loadSignals()` restore + partial-corruption guard (schema
  invalid rows drop, valid bachte hain — recently-played pattern).

## 6. Player integration (single choke point)

`playerStore.playSong()` + `PlaybackActiveTrackChanged` handler:

- **play_start**: `playSong` call-time — `remote = options?.remote === true`
  (persisted restore khud `remote: true` bhejta hi hai), local player taps
  `remote: false`. position 0, completedPct 0.
- **play classify**: `PlaybackActiveTrackChanged` pe previous track ka
  song/position/duration current state se pehle read; policy (Section 4)
  apply; echo-guard (requestedTrackId bookkeeping) reuse.
- Podcasts: podcast episodes bhi `Song` pipeline se chalte hain — play_start
  aayega (provider 'itunes'); skip/complete split 30s-floor skip nahi karega
  kyunki episode durations bahut bade hote. (comment me note).

## 7. Error handling / robustness

- Ledger/stats read fail → empty maps + console.warn (storage.ts pattern).
- Unknown event name / invalid schema → drop + warn (fail-closed).
- `SIGNALS_VERSION` mismatch → ledger discard, fresh start.
- Guest flow me koi special-case nahi (sabhi local hai; future cloud sync
  ka RLS design 13b topic hai).

## 8. Testing (`test-signals.mjs`, pure headless)

- Skip policy boundaries: 30s floor, 79.9/80/95%, ended, !manual/remote.
- Ledger: cap 1000 me oldest-drop, id determinism, ts ordering.
- Aggregation: tasteSongScore weights, likes/playlistAdds net clamp,
  remote exclusion verified.
- Rebuild: ledger → stats pure recovery, partial-corruption guard.
- `artistStats` mapping — blend `TasteArtist` shape parity.

Root `npm test` chain + mobile mirror append (`test:signals`).

## 9. Gates / delivery

`cd mobile && npx tsc --noEmit` (0) · `npm run lint` (0) · root `npm test`.
Roadmap Phase 13 rows (Data foundation) `[~]` + status note, CHECKLIST.md
naya PHASE section, REQUIREMENTS FR-10 (Ek ghanta plan commit me). Commit
conventional style — koi backend deploy nahi.

## 10. Open items (13b triggers)

- `ai_playlist_enabled` env hook
- `buildTasteSnapshot` v2 — plays/skips weight fusion (blend refresh)
- Supabase `play_signals` table (agar authed cloud taste hoga — RLS per-user)

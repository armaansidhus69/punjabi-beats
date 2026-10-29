# Podcasts v1 — Design (Phase 12a)

**Status:** approved design → implementation pending
**Phase:** roadmap Phase 12 (podcasts only; audiobooks + music-video deferred — see Defer note)
**Date:** 2026-10-29

## Problem & Intent

Roadmap Phase 12 bundles three content types (podcasts, audiobooks, music-video).
These are independent subsystems; this spec covers **podcasts v1 only** — the
one with a live, free, key-less data source (iTunes Search already powers the
song catalogue) and zero new native modules. Success = user can find Punjabi/
Indian podcasts in the app, open a show, play full episodes in the existing
player, resume mid-episode after app restart, and see played state — all
working in guest mode (no login required).

## Scope

**In v1 (core listening):**
- Podcast search (shows + episodes) via iTunes, IN store, plus English spine.
- Show page with episode list (newest-first), hero, save/unsave show.
- Continue-listening (episode resume position) + played state (local).
- Saved (subscribed) shows list, local-only.
- Playback through the **existing player pipeline** — episode maps to `Song`.
- Library tab entry card (Blend/Jam pattern).

**Out of v1 (deferred, honest):** comments, polls, transcripts, auto-download,
notification preferences, Supabase sync of progress/saves, audiobooks,
music-video. Roadmap boxes stay `[ ]` with a defer note; podcasts boxes go
`[~]` after implementation, `[x]` after manual pass.

## Data sources (probed 2026-10-29, working, free, no key)

1. **Show search:** `GET https://itunes.apple.com/search?term=<q>&media=podcast&entity=podcast&limit=<n>&country=IN`
   → results with `collectionId`, `collectionName`, `artistName`, `feedUrl`,
   `artworkUrl600`, `primaryGenreName`. Works for IN store (SBS Punjabi
   Pioneers etc. in probe).
2. **Episodes via RSS (primary, authoritative):** `feedUrl` → standard RSS 2.0
   `<item>`s each with `<title>`, `<enclosure url type=length>`,
   `<itunes:duration>` (seconds or `H:MM:SS`), `<pubDate>`, `<description>`,
   optional `<itunes:summary>`. Clean newest-first ordering and full metadata.
3. **Episodes via lookup (fallback):** `GET .../lookup?id=<collectionId>&entity=podcastEpisode&limit=<n>&country=IN`
   → first row is the show itself (`wrapperType≠podcastEpisode` — filter out);
   rows give `trackName`, `episodeUrl` (direct full mp3 — probe showed 28-min
   episodes), `trackTimeMillis`, `releaseDate`, `description`.
   Use when `feedUrl` missing or RSS fetch/parse fails.
4. **Episode search:** `.../search?term=<q>&media=podcast&entity=podcastEpisode&limit=<n>&country=IN`
   (episode rows, same shape as lookup rows; no `feedUrl` context needed).

Episode audio = direct https mp3/m4a `enclosure`/`episodeUrl` — **full length**,
no 30s-preview limitation (unlike the music iTunes path).

## Architecture

Same layering rules as the rest of the app: screens render only; logic in
`core/` + `services/`; storage only via `services/storage.ts`.

```
types/index.ts            + PodcastShow, PodcastEpisode (+ label unions)
mobile/core/podcast/
  rss.ts        pure RSS/ATOM parser: string → { title, episodes[] };
                handles rss 2.0 + itunes namespace, malformed-item skip
  episode.ts    adapters: rss item → PodcastEpisode; PodcastEpisode → Song
  progress.ts   pure merge policy: (current, played, duration) → record;
                95% of duration OR explicit event = played
mobile/services/podcastService.ts
  searchShows(q) · searchEpisodes(q) · getShowEpisodes(show)
    (RSS fetch → parse; fallback lookup) · lookup helpers;
  iTunes base reuse from musicApi shape (own ITUNES_BASE const is fine)
mobile/services/storage.ts  + three keys (see Storage)
mobile/app/podcast/index.tsx      search + saved shows + continue listening
mobile/app/podcast/[id].tsx       show page: hero + save/unsave + episodes
mobile/components/EpisodeRow.tsx  list row (playable, played/progress badge)
Library tab: Podcasts entry card below Jam card → /podcast
Feature flag: `podcasts_enabled` (FEATURE_FLAG_NAMES + map, default OFF;
  `EXPO_PUBLIC_PODCASTS_ENABLED=true` opt-in, same pattern as blend/jam)
```

**Types (`mobile/types/index.ts`):**
```ts
export interface PodcastShow {
  id: string;            // iTunes collectionId (string)
  title: string;
  artist: string;
  artworkUrl: string;
  feedUrl: string | null;
  primaryGenre: string | null;
}
export interface PodcastEpisode {
  id: string;            // episodeUrl hash (deterministic fnv1a-64) — stable key
  showId: string;
  showTitle: string;
  title: string;
  description: string | null;
  artworkUrl: string;
  durationMs: number;    // 0 if unknown
  audioUrl: string;      // full stream (enclosure / episodeUrl)
  publishedAt: string;   // ISO
}
```

**Storage keys (AsyncStorage, guest-usable):**
- `@pb_podcast_shows` — saved shows (`PodcastShow[]`)
- `@pb_podcast_progress` — map `episodeId → { positionMs, durationMs, played,
  updatedAt }`; upserted on position events (throttled ~10s / on pause)
- `@pb_podcast_recent_searches` — none: podcast queries write into the shared
  `@pb_recent_searches` key (they are still queries).

**Player integration:** `episodeToSong(ep) → Song { id: ep.id, title, artist:
showTitle, cover: artworkUrl, preview: audioUrl, duration: durationMs,
source: 'itunes', previewOnly: false }`. Play = existing `usePlayer.playSong`.
Resume = `initialPosition` from progress map. Player already tracks `position`
(ms) headlessly and persists state — progress writing adds a light subscription
in the episode screen/store, not a player change.

**Continue-listening row:** top of `/podcast` from progress map where
`!played && positionMs > 0`, most recent `updatedAt` first, max 5.

**Played policy (pure, testable):** episode counts played when
`positionMs ≥ 0.95 × durationMs` (durationMs > 0). Badge is visible on rows;
no manual "mark played" UI in v1 (keep surface small).

## Error handling

- iTunes/RSS failures → toast + retry chip per screen (Blend search pattern).
- RSS parse zero-episodes → fallback lookup silently, then error if both fail.
- Malformed `<item>` skipped individually (parser never throws on one bad item;
  tests cover).
- feedUrl without `.xml`/https → still attempt fetch; content-type sniff.
- No audioUrl episode rows filtered out at mapper level.

## Testing (`test-podcast.mjs`, headless, wired into root `npm test` + mobile `test:podcasts`)

- RSS fixtures: rss2.0+itunes ns, ATOM doc, malformed item inside valid feed,
  unknown duration formats (`300`, `1:02:03`), CDATA descriptions — all in the
  parser test with deterministic outputs.
- `episodeToSong` mapping invariants (full-play, id = url hash).
- `progress.ts` policy boundaries (94.9% / 95% / duration 0).
- No network in tests (fetch layer is service-level, covered by probes).

## Roadmap mapping (after implementation)

`[~]` Podcast show/episode pages · continue listening · played state.
`[~]` Save-for-later (saved shows) — partial: comments/polls/transcripts/
chapters/auto-download/notification-prefs `[ ]` deferred.
Audiobook + music-video boxes `[ ]` with decompose note (separate specs).

## Defer note (Phase 12 remainder)

Audiobooks (purchase/access/family/offline licences) and music-video (native
player + rights policy) need their own specs; neither has a free viable
source today. They stay out of scope by design, not by omission.

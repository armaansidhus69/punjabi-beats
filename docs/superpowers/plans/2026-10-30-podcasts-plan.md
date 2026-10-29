# Podcasts v1 — Implementation Plan (Phase 12a)

Design: `docs/superpowers/specs/2026-10-29-podcasts-design.md`
Pattern: same layering as Blend/Jam phases — pure logic first, service, then
screens, then tests + gates. Screens render only; logic in core/services;
storage only via storage.ts.

## Steps

1. **Types** — `mobile/types/index.ts`: `PodcastShow`, `PodcastEpisode`
   (exact shape from spec). Song reuses `source: 'itunes'` — union me naya
   member nahi.

2. **Flag** — `mobile/core/featureflags/featureFlags.ts`:
   `podcasts_enabled` in FEATURE_FLAG_NAMES + DEFAULT (false) +
   `EXPO_PUBLIC_PODCASTS_ENABLED` opt-in in initializeFeatureFlags (blend/jam
   pattern). `.env` + `.env.example` documents add.

3. **RSS parser (pure)** — `mobile/core/podcast/rss.ts`:
   - `parsePodcastFeed(xml: string): ParsedFeed`, `ParsedFeed = { title,
     artist, artwork, episodes: RssEpisode[] }`.
   - Lightweight tag tokenizer (stack-based), regex-free attribute reader.
     Regex-only-on-whole-doc explicitly NOT allowed (descriptions me HTML ho
     sakta hai) — attribute reader inner-text scanner use kare.
   - Handles: `<item>` iteration, `<enclosure>` attrs, `<itunes:duration>`
     (`300` ya `1:02:03`), `<pubDate>` (RFC822 → ISO; invalid → skip date),
     CDATA unwrap, HTML-entity-free raw text passthrough, `<itunes:image>`
     attrs, `<author>/<itunes:author>`.
   - Malformed item → skip item, feed continues. Unknown/duplicate tags →
     first wins. Header-comment + malformed XML → empty episode list result
     (caller fallback pe jata hai; parser throw NAHI karega input ke liye).

4. **Adapters (pure)** — `mobile/core/podcast/episode.ts`:
   - `stableEpisodeId(audioUrl)` — `fnv1a64Hex` reuse from
     `../blend/snapshot.ts` (generic 64-bit hash, dup avoid) — url hash =
     stable resume/played keys.
   - `rssEpisodeToPodcastEpisode(item, showMeta) → PodcastEpisode | null`
     (audioUrl missing → null).
   - `episodeToSong(ep) → Song` (full-play mapping spec se).
   - `itunesEpisodeRowToPodcastEpisode(row, showMeta)` for the lookup path.

5. **Progress policy (pure)** — `mobile/core/podcast/progress.ts`:
   - `isEpisodePlayed(record)` — played jab `durationMs > 0` aur
     `positionMs ≥ 0.95 × durationMs`.
   - `mergeProgress(prev | null, patch, nowIso)` — monotonic-ish shaping;
     `played` sticky true; `positionMs` 0..durationMs clamp.

6. **Storage** — `mobile/services/storage.ts` (existing file, `require()`
   import pattern preserved by callers):
   - `@pb_podcast_shows` → `getSavedPodcastShows() / saveSavedPodcastShows()`.
   - `@pb_podcast_progress` → `getPodcastProgressMap() /
     savePodcastProgressEntry(episodeId, entry)` (writer-level read-modify
     write; throttle caller me).

7. **Service** — `mobile/services/podcastService.ts`:
   - `searchShows(q, limit)` — `/search?media=podcast&entity=podcast`
     (`country=EXPO_PUBLIC_ITUNES_COUNTRY`).
   - `searchEpisodes(q, limit)` — `/search?entity=podcastEpisode`.
   - `getShowEpisodes(show, limit)` — feedUrl RSS fetch+parse (RN fetch with
     10s AbortController timeout) → RSS path may return episodes;
     zero/failure → `lookup?id&entity=podcastEpisode` fallback +
     `itunesEpisodeRowToPodcastEpisode`; both fail → friendly error.
   - Mapper limits: episodes newest-first (RSS order preserved; lookup sorted
     by releaseDate desc); rows with no audioUrl dropped.

8. **Hooks + screens**
   - `mobile/hooks/usePodcastProgress.ts` — subscribe `usePlayer` position;
     jab currentSong podcast episode ho (id map me match) to throttled (~10s)
     + on-pause write into progress map (subscription-only player touching).
   - `mobile/components/EpisodeRow.tsx` — title/duration/date + played badge
     + progress resume text (position known) + play button (initialPosition
     from progress).
   - `mobile/app/podcast/index.tsx` — continue-listening row (latest 5,
     `!played`), saved shows horizontal, search input (400 ms debounce, min
     2 chars) tabs for shows vs episodes results? NO — v1 single list: shows
     list; episodes search separate section me (flat 2 sections).
   - `mobile/app/podcast/[id].tsx` — hero (art, title, artist, genre),
     save/unsave chip, episodes list (EpisodeRow), resume continues.
   - Library tab — Podcasts entry card below Jam card (`/podcast` push).
   - Empty/error states Blend search pattern se (LoadingSpinner/EmptyState).

9. **Tests** — root `test-podcast.mjs` (headless; Node type-stripping):
   - RSS fixtures: rss2.0 + itunes ns (valid full), ATOM doc, malformed item
     inside valid feed, duration formats (`300`, `1:02:03`), CDATA, missing
     enclosure → episode null.
   - `episodeToSong` invariants; `stableEpisodeId` deterministic + dupe-safe.
   - progress boundaries (94.9% / 95% / duration 0 / sticky played).
   - Wire: root `package.json` `npm test` chain + `test:podcast` script;
     `mobile/package.json` `test:podcast` + chain append (blend/jam series).

10. **Gates** — `cd mobile && npx tsc --noEmit` (0) · `npm run lint`
    (0 warnings) · root `npm test` green. Lint rules: no unused imports, no
    `Array<T>` (use `T[]`), screens-no-logic zone boundaries same as Jam phase.

11. **Roadmap + commit** — Phase 12 podcast boxes `[~]` + status note
    (Blend/Jam note pattern); audiobooks/video boxes `[ ]` + defer note;
    notifications/chapters/polls boxes `[ ]` honest partial. Commit
    `feat(podcasts): Phase 12a v1 — RSS episodes v1 (flag off)` style
    conventional commit, explicit `git add` paths. Server-side deploy kuch
    nahi chahiye (koi autoreplay/edge function nahi in phase 12a).

## Notes / risks

- Podcast duration 0 case: player seekbar with 0 duration degrades; lookup
  path usually fills duration; RSS missing duration → 0 and played-badge
  skipped (safer default).
- alive `feedUrl` could be ATOM (podbean) — parser covers both shape in step 3.
- Continue-listening rows reuse existing playerStore (no extra position
  hooks) — player persistence already saved on its own; the podcast progress
  map is an additive independent ledger, no player surgery.

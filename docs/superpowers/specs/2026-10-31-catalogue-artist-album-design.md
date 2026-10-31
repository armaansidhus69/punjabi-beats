# Phase 3 — Music Catalogue: Artist & Album Detail Screens (Design)

> Roadmap: Architectural Upgrade Phase 3 (Catalogue) & REQUIREMENTS.md.
> Date: 2026-10-31.
> Feature Flag: `catalog_enabled` (already in `featureFlags.ts`, enabled via `EXPO_PUBLIC_CATALOG_ENABLED=true`).
> Budget: ₹0 (Client-side, uses existing dynamic multi-provider search chain — no new backend serverless function needed).

---

## 1. Purpose

Songs currently have only a static `artist` string. Tapping an artist does nothing, and there are no dedicated Artist or Album pages.
This feature introduces:
1. **Dedicated Artist Detail Screen (`app/artist/[name].tsx`)**: High-res avatar, banner, bio, track count, "Play All", and top songs list.
2. **Dedicated Album Detail Screen (`app/album/[id].tsx`)**: Album cover, artist info, release year, tracklist, and "Play All".
3. **Popular Artists Carousel on Home (`app/(tabs)/index.tsx`)**: Circular avatar cards of Punjabi music icons (Diljit Dosanjh, Sidhu Moose Wala, Karan Aujla, AP Dhillon, Shubh, etc.) leading directly to their artist pages.
4. **Interactive Artist Subtitle in `SongItem`**: Users can tap the artist name under any song title to open that artist's page.

---

## 2. Goals & Non-Goals

### Goals
- Dynamic track resolution using existing `searchSongs(query)` — every song on the artist page is immediately playable via the current multi-provider chain (JioSaavn → Verome → iTunes).
- Curated Punjabi artist profiles (`mobile/constants/artists.ts`) with high-res images, bios, and tags for top 10+ Punjabi icons.
- Fallback support: Opening any arbitrary/unlisted artist dynamically resolves their songs and provides a clean default avatar with their initial letter.
- "Play All" button adds the artist's songs to the player queue and begins playback immediately.
- Zero breaking changes to existing `SongItem` or `HomeScreen` interfaces.

### Non-Goals
- Follow / Unfollow artist sync with cloud backend (Phase 1/Supabase social graph later).
- Artist concert / tour ticket integration (Phase 15 later).
- Artist merchandise / store (Phase 15 later).

---

## 3. Data Models & Types (`mobile/types/index.ts`)

```typescript
export interface ArtistSummary {
  id: string; // url-safe slug
  name: string;
  image: string;
  bio?: string;
  monthlyListeners?: string;
  genre?: string;
}

export interface AlbumSummary {
  id: string; // album name slug or provider id
  title: string;
  artist: string;
  cover: string;
  year?: string;
  trackCount?: number;
}
```

---

## 4. Pure Core Logic (`mobile/core/catalogue/catalogue.ts`)

Pure headless helpers:
- `normalizeArtistName(raw: string): string` — trims and strips bracketed feat/remix tags.
- `slugify(text: string): string` — creates clean route parameters.
- `extractAlbumsFromSongs(songs: Song[]): AlbumSummary[]` — groups songs by inferred album/release.
- `matchCuratedArtist(query: string, list: ArtistSummary[]): ArtistSummary | null` — case-insensitive substring and exact matching.

---

## 5. Screen Specifications

### 5.1 Artist Detail Screen (`mobile/app/artist/[name].tsx`)
- Header with back button (`chevron-back`), artist image banner / avatar.
- Verified badge, genre/listener tag, and short bio.
- Sticky/Action row: "Play All" primary button, Shuffle button.
- Song list: FlatList of `SongItem`s with like, add to playlist, and play support.
- Empty and Loading states with `LoadingSpinner` and `EmptyState`.

### 5.2 Album Detail Screen (`mobile/app/album/[id].tsx`)
- Header with back button, album artwork (square, rounded corners), title, artist, year.
- "Play All" button.
- Tracklist using `SongItem`.

### 5.3 Home Screen (`mobile/app/(tabs)/index.tsx`)
- New section: "Popular Artists 🎤" between Header and Moods.
- Horizontal `ScrollView` of 70px circular avatar cards.
- Tap triggers `router.push('/artist/${encodeURIComponent(artist.name)}')`.


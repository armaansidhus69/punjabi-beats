# Music Catalogue: Artist & Album Detail Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dedicated Artist and Album detail screens (`/artist/[name]` and `/album/[id]`) with a Popular Artists carousel on the Home screen and interactive artist navigation.

**Architecture:** Client-side dynamic catalogue architecture leveraging existing multi-provider search chain (`searchSongs`) for immediate playback compatibility, paired with curated Punjabi artist metadata and pure core utilities for normalization, route slugification, and album grouping.

**Tech Stack:** React Native (Expo Router), TypeScript strict (no `any`), Zustand stores (`playerStore`, `likedSongsStore`), Axios.

**Spec:** `docs/superpowers/specs/2026-10-31-catalogue-artist-album-design.md`

## Global Constraints

- TypeScript strict mode — 0 errors on `npx tsc --noEmit`.
- ESLint with 0 warnings on `npm run lint`.
- All automated test suites must pass on `npm test`.
- Every user-facing action must include toast + haptic feedback (`utils/haptics.ts`).
- Hinglish comments and human-readable feedback matching the existing app conventions.
- No new server secrets or backend deployments required (100% client-driven catalog resolution).

## Review Focus

1. Encoded characters in artist routes (e.g., spaces, punctuation like "Diljit Dosanjh" or "G.O.A.T.") must decode cleanly without crashing.
2. Artists with 0 search hits must display a friendly Hinglish `EmptyState` without breaking layout or player queue.
3. Unlisted/unknown artists must render a clean fallback initial avatar and still dynamically load their playable songs.
4. "Play All" on artist/album screens must safely populate the player queue and start playing track #1.
5. Mini-player padding (`useMiniPlayerPadding`) must ensure the last song item is never obscured by the bottom player bar.

---

### Task 1: Data Models & Curated Artists Constants

**Files:**
- Modify: `mobile/types/index.ts:25-45`
- Create: `mobile/constants/artists.ts`

**Interfaces:**
- Produces: `ArtistSummary`, `AlbumSummary` in `mobile/types/index.ts`
- Produces: `POPULAR_ARTISTS: ArtistSummary[]` in `mobile/constants/artists.ts`

- [ ] **Step 1: Define `ArtistSummary` and `AlbumSummary` in `mobile/types/index.ts`**
- [ ] **Step 2: Create `mobile/constants/artists.ts` with top Punjabi artists data (names, avatars, bios, listener tags)**
- [ ] **Step 3: Verify TypeScript compiles without errors (`cd mobile && npx tsc --noEmit`)**
- [ ] **Step 4: Commit**
  ```bash
  git add mobile/types/index.ts mobile/constants/artists.ts
  git commit -m "feat(catalogue): define artist and album types and curated popular artists"
  ```

---

### Task 2: Pure Core Logic & Unit Tests

**Files:**
- Create: `mobile/core/catalogue/catalogue.ts`
- Create: `test-catalogue.mjs`
- Modify: `package.json:10-22`

**Interfaces:**
- Consumes: `ArtistSummary`, `AlbumSummary`, `Song`
- Produces: `normalizeArtistName(raw: string): string`
- Produces: `slugify(text: string): string`
- Produces: `matchCuratedArtist(query: string, list: ArtistSummary[]): ArtistSummary | null`
- Produces: `extractAlbumsFromSongs(songs: Song[]): AlbumSummary[]`

- [ ] **Step 1: Write failing unit test suite in `test-catalogue.mjs` covering normalization, slugification, artist matching, and album extraction**
- [ ] **Step 2: Run `node test-catalogue.mjs` to verify it fails initially**
- [ ] **Step 3: Implement pure functions in `mobile/core/catalogue/catalogue.ts`**
- [ ] **Step 4: Run `node test-catalogue.mjs` to verify all tests pass**
- [ ] **Step 5: Wire `test-catalogue.mjs` into `package.json`'s `npm test` script**
- [ ] **Step 6: Run `npm test` at root to verify entire suite passes**
- [ ] **Step 7: Commit**
  ```bash
  git add mobile/core/catalogue/catalogue.ts test-catalogue.mjs package.json
  git commit -m "feat(catalogue): implement core catalogue pure logic with unit tests"
  ```

---

### Task 3: Catalogue Service Layer

**Files:**
- Create: `mobile/services/catalogueService.ts`

**Interfaces:**
- Consumes: `searchSongs` from `mobile/services/musicApi.ts`, `POPULAR_ARTISTS` from `mobile/constants/artists.ts`
- Produces: `fetchArtistCatalogue(artistName: string): Promise<{ profile: ArtistSummary; songs: Song[]; albums: AlbumSummary[] }>`
- Produces: `fetchAlbumCatalogue(albumTitle: string, artistName?: string): Promise<{ album: AlbumSummary; songs: Song[] }>`

- [ ] **Step 1: Implement `catalogueService.ts` with caching and dynamic song resolution**
- [ ] **Step 2: Verify TypeScript strict compilation (`cd mobile && npx tsc --noEmit`)**
- [ ] **Step 3: Commit**
  ```bash
  git add mobile/services/catalogueService.ts
  git commit -m "feat(catalogue): add catalogue service for artist and album retrieval"
  ```

---

### Task 4: Artist Detail Screen (`/artist/[name]`)

**Files:**
- Create: `mobile/app/artist/[name].tsx`

**Interfaces:**
- Consumes: `useLocalSearchParams` from `expo-router`, `fetchArtistCatalogue` from `mobile/services/catalogueService.ts`, `usePlayer` from `mobile/stores/playerStore.ts`, `useLikedSongs` from `mobile/stores/likedSongsStore.ts`

- [ ] **Step 1: Create `mobile/app/artist/[name].tsx` with banner, avatar, bio, "Play All", songs FlatList, and mini-player safe padding**
- [ ] **Step 2: Verify route handling, empty states, and loading spinner**
- [ ] **Step 3: Check TypeScript strict compilation (`cd mobile && npx tsc --noEmit`)**
- [ ] **Step 4: Commit**
  ```bash
  git add mobile/app/artist/[name].tsx
  git commit -m "feat(catalogue): create dedicated artist detail screen route"
  ```

---

### Task 5: Album Detail Screen (`/album/[id]`)

**Files:**
- Create: `mobile/app/album/[id].tsx`

**Interfaces:**
- Consumes: `useLocalSearchParams` from `expo-router`, `fetchAlbumCatalogue` from `mobile/services/catalogueService.ts`, `usePlayer` from `mobile/stores/playerStore.ts`

- [ ] **Step 1: Create `mobile/app/album/[id].tsx` with album artwork, title, artist name, track count, "Play All", and tracklist**
- [ ] **Step 2: Check TypeScript strict compilation (`cd mobile && npx tsc --noEmit`)**
- [ ] **Step 3: Commit**
  ```bash
  git add mobile/app/album/[id].tsx
  git commit -m "feat(catalogue): create dedicated album detail screen route"
  ```

---

### Task 6: Home Screen Popular Artists Carousel & SongItem Navigation

**Files:**
- Modify: `mobile/components/SongItem.tsx`
- Modify: `mobile/app/(tabs)/index.tsx`

**Interfaces:**
- Consumes: `POPULAR_ARTISTS` from `mobile/constants/artists.ts`, `router.push`

- [ ] **Step 1: Add optional `onArtistPress?: (artist: string) => void` to `mobile/components/SongItem.tsx`**
- [ ] **Step 2: Add "Popular Artists 🎤" horizontal avatar carousel to `mobile/app/(tabs)/index.tsx` ListHeaderComponent**
- [ ] **Step 3: Wire navigation on artist avatar click to `/artist/${encodeURIComponent(artist.name)}`**
- [ ] **Step 4: Check TypeScript strict compilation and ESLint**
- [ ] **Step 5: Commit**
  ```bash
  git add mobile/components/SongItem.tsx mobile/app/(tabs)/index.tsx
  git commit -m "feat(home): add popular artists carousel and interactive song artist navigation"
  ```

---

### Task 7: Quality Gates, Checklists & Push

**Files:**
- Modify: `mobile/docs/CHECKLIST.md`

- [ ] **Step 1: Run `npm test` across all suites**
- [ ] **Step 2: Run `cd mobile && npx tsc --noEmit` (0 errors)**
- [ ] **Step 3: Run `cd mobile && npm run lint` (0 warnings)**
- [ ] **Step 4: Update `mobile/docs/CHECKLIST.md` and recalculate totals**
- [ ] **Step 5: Export and deploy web build to Expo Web hosting**
- [ ] **Step 6: Push commit to GitHub `origin/main`**


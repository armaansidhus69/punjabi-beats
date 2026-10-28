# Punjabi Beats — Midnight Bazaar UI Redesign

## Status

Design approved in chat on October 23, 2026. This document defines the visual
direction and implementation boundaries before code changes begin.

## Goal

Give Punjabi Beats a stronger, more polished listening experience inspired by
the useful interaction patterns of leading music apps, especially persistent
playback, dense song lists, browse/search/library separation, and queue
awareness—without copying Spotify's branding, typography, component layouts, or
visual identity.

The redesign must preserve existing behavior: Expo Router navigation, search,
mood browsing, playlists, TrackPlayer playback, mini/full player behavior,
room sync, room chat, and provider-specific song states.

## Product personality

Punjabi Beats should feel like a late-night Punjabi music bazaar: deep indigo
structure, warm saffron playback energy, colorful album art, and small signals
of social presence when friends are listening together.

The memorable visual element is a branded listening ribbon: the persistent
mini-player uses a strong progress edge, compact artwork, and clear playback
controls. It should feel like Punjabi Beats' own listening surface, not a copy
of another service's player bar.

## Visual system

### Color tokens

| Token | Value | Role |
|---|---|---|
| Ink | `#0B1020` | Main background |
| Night panel | `#151C31` | Navigation, mini-player, secondary surfaces |
| Raised panel | `#202A45` | Active rows, playlist tiles, elevated surfaces |
| Saffron | `#FFB454` | Primary actions and playback controls |
| Gulabi | `#FF6E8A` | Chat, room activity, social emphasis |
| Mint | `#8FE3C0` | Connected and successful states |
| Fog | `#E7ECF5` | Primary text |
| Muted blue | `#95A0B7` | Secondary text |
| Line | `#2B3755` | Dividers and subtle borders |

Saffron remains the primary action color. Gulabi and Mint communicate meaning
and should not become competing primary buttons. Album artwork remains the main
source of visual variety.

### Typography

Keep the portable system font and avoid adding a font dependency for this pass.

- Screen title: approximately 30px, bold, slightly tightened tracking.
- Section title: approximately 20px, bold.
- Song title: approximately 15px, semibold.
- Artist/supporting text: approximately 13px.
- Metadata and control labels: approximately 12px.
- Use sentence case for user-facing labels. Avoid decorative all-caps labels.

### Shape and spacing

- Main surfaces: radius 18.
- Song rows: radius 12 only when an active or selected state needs a surface.
- Primary actions: pill shape.
- Lists: prefer hairline dividers and spacing over stacked cards.
- Use larger section gaps, approximately 20–28px, to establish hierarchy.
- Preserve touch targets and accessibility hit areas even when visual controls
  become smaller.

## Screen design

### Home

Use a compact branded header, an immediately actionable mood area, and a dense
trending feed. Avoid a large generic hero block. Mood cards should retain their
existing navigation but receive distinct accent colors. The currently playing
song or first featured item may receive the strongest listening-ribbon treatment.

### Search

Make the search field the primary focus. Keep recent searches visible when the
screen is idle. Reduce filter-chip prominence and keep results dense. Preview,
full-song, and YouTube states remain visible as secondary metadata and must not
compete with song title or artist text.

### Library

Turn playlists into visually recognizable collections using compact two-column
tiles on the Library screen, falling back to a single-column layout on narrow
screens. Use generated color/artwork treatment when no artwork exists. Keep
create-playlist, persistence, detail navigation, and empty-state actions
unchanged.

### Room

Make the room code the visual anchor. Group the code, host/member state, and
connection status in one clear presence surface. Show the current shared song,
shared queue, chat action, and listener count as first-class room information.
Use Mint for connected state, Saffron for host/action emphasis, and Gulabi for
chat/unread activity. Do not communicate connection state through color alone.

### Full player

Use an art-first composition with generous space around the album artwork and
playback controls. Keep progress, elapsed time, remaining time, volume,
shuffle, repeat, preview status, and YouTube link-out behavior. Preview status
should read as calm supporting information rather than an error banner.

### Persistent mini-player

Keep the mini-player above the tab bar and preserve its tap-to-open behavior.
Make it the strongest shared component: artwork, title, artist, progress edge,
play/pause, and next should remain legible without covering content. Maintain
safe-area and tab-bar offsets already handled by the root layout.

## Navigation and interaction principles

- Retain the four existing destinations: Home, Search, Library, Room.
- Use Spotify-like information architecture only where it improves discoverability:
  browse, search, saved content, and persistent playback.
- Keep Group Room prominent because synchronized listening is Punjabi Beats'
  product differentiator.
- Do not change route names, store contracts, playback behavior, room lifecycle,
  or data persistence as part of the visual redesign.
- Preserve accessibility labels, roles, selected states, and touch hit slop.
- Keep motion limited to user-triggered transitions and existing player motion.

## Implementation scope

First update shared tokens and shared components:

- `mobile/constants/colors.ts`
- `mobile/constants/typography.ts`
- `mobile/constants/spacing.ts`
- `mobile/constants/theme.ts`
- `mobile/components/SongItem.tsx`
- `mobile/components/MiniPlayer.tsx`
- `mobile/components/PlayerControls.tsx`
- `mobile/components/ProgressBar.tsx`
- `mobile/components/PlaylistRow.tsx`
- `mobile/components/EmptyState.tsx`

Then apply those tokens to the main routes:

- `mobile/app/(tabs)/index.tsx`
- `mobile/app/(tabs)/search.tsx`
- `mobile/app/(tabs)/library.tsx`
- `mobile/app/(tabs)/room.tsx`
- `mobile/app/player.tsx`
- `mobile/app/room/[code].tsx`
- `mobile/app/mood/[id].tsx`
- `mobile/app/playlist/[id].tsx`

No new product dependencies are planned for this redesign.

## Non-goals

- No Spotify branding, assets, copied layout, or copied component styling.
- No navigation rewrite.
- No playback/provider refactor.
- No room-sync protocol changes.
- No new authentication, cloud database, or account system.
- No speculative animation system.

## Validation criteria

- All existing routes still open and navigate correctly.
- Home, Search, Library, Room, Mood, Playlist, and Player share the same token
  system.
- The mini-player remains above the tab bar and does not hide actionable content.
- Active, pressed, disabled, preview-only, connected, host, unread, empty, and
  error states remain visually distinguishable.
- Accessibility labels and roles remain intact.
- The UI remains usable on narrow and wide mobile screens.
- Existing project lint, typecheck, and tests pass after implementation.

# 📝 Punjabi Beats — Requirements Specification

## 1. Functional Requirements

### FR-1: Music Search
| ID | Requirement | Priority |
|---|---|---|
| FR-1.1 | User can search songs by name | P0 |
| FR-1.2 | User can search by artist name | P0 |
| FR-1.3 | Search returns up to 100 results | P0 |
| FR-1.4 | Open-source JioSaavn API primary; Audius + iTunes (`country=IN`) fallbacks | P0 |
| FR-1.5 | Empty search shows helpful message | P1 |
| FR-1.6 | Recent searches saved (last 10) | P2 |

### FR-2: Music Playback
| ID | Requirement | Priority |
|---|---|---|
| FR-2.1 | User can play any song from list | P0 |
| FR-2.2 | User can pause current song | P0 |
| FR-2.3 | User can skip to next song | P0 |
| FR-2.4 | User can go to previous song | P0 |
| FR-2.5 | User can seek to any position | P0 |
| FR-2.6 | Progress bar shows current time | P0 |
| FR-2.7 | Song auto-plays next when finished | P0 |
| FR-2.8 | Audio quality is 320kbps when available | P1 |
| FR-2.9 | Shuffle mode available | P2 |
| FR-2.10 | Repeat one / repeat all modes | P2 |
| FR-2.11 | Volume control slider | P2 |

### FR-3: Mood Playlists
| ID | Requirement | Priority |
|---|---|---|
| FR-3.1 | 8 mood cards displayed on home | P0 |
| FR-3.2 | Each mood loads relevant songs | P0 |
| FR-3.3 | Moods: Romantic, Sad, Bhangra, Party, Folk, Sufi, Old, Trending | P0 |
| FR-3.4 | Clicking mood opens song list | P0 |

### FR-4: Personal Playlists
| ID | Requirement | Priority |
|---|---|---|
| FR-4.1 | User can create new playlist | P0 |
| FR-4.2 | User can name playlist | P0 |
| FR-4.3 | User can add songs to playlist | P0 |
| FR-4.4 | User can delete playlist | P0 |
| FR-4.5 | User can remove song from playlist | P1 |
| FR-4.6 | Playlists persist after app restart | P0 |
| FR-4.7 | Duplicate songs not allowed in same playlist | P0 |
| FR-4.8 | Playlist shows song count | P1 |

### FR-5: Group Room
| ID | Requirement | Priority |
|---|---|---|
| FR-5.1 | User can create room with 6-digit code | P0 |
| FR-5.2 | User can join room with code | P0 |
| FR-5.3 | Song change syncs to all users | P0 |
| FR-5.4 | Play/pause syncs to all users | P0 |
| FR-5.5 | Seek syncs to all users | P0 |
| FR-5.6 | Room indicator shows host/joined | P0 |
| FR-5.7 | User can leave room | P0 |
| FR-5.8 | Connection status visible | P1 |
| FR-5.9 | Auto-reconnect on network drop | P1 |
| FR-5.10 | Show online users (presence) | P2 |
| FR-5.11 | User names when joining | P2 |
| FR-5.12 | Chat in room | P3 |

---

### FR-6: Player UI
| ID | Requirement | Priority |
|---|---|---|
| FR-6.1 | Mini player visible on all screens | P0 |
| FR-6.2 | Mini player shows current song info | P0 |
| FR-6.3 | Tap mini player → full screen | P0 |
| FR-6.4 | Full player shows large album art | P0 |
| FR-6.5 | Full player has all controls | P0 |
| FR-6.6 | Swipe down to close full player | P1 |
| FR-6.7 | Album art rotates when playing | P2 |

### FR-7: Sharing
| ID | Requirement | Priority |
|---|---|---|
| FR-7.1 | User can share song link | P2 |
| FR-7.2 | User can share playlist | P2 |
| FR-7.3 | Share via WhatsApp/Telegram/etc | P2 |

### FR-8: History
| ID | Requirement | Priority |
|---|---|---|
| FR-8.1 | Track recently played songs | P2 |
| FR-8.2 | Show last 20 songs | P2 |
| FR-8.3 | Tap to replay | P2 |

### FR-9: Podcasts *(Phase 12a — production roadmap se add; original v1 out-of-scope revise)*
| ID | Requirement | Priority |
|---|---|---|
| FR-9.1 | User can search podcast shows and episodes (iTunes, IN store) | P1 |
| FR-9.2 | Show page lists full episodes (RSS enclosure / lookup fallback) | P1 |
| FR-9.3 | User can play full episode (no 30s preview limit) | P1 |
| FR-9.4 | Continue listening — resume position persists (local) | P1 |
| FR-9.5 | Played state (≥95% or sticky) shows on episode rows | P2 |
| FR-9.6 | User can save/unsave shows (local, guest-compatible) | P2 |
| FR-9.7 | Feature gated behind `podcasts_enabled` flag (default off) | P1 |

### FR-10: Play Signals / Data Foundation *(Phase 13a — production roadmap; local-only, guest-compatible)*
| ID | Requirement | Priority |
|---|---|---|
| FR-10.1 | Track play start / complete / skip signals (95%+ = complete, <80% manual = skip) | P1 |
| FR-10.2 | Like/unlike + playlist add/remove taste signals | P2 |
| FR-10.3 | Search queries (≥2 chars) recorded as seed tally | P2 |
| FR-10.4 | Remote (room-follow) plays excluded from taste stats | P1 |
| FR-10.5 | Ledger capped (1000), versioned, guest-compatible local storage | P1 |
| FR-10.6 | Derived raw counters + consumer-time weights (`tasteSongScore`/`artistStats`) for 13b | P1 |

---

## 2. Non-Functional Requirements

### NFR-1: Performance
| ID | Requirement | Target |
|---|---|---|
| NFR-1.1 | App launch time | < 2 seconds |
| NFR-1.2 | Search response time | < 1.5 seconds |
| NFR-1.3 | Audio start delay | < 2 seconds |
| NFR-1.4 | Group sync latency | < 200ms |
| NFR-1.5 | Screen transitions | 60 FPS |
| NFR-1.6 | Memory usage | < 200MB |

### NFR-2: Compatibility
| ID | Requirement | Target |
|---|---|---|
| NFR-2.1 | Android minimum | Android 8.0 (API 26) |
| NFR-2.2 | iOS minimum | iOS 13.0 |
| NFR-2.3 | Screen sizes | 4.7" to 7" |
| NFR-2.4 | Orientation | Portrait only |
| NFR-2.5 | Network | WiFi + 4G + 5G |

### NFR-3: Reliability
| ID | Requirement | Target |
|---|---|---|
| NFR-3.1 | Crash-free sessions | > 99% |
| NFR-3.2 | API failure fallback | 100% |
| NFR-3.3 | Auto-reconnect | Within 5s |
| NFR-3.4 | Data persistence | Forever |

### NFR-4: Security
| ID | Requirement | Target |
|---|---|---|
| NFR-4.1 | API secrets server-side only | Required |
| NFR-4.2 | HTTPS only | Required |
| NFR-4.3 | No user data collection | Required |
| NFR-4.4 | No third-party tracking | Required |

### NFR-5: Usability
| ID | Requirement | Target |
|---|---|---|
| NFR-5.1 | Learning curve | < 1 minute |
| NFR-5.2 | Onboarding screens | 0 (direct use) |
| NFR-5.3 | Login required | No |
| NFR-5.4 | Dark theme default | Yes |
| NFR-5.5 | Accessibility | WCAG AA |

### NFR-6: Size
| ID | Requirement | Target |
|---|---|---|
| NFR-6.1 | APK size | < 50MB |
| NFR-6.2 | iOS IPA size | < 80MB |
| NFR-6.3 | Install size | < 100MB |

---

## 3. Constraints

| Constraint | Details |
|---|---|
| **Budget** | ₹0 — sirf free services |
| **Timeline** | 3 weeks part-time |
| **Team** | 1 developer |
| **Backend** | Serverless only (no server maintenance) |
| **Database** | Local storage only (no cloud DB) |
| **Login** | No login required |
| **Monetization** | None (personal project) |

---

## 4. Out of Scope (NOT building)

- ❌ User accounts / login
- ❌ Cloud sync across devices
- ❌ Offline download
- ❌ Lyrics display
- ❌ Equalizer
- ❌ Video content
- ❌ Social features (comments, likes)
- ❌ Ads
- ❌ Payment

> **Update (Phase 12a, 2026-10-29):** Podcasts production roadmap se Phase 12
> me aaye — original out-of-scope revise hua (FR-9 dekho). Scope sirf core
> listening (local-only, flag-gated); comments/polls/transcripts/download
> abhi bhi nahi bane.

---

## 5. Assumptions

1. User has internet connection (WiFi or mobile data)
2. Open-source JioSaavn API ka public host available rahega; production deployments apna MIT-licensed instance self-host kar sakte hain
3. Apinator free tier is sufficient
4. User's phone supports audio playback
5. User knows at least one Punjabi song name

---

## 6. Acceptance Criteria

### AC-1: Core App Works
- ✅ App opens without crash
- ✅ Home screen loads with moods + trending
- ✅ Search returns songs in < 2s

### AC-2: Player Works
- ✅ Song plays when tapped
- ✅ Pause/play works
- ✅ Next/prev works
- ✅ Seek works
- ✅ Auto-next works

### AC-3: Playlists Work
- ✅ Create playlist
- ✅ Add song
- ✅ Delete playlist
- ✅ Persists after restart

### AC-4: Group Room Works
- ✅ Create room
- ✅ Join room
- ✅ Song sync works
- ✅ Play/pause sync works

### AC-5: Quality
- ✅ 0 TypeScript errors
- ✅ 0 console warnings
- ✅ APK < 50MB
- ✅ Works on Android 8+

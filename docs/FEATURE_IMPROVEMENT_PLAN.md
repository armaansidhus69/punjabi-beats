# Punjabi Beats — Feature Improvement Plan

Updated: 2026-11-02

## User ko simple explanation

Punjabi Beats ka next update ka main goal hai: **app fast, reliable, easy aur
sirf full songs wali music app banana**.

### Abhi complete update

- Search aur home feeds me 30-second preview songs nahi dikhte.
- Player aur queue sirf full-song streams accept karte hain.
- Full stream na mile to song silently skip hota hai; wrong ya short audio nahi
  bajta.
- YouTube iframe/link-out fallback remove hai.
- Search list, mini-player aur full player me preview badge/preview duration
  logic remove hai.
- Search tabs ab compact horizontal hain; Songs, Artists, Albums aur Playlists ke
  counts independent hain, duplicate rows remove hote hain, aur album metadata
  available hone par real album results dikhte hain.
- Search failures ke liye retry state hai, aur category/source filters mobile
  width par horizontal scroll karte hain bina content clip kiye.
- Background playback, queue, shuffle, repeat, seek aur volume existing hain.
- Selected track pehle start hota hai; large queues ke upcoming tracks bounded
  background hydration se load hote hain, aur metadata-only tracks active hone
  tak provider resolution ko block nahi karte.

## Priority plan

### Phase 1 — Playback ko aur reliable banana (P0)

**User ko benefit:** Song tap karne par correct full song chalega aur playback
beech me confuse nahi hoga.

- Full stream resolve hone tak clear loading state dikhana. **Code complete; device
  verification pending.**
- Full stream unavailable ho to friendly toast: “Full song available nahi hai”.
- Queue me unavailable songs ko add hone se pehle reject karna.
- Multiple fast taps par ek hi song play hona. **Code complete; device verification
  pending.**
- App restart ke baad current song, queue aur position restore karna.
- Android lock screen, notification controls aur background playback verify karna.

**Done when:** player tests green, no 30s fallback, no wrong-song audio, aur
real device par play/pause/next/previous/seek reliable ho.

### Phase 2 — Better home aur search (P0)

**User ko benefit:** User ko jaldi achhe Punjabi songs milenge.

- Search results me source quality aur full-song availability clear rakhna.
- Search loading ke liye better skeleton UI.
- Recent searches ko clean/manage karna.
- Artist aur album result pages se direct “Play all” aur “Radio”.
- New Songs aur Trending sections ko separate queue dena.
- Empty/error screen me simple retry button aur useful message.

**Done when:** slow network, empty search aur provider failure me app blank ya
crash nahi hoti.

### Phase 3 — Queue aur library improvements (P1)

**User ko benefit:** Apni listening ko easily manage aur save kar paayega.

- Queue me drag-and-drop reorder.
- “Play next”, remove aur clear actions ko clearer banana.
- Queue ko playlist ke roop me save karna.
- Playlist me full-song validation.
- Liked songs, recently played aur playlists ke liye better empty states.
- Downloads ke liye Wi-Fi-only option aur pause/resume.

**Done when:** queue changes player aur TrackPlayer dono me same order me dikhen,
aur restart ke baad library safe rahe.

### Phase 4 — Player UI polish (P1)

**User ko benefit:** Player simple, premium aur samajhne me easy lagega.

- Artwork loading placeholder aur broken-image fallback.
- Progress bar ko touch-friendly banana.
- Current source aur audio quality ko short, clear label me dikhana.
- Sleep timer aur Radio actions ko discoverable banana.
- Dark Dhol Sunset theme ko home, search, library aur room screens par consistent
  karna.
- Accessibility labels, contrast aur larger touch targets verify karna.

**Done when:** phone-size screens par text cut-off, overlapping buttons ya low
contrast controls nahi honge.

### Phase 5 — Rooms aur social listening (P1)

**User ko benefit:** Friends ke saath music sync aur room management better hoga.

- Host disconnect hone par co-host promotion.
- Owner, co-host, moderator aur listener permissions ko clear UI me dikhana.
- Connection lost/reconnected banner.
- Large listening party ke liye read-only audience mode.
- Chat reactions, block/report aur room moderation polish.
- Room queue changes ka confirmation aur error feedback.

**Done when:** 2–3 devices par song, pause, seek aur queue sync stable rahe.

### Phase 6 — Personalisation aur discovery (P2)

**User ko benefit:** App user ke taste ke hisaab se music suggest karega.

- Made for You section ko better artist/song ranking dena.
- “Because you listened to…” explanation.
- Mood aur artist radio improvements.
- AI playlist me only playable full songs.
- AI assistant ke play, pause, next aur queue commands ko safer confirmations
  ke saath run karna.

**Done when:** recommendations repeat na hon, unavailable tracks na aayen, aur
user ke recent activity ke bina fake recommendations na dikhengi.

## Release quality checklist

Before next release:

- [x] `cd mobile && npx tsc --noEmit`
- [x] `cd mobile && npm run lint`
- [x] `npm test`
- [x] `npx expo-doctor`
- [x] Web production export succeeds
- [ ] Android device: full-song play, pause, next, seek, background audio
- [ ] Android device: unavailable/preview source skip behaviour
- [ ] Two-device room sync smoke test
- [ ] Search, home, playlist and player visual check
- [ ] Production environment variables verified

## Recommended implementation order

1. Finish real-device playback verification.
2. Add clear loading/error states around full-stream resolution.
3. Polish search/home and player UI.
4. Improve queue, downloads and library flows.
5. Harden rooms and social features.
6. Improve recommendations and AI features.

## Product rule

**Punjabi Beats me user ko sirf full-song playback milega.** Metadata-only,
preview-only, broken ya unavailable audio ko player me play nahi kiya jayega.

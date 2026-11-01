/**
 * youtubeLink.ts — 30s preview wale gaane ke liye "YouTube pe full version dekho".
 *
 * ⚠️ KYUM link-out, WebView player nahi (2026-10-05 decision):
 *   YouTube IFrame embed (WebView) se audio lene ka try kiya gaya, par ye
 *   REJECT kiya gaya 3 wajah se:
 *     1. `roomSync` ka core invariant TODTI hai — protocol ka design hai ki
 *        "sab devices SAME audio URL, SAME position pe chale". Per-device source
 *        select karne se ek phone pe 30s preview (30_000ms) aur doosre pe full
 *        song (162_000ms) chale — position math bekaar, aur WebView phone lock
 *        hote hi mar jaata hai → room PERMANENTLY desync (recovery nahi).
 *     2. Background play + notification controls WebView me nahi hote — app ka
 *        existing TrackPlayer setup dono provide karta hai.
 *     3. TrackPlayer me `url: ''` wale (YouTube) rows daalne se `PlaybackError`
 *        → auto-skip storm (playerStore.ts `Event.PlaybackError` handler).
 *
 *   Isliye YouTube = DISCOVERY + LINK-OUT. Playback hamesha TrackPlayer
 *   (direct audio URL) se. `songMatch.ts` ka scoring + safety gate (70/40
 *   thresholds, reject-list, title-gate) YAHAN reuse hota hai — matlab galat
 *   video pe link nahi khulega.
 */
import { Linking } from 'react-native';
import Toast from 'react-native-toast-message';
import type { Song } from '../types';
import { createRemoteSearchFn, findYouTubeAudio } from '../services/youtubeAudio';
import { tapFeedback, warningFeedback } from './haptics';

/** Backend ROOT url — `createRemoteSearchFn` khud `/api/youtube-match` jodta hai */
const MATCH_URL = process.env.EXPO_PUBLIC_YOUTUBE_MATCH_URL ?? '';

/** .env.example placeholder chhoda hua ho to feature gracefully chhup jaata hai */
function isPlaceholder(value: string): boolean {
  return value.length === 0 || /YOUR-|YAHAN_/i.test(value);
}

/** Link-out button dikhana hai ya nahi (env configured hai?) */
export function isYouTubeMatchConfigured(): boolean {
  return !isPlaceholder(MATCH_URL);
}

/** Fallback: match na mile to plain YouTube search results kholo (best effort) */
export function openYouTubeSearch(song: Song): void {
  const q = encodeURIComponent(`${song.title} ${song.artist}`);
  void Linking.openURL(`https://www.youtube.com/results?search_query=${q}`).catch(() => {
    Toast.show({ type: 'error', text1: 'YouTube nahi khul paya' });
  });
}

/**
 * Preview-only gaane ko YouTube pe full version ke liye kholo.
 *
 * Flow: backend se scored candidates → safety gate (exact/partial) →
 * winner videoId ka link. `unavailable` pe honest search-results fallback.
 *
 * @returns true agar exact/partial match khula, false par fallback khula.
 */
/**
 * Match metadata to best YouTube candidate videoId.
 * Used for In-App YouTube playback.
 */
export async function resolveYouTubeMatch(song: Song) {
  if (!isYouTubeMatchConfigured()) return null;

  try {
    const result = await findYouTubeAudio(song, createRemoteSearchFn(MATCH_URL));
    if (result.status !== 'unavailable' && result.videoId) {
      return result;
    }
    // Fallback: direct candidate query
    const candidates = await createRemoteSearchFn(MATCH_URL)(`${song.artist} - ${song.title}`, 3);
    if (candidates[0]?.videoId) {
      return {
        status: 'partial' as const,
        videoId: candidates[0].videoId,
        title: candidates[0].title,
        channel: candidates[0].channel,
        candidatesConsidered: candidates.length,
      };
    }
  } catch (err) {
    console.warn('[youtubeLink] resolveMatch fail:', err);
  }
  return null;
}

export async function openOnYouTube(song: Song): Promise<boolean> {
  if (!isYouTubeMatchConfigured()) {
    warningFeedback();
    Toast.show({ type: 'error', text1: 'YouTube match setup nahi hai' });
    openYouTubeSearch(song);
    return false;
  }

  try {
    const result = await findYouTubeAudio(song, createRemoteSearchFn(MATCH_URL));
    // Safety gate: exact ya partial hi link kholega. `unavailable` ka matlab
    // koi candidate title/artist/duration gate pass nahi kiya — us video pe
    // jaana galat audio chala dega, isliye plain search kholte hain.
    if (result.status !== 'unavailable' && result.videoId) {
      await Linking.openURL(`https://www.youtube.com/watch?v=${result.videoId}`);
      return true;
    }
    openYouTubeSearch(song);
    return false;
  } catch (err) {
    console.warn('[youtubeLink] match fail:', err);
    openYouTubeSearch(song);
    return false;
  }
}

/** SongItem ke ▶ YouTube button ka handler (haptic ke saath) */
export function handleOpenOnYouTube(song: Song): void {
  if (song.previewOnly !== true) return;
  tapFeedback();
  void openOnYouTube(song);
}

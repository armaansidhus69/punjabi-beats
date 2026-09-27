/**
 * 8 mood cards — ye queries probe-moods.mjs + probe-moods2.mjs (v4) se iTunes
 * IN store pe live test ki gayi hain: har mood relevant Punjabi results deta
 * hai aur har result me previewUrl (playable) hota hai.
 *
 * Probe se seekha: artist-based queries generic keyword queries se BAHUT
 * better hain ("punjabi sufi" -> AP Dhillon/Diljit mix, lekin "Satinder Sartaaj"
 * -> pure sufi; "punjabi party" -> Bollywood compilations, lekin "Diljit party"
 * -> saare Punjabi party tracks).
 */
import { Mood } from '../types';

export const MOODS: Mood[] = [
  { id: 'romantic', title: 'Romantic', emoji: '💕', query: 'punjabi romantic', color: '#ff6b9d' },
  { id: 'sad', title: 'Sad', emoji: '💔', query: 'sad punjabi', color: '#5a6acf' },
  // Bhangra/Party/Sufi me artist queries (probe-verified: generic keywords Bollywood mix de dete hain)
  { id: 'bhangra', title: 'Bhangra', emoji: '🕺', query: 'Jazzy B', color: '#ff9500' },
  { id: 'party', title: 'Party', emoji: '🎉', query: 'Diljit party', color: '#ff3b6b' },
  { id: 'folk', title: 'Folk', emoji: '🚜', query: 'punjabi folk', color: '#7cb342' },
  { id: 'sufi', title: 'Sufi', emoji: '🌙', query: 'Satinder Sartaaj', color: '#8e44ad' },
  { id: 'old', title: 'Old Is Gold', emoji: '🎤', query: 'Gurdas Maan', color: '#c9a227' },
  { id: 'trending', title: 'Trending', emoji: '🔥', query: 'punjabi hits', color: '#e74c3c' },
];

/** id se mood dhundo — mood/[id] route ke liye */
export function getMoodById(id: string): Mood | undefined {
  return MOODS.find(m => m.id === id);
}
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
  {
    id: 'romantic',
    title: 'Romantic',
    punjabi: 'ਰੋਮਾਂਟਿਕ',
    emoji: '💕',
    query: 'punjabi romantic',
    color: '#ff6b9d',
    note: 'Slow verses, wedding-lawn choruses',
  },
  {
    id: 'sad',
    title: 'Sad',
    punjabi: 'ਉਦਾਸ',
    emoji: '💔',
    query: 'sad punjabi',
    color: '#5a6acf',
    note: 'Rain on the windshield songs',
  },
  // Bhangra/Party/Sufi me artist queries (probe-verified: generic keywords Bollywood mix de dete hain)
  {
    id: 'bhangra',
    title: 'Bhangra',
    punjabi: 'ਭੰਗੜਾ',
    emoji: '🕺',
    query: 'Jazzy B',
    color: '#ff9500',
    note: 'Dhol first, questions later',
  },
  {
    id: 'party',
    title: 'Party',
    punjabi: 'ਪਾਰਟੀ',
    emoji: '🎉',
    query: 'Diljit party',
    color: '#ff3b6b',
    note: 'Bass that finds the cousins',
  },
  {
    id: 'folk',
    title: 'Folk',
    punjabi: 'ਲੋਕ',
    emoji: '🚜',
    query: 'punjabi folk',
    color: '#7cb342',
    note: 'Fields, fairs, and old refrains',
  },
  {
    id: 'sufi',
    title: 'Sufi',
    punjabi: 'ਸੂਫ਼ੀ',
    emoji: '🌙',
    query: 'Satinder Sartaaj',
    color: '#8e44ad',
    note: 'Night-drive devotionals',
  },
  {
    id: 'old',
    title: 'Old Is Gold',
    punjabi: 'ਪੁਰਾਣੇ',
    emoji: '🎤',
    query: 'Gurdas Maan',
    color: '#c9a227',
    note: 'The radio your parents still quote',
  },
  {
    id: 'trending',
    title: 'Trending',
    punjabi: 'ਟ੍ਰੈਂਡਿੰਗ',
    emoji: '🔥',
    query: 'punjabi hits',
    color: '#e74c3c',
    note: 'What the group chat is looping',
  },
];

/** id se mood dhundo — mood/[id] route ke liye */
export function getMoodById(id: string): Mood | undefined {
  return MOODS.find(m => m.id === id);
}
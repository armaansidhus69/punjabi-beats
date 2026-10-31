/**
 * Procedural Audio Synthesis & Waveform Engine
 *
 * Provides deterministic audio visualizer waveform generation and
 * procedural stereo synth blueprints for live collaborative jam sessions.
 * Pure logic — headless & cross-platform safe.
 */

export interface JamBlueprint {
  id: string;
  title: string;
  artist: string;
  genre: string;
  bpm: number;
  musicalKey: string;
  durationMs: number;
  coverGradient: [string, string, string];
  accentHex: string;
  rootMidi: number;
  chordProgression: number[][];
  melodyPattern: number[];
  bassPattern: number[];
  drumStyle: 'four_on_floor' | 'lofi_boom' | 'breakbeat' | 'trap_halftime';
  waveformSeed: number;
}

export const JAM_CATALOG_TRACKS: JamBlueprint[] = [
  {
    id: 'midnight-neon-express',
    title: 'Midnight Neon Express',
    artist: 'Kiran & The Phase-Locks',
    genre: 'Synthwave / Nu-Disco',
    bpm: 118,
    musicalKey: 'F# Minor',
    durationMs: 56000,
    coverGradient: ['#7C3AED', '#EC4899', '#06B6D4'],
    accentHex: '#8B5CF6',
    rootMidi: 54,
    chordProgression: [
      [0, 3, 7, 10],
      [8, 12, 15, 19],
      [3, 7, 10, 14],
      [10, 14, 17, 21],
    ],
    melodyPattern: [12, -1, 15, 14, 12, -1, 10, 7, 12, 14, 15, 19, 17, -1, 15, 14],
    bassPattern: [0, 0, 12, 0, 8, 8, 20, 8, 3, 3, 15, 3, 10, 10, 22, 10],
    drumStyle: 'four_on_floor',
    waveformSeed: 101,
  },
  {
    id: 'lahore-monsoon-lofi',
    title: 'Monsoon Rooftop 2AM',
    artist: 'Noor Beats × Chai Tape',
    genre: 'Desi Lo-Fi Chillhop',
    bpm: 86,
    musicalKey: 'D Minor',
    durationMs: 60000,
    coverGradient: ['#0EA5E9', '#6366F1', '#14B8A6'],
    accentHex: '#06B6D4',
    rootMidi: 50,
    chordProgression: [
      [0, 3, 7, 10],
      [5, 9, 12, 16],
      [10, 14, 17, 21],
      [7, 10, 14, 17],
    ],
    melodyPattern: [12, 14, 15, -1, 19, 17, 15, 14, 12, -1, 10, 12, 14, -1, 9, -1],
    bassPattern: [0, -1, 0, 7, 5, -1, 5, 12, 10, -1, 10, 5, 7, -1, 7, 3],
    drumStyle: 'lofi_boom',
    waveformSeed: 204,
  },
  {
    id: 'sub-zero-drift',
    title: 'Zero Drift Protocol',
    artist: 'NTP Collective',
    genre: 'Melodic Techno',
    bpm: 126,
    musicalKey: 'C Minor',
    durationMs: 54000,
    coverGradient: ['#10B981', '#06B6D4', '#3B82F6'],
    accentHex: '#10B981',
    rootMidi: 48,
    chordProgression: [
      [0, 3, 7, 12],
      [8, 12, 15, 20],
      [5, 8, 12, 17],
      [7, 11, 14, 19],
    ],
    melodyPattern: [12, 15, 19, 15, 12, 15, 20, 19, 12, 15, 17, 15, 14, 11, 7, 11],
    bassPattern: [0, 0, 0, 12, 8, 8, 8, 20, 5, 5, 5, 17, 7, 7, 7, 19],
    drumStyle: 'four_on_floor',
    waveformSeed: 309,
  },
  {
    id: 'velvet-rickshaw-dub',
    title: 'GT Road Bassline',
    artist: 'Ustad Sub & DJ Zara',
    genre: 'UKG / Indo-Bass',
    bpm: 132,
    musicalKey: 'G Minor',
    durationMs: 52000,
    coverGradient: ['#F59E0B', '#EF4444', '#8B5CF6'],
    accentHex: '#F59E0B',
    rootMidi: 43,
    chordProgression: [
      [12, 15, 19, 22],
      [10, 14, 17, 21],
      [8, 12, 15, 19],
      [10, 14, 17, 22],
    ],
    melodyPattern: [24, -1, 27, 26, -1, 22, 24, -1, 19, 22, 24, 27, 26, -1, 22, 19],
    bassPattern: [0, -1, 12, 0, 10, -1, 10, -1, 8, -1, 20, 8, 10, 10, 7, 10],
    drumStyle: 'breakbeat',
    waveformSeed: 415,
  },
];

/**
 * Generates deterministic visualizer waveform bar heights (normalized 0.18 - 1.0)
 * given a seed number and bar count.
 */
export function generateDeterministicWaveformBars(seed: number, count = 36): number[] {
  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    const v1 = Math.abs(Math.sin(seed * 0.73 + i * 0.41));
    const v2 = Math.abs(Math.cos(seed * 0.29 + i * 0.19));
    const envelope = Math.sin((i / Math.max(1, count - 1)) * Math.PI) * 0.35 + 0.65;
    const height = Math.max(0.18, Math.min(1.0, (v1 * 0.58 + v2 * 0.42) * envelope));
    bars.push(Number(height.toFixed(3)));
  }
  return bars;
}


/**
 * 5-Band Acoustic Equalizer Presets & Tuning (Phase 5 / IMP-02).
 * Specially calibrated for Punjabi folk, modern basslines, tumbi snaps, and Sufi acoustics.
 */

export type EqPresetId =
  | 'flat'
  | 'bhangra_bass'
  | 'sufi_vocal'
  | 'late_night'
  | 'gym_pump';

export interface EqPreset {
  id: EqPresetId;
  label: string;
  subtitle: string;
  lowGainDb: number;
  midGainDb: number;
  highGainDb: number;
}

export const EQ_PRESETS: EqPreset[] = [
  {
    id: 'flat',
    label: 'Studio Flat',
    subtitle: 'Pure 320kbps master reproduction',
    lowGainDb: 0,
    midGainDb: 0,
    highGainDb: 0,
  },
  {
    id: 'bhangra_bass',
    label: 'Bhangra Dhol',
    subtitle: '+6dB sub-bass punch & tumbi snap',
    lowGainDb: 6,
    midGainDb: 1,
    highGainDb: 3,
  },
  {
    id: 'sufi_vocal',
    label: 'Sufi Warmth',
    subtitle: 'Forward vocals, acoustic warmth & harmonium',
    lowGainDb: 1,
    midGainDb: 5,
    highGainDb: 2,
  },
  {
    id: 'late_night',
    label: 'Midnight Drive',
    subtitle: 'Warm nocturnal low-end with silky highs',
    lowGainDb: 4,
    midGainDb: -1,
    highGainDb: 2,
  },
  {
    id: 'gym_pump',
    label: 'Gym Pump',
    subtitle: 'Maximum energy punch & heavy presence',
    lowGainDb: 7,
    midGainDb: 2,
    highGainDb: 5,
  },
];

/**
 * ID se EQ preset lookup karta hai (fallback to Studio Flat).
 */
export function getEqPreset(id: EqPresetId | string): EqPreset {
  const match = EQ_PRESETS.find(preset => preset.id === id);
  return match ?? EQ_PRESETS[0];
}

/**
 * Gain dB value ko human-readable string me format karta hai (e.g. "+6 dB" ya "0 dB").
 */
export function formatGainDb(gain: number): string {
  if (gain > 0) return `+${gain} dB`;
  if (gain < 0) return `${gain} dB`;
  return '0 dB';
}


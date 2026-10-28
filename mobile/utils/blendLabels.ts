/**
 * Blend UI labels (Phase 10) — compute status ke Hinglish short labels.
 * Pure helpers, screens + tests dono use karte hain.
 */

import type { BlendComputeStatus } from '../types';

export function blendComputeStatusShortLabel(status: BlendComputeStatus): string {
  switch (status) {
    case 'ready':
      return 'updated hai';
    case 'computing':
      return 'updating…';
    case 'pending':
      return 'taste sync wait…';
    case 'error':
      return 'compute fail hua';
  }
}

export function blendComputeStatusDetailLabel(status: BlendComputeStatus): string {
  switch (status) {
    case 'ready':
      return 'Blend updated hai — refresh hua';
    case 'computing':
      return 'Apna blend update ho raha hai…';
    case 'pending':
      return 'Members ke taste snapshots sync ho rahe hain…';
    case 'error':
      return 'Last compute fail hua — retry karo';
  }
}

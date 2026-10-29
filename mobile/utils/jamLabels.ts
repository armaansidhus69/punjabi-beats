/**
 * Jam room label helpers (Phase 11) — role/status/type Hinglish labels.
 * Pure helpers — screens + tests dono use karte hain.
 */

import type { RoomRole, RoomStatus, RoomType } from '../types';

export function roomTypeLabel(type: RoomType): string {
  return type === 'jam' ? 'Jam' : 'Listening Party';
}

export function roomTypeSubtitleLabel(type: RoomType): string {
  return type === 'jam'
    ? 'Sab add kar sakte hain, host control karta hai'
    : 'Host playback control karta hai, baaki sunte hain';
}

export function roomStatusLabel(status: RoomStatus): string {
  switch (status) {
    case 'active':
      return 'live';
    case 'paused':
      return 'paused';
    case 'closed':
      return 'band ho gaya';
    case 'expired':
      return 'khatam ho gaya';
  }
}

export function roomRoleLabel(role: RoomRole): string {
  switch (role) {
    case 'owner':
      return '👑 owner';
    case 'co_host':
      return 'co-host';
    case 'moderator':
      return 'moderator';
    case 'participant':
      return 'member';
    case 'listener':
      return 'listener';
  }
}

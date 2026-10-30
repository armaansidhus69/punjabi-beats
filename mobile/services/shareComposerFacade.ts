/**
 * Share entry facade (Phase 8c) — screens import only these wrappers.
 * Flag off = immediate legacy native sheet; flag on = global composer.
 */

import Toast from 'react-native-toast-message';
import { isFeatureEnabled } from '../core/featureflags/featureFlags';
import {
  buildBlendShare,
  buildJamShare,
  buildLyricsShare,
  buildPlaylistShare,
  buildRoomShare,
  buildTrackShare,
  type ShareEntity,
} from '../core/share/share';
import type { Playlist, RoomType, Song } from '../types';
import { useShareComposer } from '../stores/shareComposerStore';
import { shareEntity } from './shareService';
import { tapFeedback, warningFeedback } from '../utils/haptics';

function invalidEntity(): Promise<boolean> {
  warningFeedback();
  Toast.show({ type: 'error', text1: 'Share details invalid hain' });
  return Promise.resolve(false);
}

function start(entity: ShareEntity | null): Promise<boolean> {
  if (!entity) return invalidEntity();
  if (!isFeatureEnabled('social_share_enabled')) return shareEntity(entity);
  tapFeedback();
  useShareComposer.getState().open(entity);
  return Promise.resolve(true);
}

export function shareTrack(song: Song): Promise<boolean> {
  return start(buildTrackShare(song));
}

export function sharePlaylist(playlist: Playlist): Promise<boolean> {
  return start(buildPlaylistShare(playlist));
}

export function shareRoom(code: string, name?: string | null): Promise<boolean> {
  return start(buildRoomShare(code, name));
}

export function shareBlend(name: string, code: string): Promise<boolean> {
  return start(buildBlendShare(name, code));
}

export function shareJam(name: string, code: string, type: RoomType): Promise<boolean> {
  return start(buildJamShare(name, code, type));
}

export function shareLyrics(
  song: Song,
  lines: string[],
  startMs?: number | null,
): Promise<boolean> {
  return start(buildLyricsShare(song, lines, startMs));
}

/**
 * Blend store (Phase 10) — zustand: list + active blend + realtime.
 * Compute/match-% logic service layer me, screens sirf select karte hain.
 */

import { create } from 'zustand';
import type { Blend, BlendItem, BlendMember, Playlist, Song } from '../types';
import {
  BlendServiceError,
  addTrackToBlend,
  createBlend,
  getBlend,
  joinByInviteCode,
  leaveBlend,
  listMemberSnapshots,
  listMyBlends,
  removeMember as removeMemberService,
  removeTrackFromBlend,
  rotateInvite,
  triggerCompute,
  uploadSnapshot,
  type CreateBlendInput,
} from '../services/blendService';
import { subscribeBlendChanges } from '../services/blendSync';
import { jaccardPercent } from '../core/blend/scoring';
import { buildTasteSnapshot } from '../core/blend/snapshot';
import { useLikedSongs } from './likedSongsStore';
import { usePlaylists } from './playlistStore';

interface BlendStore {
  /** meri blends (list screen) */
  blends: Blend[];
  blendsLoading: boolean;
  loadBlends: () => Promise<void>;

  /** active blend detail */
  activeBlend: Blend | null;
  activeMembers: BlendMember[];
  activeItems: BlendItem[];
  /** userId → match% (owner ka artist-set vs member ka) */
  matchPercentByMember: Record<string, number>;
  loading: boolean;
  detailError: string | null;

  openBlend: (blendId: string) => Promise<void>;
  closeBlend: () => void;
  refreshActive: () => Promise<void>;

  createBlendAndOpen: (input: CreateBlendInput) => Promise<Blend>;
  joinWithCode: (code: string) => Promise<string>;
  leaveActive: () => Promise<void>;
  removeActiveMember: (userId: string) => Promise<void>;
  rotateActiveInvite: () => Promise<string>;
  addActiveTrack: (song: Song) => Promise<void>;
  removeActiveTrack: (trackId: string) => Promise<void>;
  recomputeActive: () => Promise<void>;
}

/** Liked + playlists se snapshot upsert — create/join/recompute pe call hota hai */
async function uploadOwnSnapshot(): Promise<void> {
  const liked = useLikedSongs.getState().songs;
  let playlists: Playlist[] = [];
  try {
    playlists = usePlaylists.getState().playlists;
  } catch {
    playlists = [];
  }
  await uploadSnapshot(buildTasteSnapshot(liked, playlists));
}

export const useBlends = create<BlendStore>()((set, get) => ({
  blends: [],
  blendsLoading: false,

  activeBlend: null,
  activeMembers: [],
  activeItems: [],
  matchPercentByMember: {},
  loading: false,
  detailError: null,

  loadBlends: async () => {
    set({ blendsLoading: true });
    try {
      const blends = await listMyBlends();
      set({ blends });
    } catch (err) {
      // list screen empty state dikhayega (guest/flag off/unconfigured)
      console.warn('Blends list load failed:', err);
      set({ blends: [] });
    } finally {
      set({ blendsLoading: false });
    }
  },

  openBlend: async blendId => {
    set({ loading: true, detailError: null });
    try {
      const { blend, members, items } = await getBlend(blendId);
      // realtime — koi bhi table change → refresh (idempotent channel)
      subscribeBlendChanges(blendId, () => {
        void get().refreshActive();
      });
      set({ activeBlend: blend, activeMembers: members, activeItems: items });
      await computeMatchPercentages(blend.ownerId, set);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Blend open failed';
      console.warn('Blend open failed:', err);
      set({ activeBlend: null, detailError: message });
    } finally {
      set({ loading: false });
    }
  },

  closeBlend: () => {
    set({
      activeBlend: null,
      activeMembers: [],
      activeItems: [],
      matchPercentByMember: {},
      detailError: null,
    });
  },

  refreshActive: async () => {
    const blendId = get().activeBlend?.id;
    if (!blendId) return;
    try {
      const { blend, members, items } = await getBlend(blendId);
      set({ activeBlend: blend, activeMembers: members, activeItems: items });
      await computeMatchPercentages(blend.ownerId, set);
    } catch (err) {
      console.warn('Blend refresh failed:', err);
    }
  },

  createBlendAndOpen: async input => {
    const blend = await createBlend(input);
    // apni snapshot turant upsert — compute `ready` banne ke liye zaruri
    await uploadOwnSnapshot();
    await triggerCompute(blend.id).catch(() => undefined);
    await useBlends.getState().loadBlends();
    return blend;
  },

  joinWithCode: async code => {
    const blendId = await joinByInviteCode(code);
    // naya member — snapshot + compute turant (409 'snapshots_pending' chup)
    await uploadOwnSnapshot();
    await triggerCompute(blendId).catch(() => undefined);
    await get().loadBlends();
    return blendId;
  },

  leaveActive: async () => {
    const blendId = get().activeBlend?.id;
    if (!blendId) return;
    await leaveBlend(blendId);
    set({
      activeBlend: null,
      activeMembers: [],
      activeItems: [],
      matchPercentByMember: {},
    });
  },

  removeActiveMember: async targetUserId => {
    const blendId = get().activeBlend?.id;
    if (!blendId) return;
    await removeMemberService(blendId, targetUserId);
    await triggerCompute(blendId).catch(() => undefined);
  },

  rotateActiveInvite: async () => {
    const blendId = get().activeBlend?.id;
    if (!blendId) throw new BlendServiceError('not_found', 'No active blend');
    return rotateInvite(blendId);
  },

  addActiveTrack: async song => {
    const blendId = get().activeBlend?.id;
    if (!blendId) return;
    await addTrackToBlend(blendId, song);
    await get().refreshActive();
  },

  removeActiveTrack: async trackId => {
    const blendId = get().activeBlend?.id;
    if (!blendId) return;
    await removeTrackFromBlend(blendId, trackId);
    await get().refreshActive();
  },

  recomputeActive: async () => {
    const blendId = get().activeBlend?.id;
    if (!blendId) return;
    await uploadOwnSnapshot();
    await triggerCompute(blendId);
    await get().refreshActive();
  },
}));

/** Owner ke against har member ka match % (snapshot artists → jaccard) */
async function computeMatchPercentages(
  ownerId: string,
  set: (partial: Partial<BlendStore>) => void,
): Promise<void> {
  const blendId = useBlends.getState().activeBlend?.id;
  if (!blendId) return;
  try {
    const snapshots = await listMemberSnapshots(blendId);
    const ownerArtists = (snapshots.find(entry => entry.userId === ownerId)?.snapshot.artists ?? []).map(
      a => a.name,
    );
    const map: Record<string, number> = {};
    for (const entry of snapshots) {
      if (entry.userId === ownerId) continue;
      map[entry.userId] = jaccardPercent(
        ownerArtists,
        entry.snapshot.artists.map(a => a.name),
      );
    }
    set({ matchPercentByMember: map });
  } catch (err) {
    console.warn('Match % compute failed:', err);
    set({ matchPercentByMember: {} });
  }
}

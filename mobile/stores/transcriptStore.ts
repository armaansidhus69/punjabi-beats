/**
 * Podcast transcript state (Phase 7b).
 *
 * Fetch/search/jump/reading-position logic screen se bahar. Full transcript
 * memory-only; AsyncStorage me sirf source-bound visible segment index.
 */

import { create } from 'zustand';
import Toast from 'react-native-toast-message';
import type {
  PodcastEpisode,
  PodcastTranscript,
  TranscriptPositionMap,
} from '../types';
import {
  normalizeTranscriptPositions,
  putTranscriptPosition,
  searchTranscript,
  transcriptPositionsToEnvelope,
} from '../core/podcast/transcript';
import {
  PodcastTranscriptError,
  describePodcastTranscriptError,
  fetchPodcastTranscript,
  type PodcastTranscriptErrorCode,
} from '../services/podcastTranscriptService';
import {
  getTranscriptPositionsRaw,
  saveTranscriptPositions,
} from '../services/storage';
import { usePlayer } from './playerStore';
import { usePodcast } from './podcastStore';
import { formatDuration } from '../utils/format';
import { successFeedback, tapFeedback, warningFeedback } from '../utils/haptics';

interface TranscriptStoreError {
  code: PodcastTranscriptErrorCode;
  message: string;
}

interface TranscriptStore {
  episode: PodcastEpisode | null;
  transcript: PodcastTranscript | null;
  loading: boolean;
  error: TranscriptStoreError | null;
  query: string;
  matches: number[];
  positions: TranscriptPositionMap;
  positionsLoaded: boolean;

  initializePositions: () => Promise<void>;
  open: (episode: PodcastEpisode) => Promise<boolean>;
  retry: () => Promise<boolean>;
  close: () => void;
  setQuery: (query: string) => void;
  jumpToSegment: (index: number) => Promise<boolean>;
  saveReadingIndex: (index: number) => void;
}

let requestToken = 0;
let positionTimer: ReturnType<typeof setTimeout> | null = null;

async function flushPositionsNow(): Promise<void> {
  if (positionTimer !== null) {
    clearTimeout(positionTimer);
    positionTimer = null;
  }
  await saveTranscriptPositions(
    transcriptPositionsToEnvelope(useTranscript.getState().positions),
  );
}

export const useTranscript = create<TranscriptStore>((set, get) => ({
  episode: null,
  transcript: null,
  loading: false,
  error: null,
  query: '',
  matches: [],
  positions: {},
  positionsLoaded: false,

  initializePositions: async () => {
    if (get().positionsLoaded) return;
    const positions = normalizeTranscriptPositions(await getTranscriptPositionsRaw());
    set({ positions, positionsLoaded: true });
  },

  open: async episode => {
    const token = ++requestToken;
    tapFeedback();
    set({
      episode,
      transcript: null,
      loading: true,
      error: null,
      query: '',
      matches: [],
    });
    try {
      const [transcript] = await Promise.all([
        fetchPodcastTranscript(episode),
        get().initializePositions(),
      ]);
      if (token !== requestToken || get().episode?.id !== episode.id) return false;
      set({ transcript, loading: false });
      return true;
    } catch (err) {
      if (token !== requestToken || get().episode?.id !== episode.id) return false;
      const error: TranscriptStoreError = {
        code: err instanceof PodcastTranscriptError ? err.code : 'network',
        message: describePodcastTranscriptError(err),
      };
      set({ loading: false, error });
      warningFeedback();
      Toast.show({ type: 'error', text1: error.message });
      return false;
    }
  },

  retry: async () => {
    const episode = get().episode;
    if (!episode) return false;
    return get().open(episode);
  },

  close: () => {
    requestToken += 1;
    if (positionTimer !== null) void flushPositionsNow();
    set({
      episode: null,
      transcript: null,
      loading: false,
      error: null,
      query: '',
      matches: [],
    });
  },

  setQuery: query => {
    const transcript = get().transcript;
    set({
      query,
      matches: transcript ? searchTranscript(transcript.segments, query) : [],
    });
  },

  jumpToSegment: async index => {
    const { episode, transcript } = get();
    const segment = transcript?.segments[index];
    if (!episode || !segment || segment.startMs === null) return false;
    try {
      const player = usePlayer.getState();
      if (player.currentSong?.id !== episode.id) {
        await usePodcast.getState().playEpisode(episode);
      }
      await usePlayer.getState().seek(segment.startMs);
      successFeedback();
      Toast.show({
        type: 'success',
        text1: `${formatDuration(segment.startMs)} pe jump ho gaya`,
      });
      return true;
    } catch (err) {
      console.warn('Transcript jump failed:', err);
      warningFeedback();
      Toast.show({ type: 'error', text1: 'Episode timestamp pe jump nahi hua' });
      return false;
    }
  },

  saveReadingIndex: index => {
    const { episode, transcript, positions } = get();
    if (
      !episode ||
      !transcript ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= transcript.segments.length
    ) {
      return;
    }
    const next = putTranscriptPosition(positions, episode.id, {
      sourceUrl: transcript.sourceUrl,
      segmentIndex: index,
      updatedAt: new Date().toISOString(),
    });
    set({ positions: next });
    if (positionTimer !== null) clearTimeout(positionTimer);
    positionTimer = setTimeout(() => {
      positionTimer = null;
      void saveTranscriptPositions(transcriptPositionsToEnvelope(useTranscript.getState().positions));
    }, 750);
  },
}));

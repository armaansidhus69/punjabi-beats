/**
 * Sleep timer store (Phase 5 completion) — countdown + end-of-track modes.
 *
 * Ek hi global interval (1s) dono modes check karta hai:
 *  - fixed minutes: endsAt cross → pause
 *  - 'end_of_track': position duration-grace ke paas pahunche → pause
 * Room me host/follow ke waqt timer pause SKIP karta hai (room sync playback
 * ka owner hai — sleep timer sirf local solo listening ke liye).
 */

import { create } from 'zustand';
import {
  computeSleepEnd,
  shouldPauseEndOfTrack,
  type SleepMode,
} from '../core/playback/sleepTimer';
import { usePlayer } from './playerStore';
import { useRoom } from './roomStore';

interface SleepTimerState {
  mode: SleepMode;
  /** null = timer off (fixed mode me hi set hota hai) */
  endsAt: number | null;
  start: (mode: SleepMode) => void;
  cancel: () => void;
}

let ticker: ReturnType<typeof setInterval> | null = null;

function pauseLocalPlayback(): void {
  const room = useRoom.getState();
  if (room.code) return; // room sync playback own karta hai — interfere nahi
  void usePlayer.getState().pause();
}

function startTicker(): void {
  if (ticker) return;
  ticker = setInterval(() => {
    const state = useSleepTimer.getState();
    if (state.mode === 'off') return stopTicker();

    if (state.mode === 'end_of_track') {
      const { position, duration, isPlaying } = usePlayer.getState();
      if (isPlaying && shouldPauseEndOfTrack(position, duration)) {
        pauseLocalPlayback();
        stopTicker();
        useSleepTimer.setState({ mode: 'off', endsAt: null });
      }
      return;
    }

    if (state.endsAt !== null && Date.now() >= state.endsAt) {
      pauseLocalPlayback();
      stopTicker();
      useSleepTimer.setState({ mode: 'off', endsAt: null });
    }
  }, 1000);
}

function stopTicker(): void {
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}

export const useSleepTimer = create<SleepTimerState>()(set => ({
  mode: 'off',
  endsAt: null,
  start: mode => {
    if (mode === 'off') {
      stopTicker();
      set({ mode: 'off', endsAt: null });
      return;
    }
    set({
      mode,
      endsAt: mode === 'end_of_track' ? null : computeSleepEnd(mode, Date.now()),
    });
    startTicker();
  },
  cancel: () => {
    stopTicker();
    set({ mode: 'off', endsAt: null });
  },
}));

/**
 * usePodcastProgress (Phase 12a) — player position ko podcast progress
 * ledger me throttled likhta hai (10s granular; unmount pe ek final flush).
 * active song podcast episode na ho → zero-op (songs untouched).
 */

import { useEffect, useRef } from 'react';
import { podcastProgressTick, usePodcast } from '../stores/podcastStore';
import { usePlayer } from '../stores/playerStore';

export default function usePodcastProgressWriter(): void {
  const lastTickRef = useRef<number>(0);

  useEffect(() => {
    const timer = setInterval(() => {
      const player = usePlayer.getState();
      const song = player.currentSong;
      if (!song || song.id.length === 0) return;
      // 10s throttle
      const now = Date.now();
      if (now - lastTickRef.current < 10_000) return;
      lastTickRef.current = now;

      void podcastProgressTick(song.id, Math.round(player.position), Math.round(player.duration)).catch(
        () => undefined,
      );
    }, 5_000);

    const flush = () => {
      const player = usePlayer.getState();
      const song = player.currentSong;
      if (!song) return;
      lastTickRef.current = Date.now();
      void podcastProgressTick(song.id, Math.round(player.position), Math.round(player.duration)).catch(
        () => undefined,
      );
    };

    // pause transition detect (subscribeWithSelector absent — manual flag)
    let wasPlaying = usePlayer.getState().isPlaying;
    const unsubscribe = usePlayer.subscribe(state => {
      if (wasPlaying && !state.isPlaying) flush();
      wasPlaying = state.isPlaying;
    });

    return () => {
      clearInterval(timer);
      unsubscribe();
      flush();
    };
  }, []);

  // progressMap load — ek hi baar (already loaded → no-op path)
  useEffect(() => {
    void usePodcast.getState().loadProgress();
  }, []);
}

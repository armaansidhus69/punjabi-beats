import { initializePlayer } from '../../stores/playerStore';

/** Core media boundary. Native TrackPlayer remains the implementation for now. */
export function initializeMedia(): Promise<void> {
  return initializePlayer();
}

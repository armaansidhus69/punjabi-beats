import TrackPlayer, { Event } from 'react-native-track-player';
import { usePlayer } from '../stores/playerStore';

export async function playbackService(): Promise<void> {
  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    const player = usePlayer.getState();
    if (player.currentSong) void player.play();
    else void TrackPlayer.play();
  });
  TrackPlayer.addEventListener(Event.RemotePause, () => {
    const player = usePlayer.getState();
    if (player.currentSong) void player.pause();
    else void TrackPlayer.pause();
  });
  TrackPlayer.addEventListener(Event.RemoteNext, () => {
    const player = usePlayer.getState();
    if (player.currentSong) void player.playNext();
    else void TrackPlayer.skipToNext();
  });
  TrackPlayer.addEventListener(Event.RemotePrevious, () => {
    const player = usePlayer.getState();
    if (player.currentSong) void player.playPrev();
    else void TrackPlayer.skipToPrevious();
  });
  TrackPlayer.addEventListener(Event.RemoteSeek, ({ position }) => {
    const player = usePlayer.getState();
    if (player.currentSong) void player.seek(position * 1000);
    else void TrackPlayer.seekTo(position);
  });
  TrackPlayer.addEventListener(Event.RemoteStop, async () => {
    const player = usePlayer.getState();
    if (player.currentSong) await player.pause();
    else await TrackPlayer.pause();
    await TrackPlayer.stop();
    usePlayer.setState({ position: 0 });
  });
  TrackPlayer.addEventListener(Event.RemoteDuck, async event => {
    if (event.permanent || event.paused) {
      const player = usePlayer.getState();
      if (player.currentSong) await player.pause();
      else await TrackPlayer.pause();
    }
  });
}
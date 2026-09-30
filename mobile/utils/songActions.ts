/**
 * SongItem '+' ka shared handler (home/search/mood screens).
 *
 * - Room me ho → Alert me option: "Add to Room Queue" / "Add to Playlist"
 *   (spec: room ke koi bhi member — host bhi — queue me add kar sake).
 * - Room me nahi ho → seedha global add-to-playlist sheet (pehle jaisa).
 *
 * Room wale path ka actual kaam `services/roomSync.addSongToRoomQueue`
 * karti hai (local add + 'queue-add' broadcast + dedupe).
 */
import { Alert } from 'react-native';
import Toast from 'react-native-toast-message';
import { Song } from '../types';
import { useRoom } from '../stores/roomStore';
import { usePlaylists } from '../stores/playlistStore';
import { addSongToRoomQueue } from '../services/roomSync';

export function promptAddSong(song: Song): void {
  const inRoom = useRoom.getState().code !== null;
  if (!inRoom) {
    usePlaylists.getState().openAddSheet(song);
    return;
  }

  Alert.alert('Add karo', `${song.title} — ${song.artist}`, [
    {
      text: 'Add to Room Queue',
      onPress: () => {
        void addSongToRoomQueue(song).then(result => {
          if (result === 'added') {
            Toast.show({ type: 'success', text1: 'Room queue me add ho gaya', text2: song.title });
          } else if (result === 'duplicate') {
            Toast.show({
              type: 'error',
              text1: 'Ye song queue me pehle se hai',
              text2: song.title,
            });
          }
        });
      },
    },
    { text: 'Add to Playlist', onPress: () => usePlaylists.getState().openAddSheet(song) },
    { text: 'Cancel', style: 'cancel' },
  ]);
}

/**
 * SongArtwork — square artwork + placeholder fallback.
 * iTunes/JioSaavn kabhi cover nahi dete, isliye empty uri pe icon dikhate hain
 * (broken image se better UX).
 */
import { Image, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/colors';

interface SongArtworkProps {
  uri?: string;
  size: number;
  radius?: number;
}

export default function SongArtwork({ uri, size, radius = 8 }: SongArtworkProps) {
  const shape = { width: size, height: size, borderRadius: radius };

  if (!uri) {
    return (
      <View style={[styles.placeholder, shape]}>
        <Ionicons name="musical-note" size={size * 0.45} color={colors.subtext} />
      </View>
    );
  }

  return <Image source={{ uri }} style={shape} resizeMode="cover" />;
}

const styles = StyleSheet.create({
  placeholder: {
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

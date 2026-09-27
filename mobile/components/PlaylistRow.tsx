/**
 * PlaylistRow — ek playlist ki row (artwork + naam + song count + right icon).
 * Library list aur add-to-playlist sheet dono me reuse hoti hai, isliye right
 * side configurable hai (chevron / add / checkmark + optional status text).
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Playlist } from '../types';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { spacing } from '../constants/spacing';
import { tapFeedback, warningFeedback } from '../utils/haptics';
import SongArtwork from './SongArtwork';

interface PlaylistRowProps {
  playlist: Playlist;
  onPress: (playlist: Playlist) => void;
  /** right side icon (default: chevron-forward) */
  rightIcon?: keyof typeof Ionicons.glyphMap;
  /** right icon ke saath/neeche chhota status text (e.g. "Already added") */
  trailingText?: string;
  /** disabled row — tap ka koi effect nahi (duplicate case) */
  disabled?: boolean;
}

export default function PlaylistRow({
  playlist,
  onPress,
  rightIcon = 'chevron-forward',
  trailingText,
  disabled = false,
}: PlaylistRowProps) {
  const songCount = playlist.songs.length;
  const subtitle = songCount === 0 ? 'Khaali playlist' : `${songCount} songs`;

  return (
    <Pressable
      onPress={() => {
        if (disabled) {
          // Duplicate pe user ko feedback mile (silent row confusing lagti hai)
          warningFeedback();
          return;
        }
        tapFeedback();
        onPress(playlist);
      }}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={`${playlist.name} — ${subtitle}`}
      style={({ pressed }) => [styles.row, disabled && styles.rowDisabled, pressed && styles.pressed]}
    >
      {/* Pehle song ka cover, warna placeholder icon (SongArtwork fallback) */}
      <SongArtwork uri={playlist.songs[0]?.cover} size={48} radius={10} />

      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {playlist.name}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>

      {trailingText ? <Text style={styles.trailing}>{trailingText}</Text> : null}

      <Ionicons name={rightIcon} size={22} color={disabled ? colors.border : colors.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: 12,
  },
  rowDisabled: { opacity: 0.75 },
  pressed: { opacity: 0.65 },
  info: { flex: 1, gap: 2 },
  name: { ...typography.body, color: colors.text, fontWeight: '600' },
  subtitle: { ...typography.caption, color: colors.subtext },
  trailing: { ...typography.caption, color: colors.subtext },
});

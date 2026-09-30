/**
 * SongItem — list ka ek song row (45px artwork + title + artist + actions).
 * Fully controlled component: play/add ka decision parent screen karta hai,
 * isliye ye har list (home, search, mood, playlist) me reuse ho jaata hai.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Song } from '../types';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { spacing } from '../constants/spacing';
import { tapFeedback, warningFeedback } from '../utils/haptics';
import SongArtwork from './SongArtwork';

interface SongItemProps {
  song: Song;
  onPress: (song: Song) => void;
  /** current playing song highlight (FR-6.1) */
  isActive?: boolean;
  /** diya jaaye tabhi "+" button dikhta hai — parent decide karta hai (playlist sheet ya room queue prompt) */
  onAddPress?: (song: Song) => void;
  /** diya jaaye tabhi "hatao" (trash) button dikhta hai — playlist detail screen */
  onRemovePress?: (song: Song) => void;
}

export default function SongItem({
  song,
  onPress,
  isActive = false,
  onAddPress,
  onRemovePress,
}: SongItemProps) {
  return (
    <Pressable
      onPress={() => {
        tapFeedback();
        onPress(song);
      }}
      accessibilityRole="button"
      accessibilityLabel={`${song.title} — ${song.artist}`}
      style={({ pressed }) => [styles.row, isActive && styles.rowActive, pressed && styles.pressed]}
    >
      <SongArtwork uri={song.cover} size={45} radius={10} />

      <View style={styles.info}>
        <Text style={[styles.title, isActive && styles.titleActive]} numberOfLines={1}>
          {song.title}
        </Text>
        <Text style={styles.artist} numberOfLines={1}>
          {song.artist}
        </Text>
      </View>

      {/* iTunes 30s preview badge — full-song mirror env enable hone pe gayab */}
      {song.previewOnly ? (
        <View style={styles.previewBadge}>
          <Text style={styles.previewBadgeText}>30s</Text>
        </View>
      ) : null}

      {isActive ? <Ionicons name="volume-medium" size={18} color={colors.primary} /> : null}

      {onAddPress ? (
        <Pressable
          onPress={() => onAddPress(song)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`${song.title} add karo`}
          style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
        >
          <Ionicons name="add-circle-outline" size={22} color={colors.subtext} />
        </Pressable>
      ) : null}

      {onRemovePress ? (
        <Pressable
          onPress={() => {
            warningFeedback();
            onRemovePress(song);
          }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`${song.title} ko list se hatao`}
          style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
        >
          <Ionicons name="trash-outline" size={20} color={colors.subtext} />
        </Pressable>
      ) : null}
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
  rowActive: { backgroundColor: colors.surface },
  pressed: { opacity: 0.65 },
  info: { flex: 1, gap: 2 },
  title: { ...typography.body, color: colors.text, fontWeight: '600' },
  titleActive: { color: colors.primary },
  artist: { ...typography.caption, color: colors.subtext },
  actionButton: { padding: spacing.xs },
  previewBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  previewBadgeText: { fontSize: 10, fontWeight: '700', color: colors.primary },
});

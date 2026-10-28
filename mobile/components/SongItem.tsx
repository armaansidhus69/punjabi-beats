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
import { handleOpenOnYouTube, isYouTubeMatchConfigured } from '../utils/youtubeLink';
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
  /** diya jaaye tabhi heart button dikhta hai — liked songs toggle */
  isLiked?: boolean;
  onLikePress?: (song: Song) => void;
}

export default function SongItem({
  song,
  onPress,
  isActive = false,
  onAddPress,
  onRemovePress,
  isLiked = false,
  onLikePress,
}: SongItemProps) {
  return (
    <View style={[styles.row, isActive && styles.rowActive]}>
      <Pressable
        onPress={() => {
          tapFeedback();
          onPress(song);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${song.title} — ${song.artist}`}
        style={({ pressed }) => [styles.mainContent, pressed && styles.pressed]}
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

        {song.source === 'youtube_music' && !song.previewOnly ? (
          <View style={styles.youtubeBadge}>
            <Text style={styles.youtubeBadgeText}>YT Music</Text>
          </View>
        ) : song.previewOnly ? (
          <View style={styles.previewBadge}>
            <Text style={styles.previewBadgeText}>30s</Text>
          </View>
        ) : null}

        {isActive ? <Ionicons name="volume-medium" size={18} color={colors.primary} /> : null}
      </Pressable>

      {/* YouTube link-out — sirf preview-only gaano pe (full version dhundhne ke liye).
          WebView player NAHI hai (room sync + background play dono bachate hain —
          dekhho utils/youtubeLink.ts ka header). Backend env na ho to button chhupta hai. */}
      {song.previewOnly && isYouTubeMatchConfigured() ? (
        <Pressable
          onPress={() => handleOpenOnYouTube(song)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`${song.title} YouTube pe full version kholo`}
          style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
        >
          <Ionicons name="logo-youtube" size={20} color={colors.primary} />
        </Pressable>
      ) : null}

      {onLikePress ? (
        <Pressable
          onPress={() => {
            tapFeedback();
            onLikePress(song);
          }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={isLiked ? `${song.title} liked songs se hatao` : `${song.title} ko like karo`}
          accessibilityState={{ selected: isLiked }}
          style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
        >
          <Ionicons
            name={isLiked ? 'heart' : 'heart-outline'}
            size={21}
            color={isLiked ? colors.primary : colors.subtext}
          />
        </Pressable>
      ) : null}

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
    </View>
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
  mainContent: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
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
  youtubeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primary + '22',
  },
  youtubeBadgeText: { fontSize: 10, fontWeight: '700', color: colors.primary },
});

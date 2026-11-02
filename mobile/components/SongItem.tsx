/**
 * SongItem — list ka ek song row (45px artwork + title + artist + actions).
 * Fully controlled component: play/add ka decision parent screen karta hai,
 * isliye ye har list (home, search, mood, playlist) me reuse ho jaata hai.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Song } from '../types';
import { colors, sourceColor, sourceLabel } from '../constants/colors';
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
  /** diya jaaye tabhi heart button dikhta hai — liked songs toggle */
  isLiked?: boolean;
  onLikePress?: (song: Song) => void;
  /** artist tap pe dedicated page navigation */
  onArtistPress?: (artistName: string) => void;
}

export default function SongItem({
  song,
  onPress,
  isActive = false,
  onAddPress,
  onRemovePress,
  isLiked = false,
  onLikePress,
  onArtistPress,
}: SongItemProps) {
  const handleArtistClick = () => {
    tapFeedback();
    if (onArtistPress) {
      onArtistPress(song.artist);
    } else if (song.artist) {
      router.push(`/artist/${encodeURIComponent(song.artist)}`);
    }
  };

  return (
    <View style={[styles.row, isActive && styles.rowActive]}>
      <Pressable
        onPress={() => {
          tapFeedback();
          onPress(song);
          if (song.previewOnly) {
            router.push('/player');
          }
        }}
        accessibilityRole="button"
        accessibilityLabel={`${song.title} — ${song.artist}`}
        style={({ pressed }) => [styles.mainContent, pressed && styles.pressed]}
      >
        <SongArtwork uri={song.cover} size={48} radius={10} />

        <View style={styles.info}>
          <Text style={[styles.title, isActive && styles.titleActive]} numberOfLines={1}>
            {song.title}
          </Text>
          <Pressable
            onPress={handleArtistClick}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Artist: ${song.artist}`}
          >
            <Text style={[styles.artist, isActive && styles.artistActive]} numberOfLines={1}>
              {song.artist}
            </Text>
          </Pressable>
        </View>

        {/* Source badge — har source ka apna color/label (multi-source identity). */}
        {song.source ? (
          <View
            style={[styles.sourceBadge, { borderColor: `${sourceColor[song.source] ?? colors.subtext}55` }]}
          >
            <View
              style={[
                styles.sourceDot,
                { backgroundColor: sourceColor[song.source] ?? colors.subtext },
              ]}
            />
            <Text
              style={[
                styles.sourceBadgeText,
                { color: sourceColor[song.source] ?? colors.subtext },
              ]}
            >
              {sourceLabel[song.source] ?? 'Music'}
            </Text>
          </View>
        ) : null}

        {isActive ? <Ionicons name="stats-chart" size={16} color={colors.primary} /> : null}
      </Pressable>

      {/* DESIGN RULE: koi YouTube link-out button nahi — music hamesha is app
          me bajti hai (pehle preview-only gaano pe YouTube khulta tha). */}

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
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    borderRadius: 14,
    marginHorizontal: spacing.xs,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowActive: {
    backgroundColor: colors.primarySoft,
    borderColor: 'rgba(255, 65, 108, 0.35)',
  },
  mainContent: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  pressed: { opacity: 0.65 },
  info: { flex: 1, gap: 3 },
  title: { ...typography.body, color: colors.text, fontWeight: '600', fontSize: 15 },
  titleActive: { color: colors.primary, fontWeight: '700' },
  artist: { ...typography.caption, color: colors.subtext, fontSize: 13 },
  artistActive: { color: colors.primary },
  actionButton: { padding: spacing.xs },
  /* Source badge (multi-source identity) */
  sourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  sourceDot: { width: 5, height: 5, borderRadius: 3 },
  sourceBadgeText: { fontSize: 10, fontWeight: '700' },
  /* 30s preview chip — honest indicator */
  previewBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: `${colors.warning}55`,
    backgroundColor: 'rgba(255, 194, 75, 0.08)',
  },
  previewBadgeText: { fontSize: 10, fontWeight: '700', color: colors.warning },
});

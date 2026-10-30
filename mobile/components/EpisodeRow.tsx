/**
 * Podcast episode row (Phase 12a) — title/duration/date + played badge +
 * resume text. Render-only: playback store se hota hai (onPress prop).
 */

import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PodcastProgressEntry } from '../types';
import { formatDuration } from '../utils/format';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { spacing } from '../constants/spacing';
import { tapFeedback } from '../utils/haptics';

interface EpisodeRowProps {
  title: string;
  publishedLabel: string;
  durationMs: number;
  progress: PodcastProgressEntry | null;
  playing: boolean;
  onPress: () => void;
  onTranscript?: () => void;
}

function EpisodeRowImpl({
  title,
  publishedLabel,
  durationMs,
  progress,
  playing,
  onPress,
  onTranscript,
}: EpisodeRowProps) {
  const played = progress?.played === true;
  const hasResume = !played && (progress?.positionMs ?? 0) > 1000;
  const resumePct =
    hasResume && durationMs > 0 ? Math.round(((progress?.positionMs ?? 0) / durationMs) * 100) : 0;

  return (
    <View style={styles.container}>
      <Pressable
        onPress={() => {
          tapFeedback();
          onPress();
        }}
        accessibilityRole="button"
        accessibilityLabel={played ? `Episode ${title}, played` : `Episode ${title} play karo`}
        style={({ pressed }) => [styles.mainAction, pressed && styles.pressed]}
      >
        <View style={styles.playBadge}>
          {playing ? (
            <Ionicons name="pause" size={18} color={colors.primary} />
          ) : (
            <Ionicons name={played ? 'checkmark-circle' : 'play'} size={18} color={colors.primary} />
          )}
        </View>

        <View style={styles.info}>
          <Text style={[styles.title, played && styles.playedTitle]} numberOfLines={2}>
            {title}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {publishedLabel} · {durationMs > 0 ? formatDuration(durationMs) : 'Duration nahi'}
            {played ? ' · Played ✅' : ''}
            {hasResume && resumePct > 0 ? ` · ${resumePct}% resume` : ''}
          </Text>
        </View>
      </Pressable>
      {onTranscript ? (
        <Pressable
          onPress={onTranscript}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`${title} transcript kholo`}
          style={({ pressed }) => [styles.transcriptAction, pressed && styles.pressed]}
        >
          <Ionicons name="document-text-outline" size={20} color={colors.primary} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** memo — 50 episodes list me re-render bachao */
const EpisodeRow = memo(EpisodeRowImpl);
export default EpisodeRow;

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
  },
  mainAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
  },
  transcriptAction: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    marginRight: spacing.xs,
  },
  pressed: { opacity: 0.7 },
  playBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  info: { flex: 1, gap: 2 },
  title: { ...typography.body, color: colors.text },
  playedTitle: { color: colors.subtext },
  meta: { ...typography.caption, color: colors.subtext },
});

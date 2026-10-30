/**
 * Podcast show detail — /podcast/[id] (Phase 12a roadmap).
 * Hero (art + title + artist) + save/unsave chip + episodes list
 * (EpisodeRow, resume-aware). Render-only: logic podcastStore.
 */
import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import PodcastGate from '../../components/PodcastGate';
import EpisodeRow from '../../components/EpisodeRow';
import LoadingSpinner from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';
import { PodcastShow } from '../../types';
import { usePodcast } from '../../stores/podcastStore';
import { useTranscript } from '../../stores/transcriptStore';
import { usePlayer } from '../../stores/playerStore';
import { useMiniPlayerPadding } from '../../hooks/useMiniPlayerPadding';
import { colors } from '../../constants/colors';
import { typography } from '../../constants/typography';
import { spacing } from '../../constants/spacing';
import { successFeedback } from '../../utils/haptics';

export default function PodcastDetailScreen() {
  const insets = useSafeAreaInsets();
  const contentPadding = useMiniPlayerPadding(spacing.lg);
  const { id } = useLocalSearchParams<{ id: string }>();

  const detailEpisodes = usePodcast(s => s.detailEpisodes);
  const detailLoading = usePodcast(s => s.detailLoading);
  const detailError = usePodcast(s => s.detailError);
  const openShow = usePodcast(s => s.openShow);
  const closeDetail = usePodcast(s => s.closeDetail);
  const savedShows = usePodcast(s => s.savedShows);
  const toggleSave = usePodcast(s => s.toggleSave);
  const playEpisode = usePodcast(s => s.playEpisode);
  const progressMap = usePodcast(s => s.progressMap);
  const openTranscript = useTranscript(s => s.open);

  const currentSongId = usePlayer(s => s.currentSong?.id ?? null);
  const [show, setShow] = useState<PodcastShow | null>(null);
  const [saving, setSaving] = useState(false);

  // openShow detail banata hai — show {id: string} hook se aata hai
  useEffect(() => {
    void openShow(id)
      .then(fetched => setShow(fetched))
      .catch(() => undefined);
    return () => closeDetail();
  }, [id, openShow, closeDetail]);

  // Focus hone pe progress refresh hota hai (bagair screen change)
  useFocusEffect(
    useCallback(() => {
      void usePodcast.getState().loadProgress();
    }, []),
  );

  const isSaved = show !== null && savedShows.some(saved => saved.id === show.id);

  const handleToggleSave = useCallback(async () => {
    if (show === null || saving) return;
    setSaving(true);
    try {
      const nowSaved = await toggleSave(show);
      successFeedback();
      Toast.show({
        type: 'success',
        text1: nowSaved ? 'Show save ho gaya' : 'Show hat gaya',
        text2: show.title,
      });
    } finally {
      setSaving(false);
    }
  }, [show, saving, toggleSave]);

  const handlePlay = useCallback(
    (episodeId: string) => {
      const episode = detailEpisodes.find(candidate => candidate.id === episodeId);
      if (!episode) return;
      void playEpisode(episode).catch(() => undefined);
    },
    [detailEpisodes, playEpisode],
  );

  const handleTranscript = useCallback(
    (episodeId: string) => {
      const episode = detailEpisodes.find(candidate => candidate.id === episodeId);
      if (!episode || episode.transcripts.length === 0) return;
      void openTranscript(episode);
      router.push('/podcast/transcript');
    },
    [detailEpisodes, openTranscript],
  );

  if (detailLoading) {
    return (
      <PodcastGate>
        <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
          <LoadingSpinner label="Episodes load ho rahe hain…" />
        </View>
      </PodcastGate>
    );
  }

  if (detailError !== null || show === null) {
    return (
      <PodcastGate>
        <View style={[styles.container, { paddingTop: insets.top }]}>
          <View style={styles.header}>
            <Pressable onPress={router.back} hitSlop={12} accessibilityRole="button" accessibilityLabel="Wapas jao">
              <Ionicons name="chevron-back" size={24} color={colors.text} />
            </Pressable>
          </View>
          <EmptyState
            icon="cloud-offline-outline"
            title="Show nahi khula"
            subtitle={detailError ?? 'Thoda baad try karo.'}
          >
            <Pressable
              onPress={router.back}
              accessibilityRole="button"
              accessibilityLabel="Wapas jao"
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
            >
              <Text style={styles.retryText}>Wapas jao</Text>
            </Pressable>
          </EmptyState>
        </View>
      </PodcastGate>
    );
  }

  return (
    <PodcastGate>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable
            onPress={router.back}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Wapas jao"
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {show.title}
          </Text>
          <View style={styles.iconSpacer} />
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: contentPadding }} showsVerticalScrollIndicator={false}>
          {/* hero */}
          <View style={styles.hero}>
            <Image source={{ uri: show.artworkUrl }} style={styles.heroArt} />
            <View style={styles.heroInfo}>
              <Text style={styles.heroTitle} numberOfLines={2}>
                {show.title}
              </Text>
              <Text style={styles.heroMeta} numberOfLines={2}>
                {show.artist}
                {show.primaryGenre ? ` · ${show.primaryGenre}` : ''}
              </Text>
            </View>
          </View>

          {/* save chip */}
          <View style={styles.actionsRow}>
            <Pressable
              onPress={() => void handleToggleSave()}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel={isSaved ? 'Show unsaved karo' : 'Show save karo'}
              style={({ pressed }) => [styles.saveChip, pressed && styles.pressed, isSaved && styles.saveChipActive]}
            >
              <Ionicons
                name={isSaved ? 'bookmark' : 'bookmark-outline'}
                size={16}
                color={isSaved ? colors.background : colors.primary}
              />
              <Text style={[styles.saveChipText, isSaved && styles.saveChipTextActive]}>
                {isSaved ? 'Saved' : 'Save'}
              </Text>
            </Pressable>
          </View>

          <Text style={styles.episodesHeading}>
            Episodes ({detailEpisodes.length})
          </Text>

          {detailEpisodes.length === 0 ? (
            <EmptyState icon="mic-outline" title="Koi episode nahi mila" subtitle="Feed khali lagti hai." />
          ) : (
            detailEpisodes.map(episode => (
              <EpisodeRow
                key={episode.id}
                title={episode.title}
                publishedLabel={episode.publishedAt ? new Date(episode.publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date nahi'}
                durationMs={episode.durationMs}
                progress={progressMap[episode.id] ?? null}
                playing={currentSongId === episode.id}
                onPress={() => handlePlay(episode.id)}
                onTranscript={
                  episode.transcripts.length > 0
                    ? () => handleTranscript(episode.id)
                    : undefined
                }
              />
            ))
          )}
        </ScrollView>
      </View>
    </PodcastGate>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerTitle: { ...typography.h2, color: colors.text, flex: 1, marginHorizontal: spacing.md },
  iconButton: { padding: spacing.xs },
  iconSpacer: { width: 36 },
  pressed: { opacity: 0.7 },
  hero: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  heroArt: {
    width: 120,
    height: 120,
    borderRadius: 16,
    backgroundColor: colors.card,
  },
  heroInfo: { flex: 1, gap: spacing.xs, justifyContent: 'center' },
  heroTitle: { ...typography.h2, color: colors.text },
  heroMeta: { ...typography.caption, color: colors.subtext },
  actionsRow: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
    flexDirection: 'row',
    gap: spacing.md,
  },
  saveChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  saveChipActive: { backgroundColor: colors.primary },
  saveChipText: { ...typography.caption, color: colors.primary },
  saveChipTextActive: { color: colors.background, fontWeight: '700' },
  episodesHeading: {
    ...typography.h2,
    color: colors.text,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    marginHorizontal: spacing.lg,
  },
  retryButton: {
    alignSelf: 'center',
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 20,
    backgroundColor: colors.primary,
  },
  retryText: { ...typography.body, color: colors.background, fontWeight: '700' },
});

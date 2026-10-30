/**
 * Signed share landing — /share?token=... (Phase 8a).
 * Gate child pattern guarantees flag-off direct links make zero network calls.
 */

import { useCallback, useEffect } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SocialShareGate from '../components/SocialShareGate';
import EmptyState from '../components/EmptyState';
import LoadingSpinner from '../components/LoadingSpinner';
import { useShare } from '../stores/shareStore';
import { useMiniPlayerPadding } from '../hooks/useMiniPlayerPadding';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { spacing } from '../constants/spacing';
import { tapFeedback } from '../utils/haptics';
import type { ResolvedSharePayload } from '../core/share/share';

const TOKEN_PATTERN = /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function kindLabel(payload: ResolvedSharePayload): string {
  switch (payload.kind) {
    case 'track':
      return 'Shared Track';
    case 'playlist':
      return 'Shared Playlist';
    case 'room':
      return 'Group Room Invite';
    case 'blend':
      return 'Blend Invite';
    case 'jam':
      return payload.data.roomType === 'party' ? 'Listening Party Invite' : 'Jam Invite';
  }
}

function primaryLabel(payload: ResolvedSharePayload, imported: boolean): string {
  switch (payload.kind) {
    case 'track':
      return 'Play Track';
    case 'playlist':
      return imported ? 'Playlist Imported' : 'Import Playlist';
    case 'room':
      return 'Open Room';
    case 'blend':
      return 'Join Blend';
    case 'jam':
      return 'Join Jam';
  }
}

export default function ShareLandingScreen() {
  return (
    <SocialShareGate>
      <ShareContent />
    </SocialShareGate>
  );
}

function ShareContent() {
  const insets = useSafeAreaInsets();
  const contentPadding = useMiniPlayerPadding(spacing.xl);
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const token = typeof params.token === 'string' ? params.token : '';
  const validToken = token.length > 0 && token.length <= 8192 && TOKEN_PATTERN.test(token);

  const payload = useShare(s => s.payload);
  const loading = useShare(s => s.loading);
  const error = useShare(s => s.error);
  const busy = useShare(s => s.busy);
  const resolvedSongs = useShare(s => s.resolvedSongs);
  const importedPlaylistId = useShare(s => s.importedPlaylistId);
  const openToken = useShare(s => s.openToken);
  const retry = useShare(s => s.retry);
  const clear = useShare(s => s.clear);
  const performPrimaryAction = useShare(s => s.performPrimaryAction);
  const playResolved = useShare(s => s.playResolved);

  useEffect(() => {
    if (validToken) void openToken(token);
    return clear;
  }, [clear, openToken, token, validToken]);

  const handlePrimary = useCallback(async () => {
    const action = await performPrimaryAction();
    if (action?.type !== 'navigate') return;
    if (action.target === 'room') {
      router.replace(`/room/${action.code}`);
    } else if (action.target === 'blend') {
      router.replace(`/blend/join?code=${encodeURIComponent(action.code)}`);
    } else {
      router.replace(`/jam/join?code=${encodeURIComponent(action.code)}`);
    }
  }, [performPrimaryAction]);

  return (
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
        <Text style={styles.headerTitle}>Punjabi Beats Share</Text>
        <View style={styles.headerSpacer} />
      </View>

      {!validToken ? (
        <EmptyState
          icon="link-outline"
          title="Share link invalid hai"
          subtitle="Sender se naya Punjabi Beats link mango"
        />
      ) : null}

      {validToken && loading ? <LoadingSpinner label="Share link verify ho raha hai…" /> : null}

      {validToken && !loading && error ? (
        <EmptyState icon="warning-outline" title="Share link nahi khula" subtitle={error}>
          <Pressable
            onPress={() => {
              tapFeedback();
              void retry();
            }}
            accessibilityRole="button"
            accessibilityLabel="Share link dobara load karo"
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </EmptyState>
      ) : null}

      {validToken && !loading && !error && payload ? (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: contentPadding }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.disclosure}>
            <Ionicons name="shield-checkmark-outline" size={16} color={colors.primary} />
            <Text style={styles.disclosureText}>
              Signed link · expires {new Date(payload.exp * 1000).toLocaleDateString('en-IN')}
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.kind}>{kindLabel(payload)}</Text>
            {payload.kind === 'track' ? (
              <>
                {payload.data.cover ? (
                  <Image source={{ uri: payload.data.cover }} style={styles.cover} />
                ) : (
                  <View style={[styles.cover, styles.coverFallback]}>
                    <Ionicons name="musical-note" size={40} color={colors.primary} />
                  </View>
                )}
                <Text style={styles.title}>{payload.data.title}</Text>
                <Text style={styles.subtitle}>{payload.data.artist}</Text>
              </>
            ) : null}

            {payload.kind === 'playlist' ? (
              <>
                <Ionicons name="list-circle-outline" size={64} color={colors.primary} />
                <Text style={styles.title}>{payload.data.name}</Text>
                <Text style={styles.subtitle}>{payload.data.totalCount} songs</Text>
                <View style={styles.trackList}>
                  {payload.data.tracks.map((track, index) => (
                    <Text key={`${index}-${track.title}`} style={styles.track} numberOfLines={1}>
                      {index + 1}. {track.title} — {track.artist}
                    </Text>
                  ))}
                </View>
              </>
            ) : null}

            {payload.kind === 'room' ? (
              <>
                <Ionicons name="people-outline" size={64} color={colors.primary} />
                <Text style={styles.title}>{payload.data.name ?? 'Group Room'}</Text>
                <Text style={styles.code}>{payload.data.code}</Text>
              </>
            ) : null}

            {payload.kind === 'blend' ? (
              <>
                <Ionicons name="git-merge-outline" size={64} color={colors.primary} />
                <Text style={styles.title}>{payload.data.name ?? 'Punjabi Beats Blend'}</Text>
                <Text style={styles.code}>{payload.data.code}</Text>
              </>
            ) : null}

            {payload.kind === 'jam' ? (
              <>
                <Ionicons name="people-circle-outline" size={64} color={colors.primary} />
                <Text style={styles.title}>{payload.data.name ?? 'Punjabi Beats Jam'}</Text>
                <Text style={styles.code}>{payload.data.code}</Text>
              </>
            ) : null}

            <Pressable
              onPress={() => void handlePrimary()}
              disabled={busy || (payload.kind === 'playlist' && importedPlaylistId !== null)}
              accessibilityRole="button"
              accessibilityLabel={primaryLabel(payload, importedPlaylistId !== null)}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.pressed,
                (busy || (payload.kind === 'playlist' && importedPlaylistId !== null)) && styles.disabled,
              ]}
            >
              <Text style={styles.primaryText}>
                {busy ? 'Please wait…' : primaryLabel(payload, importedPlaylistId !== null)}
              </Text>
            </Pressable>

            {payload.kind === 'playlist' && resolvedSongs.length > 0 ? (
              <Pressable
                onPress={() => void playResolved()}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Imported playlist play karo"
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
              >
                <Ionicons name="play" size={17} color={colors.primary} />
                <Text style={styles.secondaryText}>Play All ({resolvedSongs.length})</Text>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  iconButton: { padding: spacing.xs },
  headerTitle: { ...typography.h2, color: colors.text, flex: 1, textAlign: 'center' },
  headerSpacer: { width: 32 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.55 },
  content: { padding: spacing.lg, gap: spacing.md },
  disclosure: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: 12,
    backgroundColor: colors.card,
  },
  disclosureText: { ...typography.caption, color: colors.subtext, flex: 1 },
  card: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
    borderRadius: 20,
    backgroundColor: colors.card,
  },
  kind: { ...typography.caption, color: colors.primary, textTransform: 'uppercase', letterSpacing: 1 },
  cover: { width: 180, height: 180, borderRadius: 18, backgroundColor: colors.surface },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.h1, color: colors.text, textAlign: 'center' },
  subtitle: { ...typography.body, color: colors.subtext, textAlign: 'center' },
  code: { ...typography.h1, color: colors.primary, letterSpacing: 3 },
  trackList: { alignSelf: 'stretch', gap: spacing.xs, marginVertical: spacing.sm },
  track: { ...typography.caption, color: colors.subtext },
  primaryButton: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: 24,
    backgroundColor: colors.primary,
    marginTop: spacing.sm,
  },
  primaryText: { ...typography.body, color: colors.background, fontWeight: '700' },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    alignSelf: 'stretch',
    paddingVertical: spacing.sm,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  secondaryText: { ...typography.body, color: colors.primary, fontWeight: '700' },
  retryButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 20,
    backgroundColor: colors.primary,
  },
  retryText: { ...typography.body, color: colors.background, fontWeight: '700' },
});

/**
 * Library tab — playlists (Phase 9).
 * FR-4.1..FR-4.6: create playlist (modal + validation), list me naam + song
 * count, tap pe detail screen (/playlist/[id]) jahan Play All / remove / delete.
 */
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import { Playlist } from '../../types';
import { usePlaylists } from '../../stores/playlistStore';
import { useMiniPlayerPadding } from '../../hooks/useMiniPlayerPadding';
import { successFeedback, tapFeedback } from '../../utils/haptics';
import { colors } from '../../constants/colors';
import { typography } from '../../constants/typography';
import { spacing } from '../../constants/spacing';
import CreatePlaylistModal from '../../components/CreatePlaylistModal';
import EmptyState from '../../components/EmptyState';
import LoadingSpinner from '../../components/LoadingSpinner';
import PlaylistRow from '../../components/PlaylistRow';

export default function LibraryScreen() {
  const insets = useSafeAreaInsets();
  const playlists = usePlaylists(s => s.playlists);
  const loaded = usePlaylists(s => s.loaded);
  const load = usePlaylists(s => s.load);
  const createPlaylist = usePlaylists(s => s.createPlaylist);

  const [modalVisible, setModalVisible] = useState(false);
  // MiniPlayer (60) + safe-area + gap ≈ 90px — jab song chal raha ho
  const contentPadding = useMiniPlayerPadding(spacing.lg);

  // Cold start pe playlists AsyncStorage se laao (FR-4.6)
  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const handleOpenModal = useCallback(() => {
    tapFeedback();
    setModalVisible(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setModalVisible(false);
  }, []);

  const handleCreate = useCallback(
    (name: string) => {
      // Store khud state update + AsyncStorage persist karta hai (FR-4.6)
      createPlaylist(name);
      successFeedback();
      Toast.show({ type: 'success', text1: 'Playlist ban gayi', text2: name });
    },
    [createPlaylist],
  );

  const handlePlaylistPress = useCallback((playlist: Playlist) => {
    router.push(`/playlist/${playlist.id}`);
  }, []);

  const isEmpty = playlists.length === 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerInfo}>
          <Text style={styles.title}>Library 📚</Text>
          <Text style={styles.subtitle}>
            {isEmpty ? 'Apni playlists yahan banao' : `${playlists.length} playlists`}
          </Text>
        </View>

        <Pressable
          onPress={handleOpenModal}
          accessibilityRole="button"
          accessibilityLabel="Nayi playlist banao"
          style={({ pressed }) => [styles.newButton, pressed && styles.pressed]}
        >
          <Ionicons name="add" size={18} color={colors.background} />
          <Text style={styles.newButtonText}>New</Text>
        </Pressable>
      </View>

      {!loaded ? (
        <LoadingSpinner label="Playlists load ho rahi hain…" />
      ) : (
        <FlatList
          data={playlists}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <PlaylistRow playlist={item} onPress={handlePlaylistPress} />
          )}
          contentContainerStyle={[
            { paddingBottom: contentPadding },
            isEmpty && styles.emptyContent,
          ]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <EmptyState
              icon="albums-outline"
              title="Abhi koi playlist nahi"
              subtitle="Ek banao aur apne favourite songs save karo"
            >
              <Pressable
                onPress={handleOpenModal}
                accessibilityRole="button"
                accessibilityLabel="Nayi playlist banao"
                style={({ pressed }) => [styles.emptyButton, pressed && styles.pressed]}
              >
                <Ionicons name="add" size={18} color={colors.background} />
                <Text style={styles.emptyButtonText}>New Playlist</Text>
              </Pressable>
            </EmptyState>
          }
        />
      )}

      <CreatePlaylistModal
        visible={modalVisible}
        onClose={handleCloseModal}
        existingNames={playlists.map(p => p.name)}
        onCreate={handleCreate}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerInfo: { flex: 1 },
  title: { ...typography.h1, color: colors.text },
  subtitle: { ...typography.caption, color: colors.subtext, marginTop: 2 },
  newButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  newButtonText: { ...typography.body, color: colors.background, fontWeight: '700' },
  emptyContent: { flexGrow: 1 },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  emptyButtonText: { ...typography.body, color: colors.background, fontWeight: '700' },
  pressed: { opacity: 0.7 },
});

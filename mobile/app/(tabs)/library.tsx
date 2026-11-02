/**
 * Library tab — playlists (Phase 9).
 * FR-4.1..FR-4.6: create playlist (modal + validation), list me naam + song
 * count, tap pe detail screen (/playlist/[id]) jahan Play All / remove / delete.
 */
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import { Playlist } from '../../types';
import { usePlaylists } from '../../stores/playlistStore';
import { useLikedSongs } from '../../stores/likedSongsStore';
import { useAuthStore } from '../../stores/authStore';
import { isFeatureEnabled } from '../../core/featureflags/featureFlags';
import { useMiniPlayerPadding } from '../../hooks/useMiniPlayerPadding';
import { successFeedback, tapFeedback } from '../../utils/haptics';
import { colors } from '../../constants/colors';
import { typography } from '../../constants/typography';
import { spacing } from '../../constants/spacing';
import CreatePlaylistModal from '../../components/CreatePlaylistModal';
import EmptyState from '../../components/EmptyState';
import LoadingSpinner from '../../components/LoadingSpinner';
import PlaylistRow from '../../components/PlaylistRow';
import { parsePlaylistImportText, PlaylistImportError } from '../../utils/playlistImport';

export default function LibraryScreen() {
  const insets = useSafeAreaInsets();
  const playlists = usePlaylists(s => s.playlists);
  const loaded = usePlaylists(s => s.loaded);
  const load = usePlaylists(s => s.load);
  const createPlaylist = usePlaylists(s => s.createPlaylist);
  const importPlaylists = usePlaylists(s => s.importPlaylists);
  const likedSongs = useLikedSongs(s => s.songs);
  const authStatus = useAuthStore(s => s.status);
  // Phase 6 v1 — downloads flag
  const downloadsEnabled = isFeatureEnabled('downloads_enabled');
  const authUser = useAuthStore(s => s.user);
  const authProfile = useAuthStore(s => s.profile);

  const [modalVisible, setModalVisible] = useState(false);
  const [importing, setImporting] = useState(false);
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

  const handleImport = useCallback(async () => {
    if (importing) return;
    setImporting(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets[0]) return;

      const asset = result.assets[0];
      const text = asset.file
        ? await asset.file.text()
        : await FileSystem.readAsStringAsync(asset.uri);
      const fallbackName = asset.name.replace(/\.json$/i, '').trim() || 'Imported playlist';
      const imported = parsePlaylistImportText(text, fallbackName);
      const created = await importPlaylists(imported);
      const skipped = imported.reduce((total, playlist) => total + playlist.skippedSongs, 0);
      successFeedback();
      Toast.show({
        type: 'success',
        text1: `${created.length} playlist${created.length === 1 ? '' : 's'} import ho gayi`,
        text2: skipped > 0 ? `${skipped} invalid songs skip hoye` : 'Library vich save ho gayi',
      });
    } catch (error) {
      const message =
        error instanceof PlaylistImportError
          ? error.message
          : 'Playlist import nahi ho saki. JSON file check karo.';
      Toast.show({ type: 'error', text1: 'Import failed', text2: message });
    } finally {
      setImporting(false);
    }
  }, [importPlaylists, importing]);

  const handlePlaylistPress = useCallback((playlist: Playlist) => {
    router.push(`/playlist/${playlist.id}`);
  }, []);

  const handleBlendPress = useCallback(() => {
    tapFeedback();
    router.push('/blend');
  }, []);

  const handleJamPress = useCallback(() => {
    tapFeedback();
    router.push('/(tabs)/room');
  }, []);

  const handlePodcastPress = useCallback(() => {
    tapFeedback();
    router.push('/podcast');
  }, []);

  /* Phase 6 v1 — Downloads (flag-gated) */
  const handleDownloadsPress = useCallback(() => {
    tapFeedback();
    router.push('/downloads');
  }, []);

  const handleAccountPress = useCallback(() => {
    tapFeedback();
    router.push(authStatus === 'authenticated' ? '/auth/profile' : '/auth/login');
  }, [authStatus]);

  const handleAiPlaylistPress = useCallback(() => {
    tapFeedback();
    router.push('/ai-playlist');
  }, []);

  const handleAiAssistantPress = useCallback(() => {
    tapFeedback();
    router.push('/ai-assistant');
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

        <View style={styles.headerActions}>
          <Pressable
            onPress={() => void handleImport()}
            disabled={importing}
            accessibilityRole="button"
            accessibilityLabel="Playlist JSON import karo"
            style={({ pressed }) => [styles.importButton, pressed && styles.pressed, importing && styles.disabled]}
          >
            <Ionicons name="download-outline" size={18} color={colors.text} />
            <Text style={styles.importButtonText}>{importing ? 'Importing…' : 'Import'}</Text>
          </Pressable>
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
      </View>

      {/* Account / Profile entry */}
      <Pressable
        onPress={handleAccountPress}
        accessibilityRole="button"
        accessibilityLabel="Account ya Profile kholo"
        style={({ pressed }) => [styles.likedCard, pressed && styles.pressed]}
      >
        <View style={styles.likedIcon}>
          <Ionicons
            name={authStatus === 'authenticated' ? 'person-circle' : 'person-circle-outline'}
            size={24}
            color={colors.primary}
          />
        </View>
        <View style={styles.likedInfo}>
          <Text style={styles.likedTitle}>
            {authStatus === 'authenticated'
              ? (authProfile?.display_name || authUser?.email?.split('@')[0] || 'Mera Account')
              : 'Account & Login'}
          </Text>
          <Text style={styles.likedSubtitle}>
            {authStatus === 'authenticated'
              ? (authUser?.email || 'Signed in')
              : 'Login ya Register karo — sync & backup'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.subtext} />
      </Pressable>

      <Pressable
        onPress={() => router.push('/liked')}
        accessibilityRole="button"
        accessibilityLabel="Liked Songs kholo"
        style={({ pressed }) => [styles.likedCard, pressed && styles.pressed]}
      >
        <View style={styles.likedIcon}>
          <Ionicons name="heart" size={22} color={colors.primary} />
        </View>
        <View style={styles.likedInfo}>
          <Text style={styles.likedTitle}>Liked Songs</Text>
          <Text style={styles.likedSubtitle}>
            {likedSongs.length} {likedSongs.length === 1 ? 'song' : 'songs'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.subtext} />
      </Pressable>

      {/* Phase 6 v1: Downloads entry — flag-gated */}
      {downloadsEnabled ? (
        <Pressable
          onPress={handleDownloadsPress}
          accessibilityRole="button"
          accessibilityLabel="Downloads kholo"
          style={({ pressed }) => [styles.likedCard, pressed && styles.pressed]}
        >
          <View style={styles.likedIcon}>
            <Ionicons name="arrow-down-circle-outline" size={22} color={colors.success} />
          </View>
          <View style={styles.likedInfo}>
            <Text style={styles.likedTitle}>Downloads</Text>
            <Text style={styles.likedSubtitle}>Offline songs — bina net ke bajao</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.subtext} />
        </Pressable>
      ) : null}

      {/* Phase 10: Blend entry */}
      <Pressable
        onPress={handleBlendPress}
        accessibilityRole="button"
        accessibilityLabel="Blends kholo"
        style={({ pressed }) => [styles.likedCard, pressed && styles.pressed]}
      >
        <View style={styles.likedIcon}>
          <Ionicons name="git-merge-outline" size={22} color={colors.primary} />
        </View>
        <View style={styles.likedInfo}>
          <Text style={styles.likedTitle}>Blends</Text>
          <Text style={styles.likedSubtitle}>Dost ke taste se shared mix</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.subtext} />
      </Pressable>

      {/* Group Room entry */}
      <Pressable
        onPress={handleJamPress}
        accessibilityRole="button"
        accessibilityLabel="Group Room kholo"
        style={({ pressed }) => [styles.likedCard, pressed && styles.pressed]}
      >
        <View style={styles.likedIcon}>
          <Ionicons name="people-circle-outline" size={22} color={colors.primary} />
        </View>
        <View style={styles.likedInfo}>
          <Text style={styles.likedTitle}>Group Room 👥</Text>
          <Text style={styles.likedSubtitle}>Doston naal milke sync suno</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.subtext} />
      </Pressable>

      {/* Phase 12a: Podcasts entry */}
      <Pressable
        onPress={handlePodcastPress}
        accessibilityRole="button"
        accessibilityLabel="Podcasts kholo"
        style={({ pressed }) => [styles.likedCard, pressed && styles.pressed]}
      >
        <View style={styles.likedIcon}>
          <Ionicons name="mic-outline" size={22} color={colors.primary} />
        </View>
        <View style={styles.likedInfo}>
          <Text style={styles.likedTitle}>Podcasts</Text>
          <Text style={styles.likedSubtitle}>Sunno — shows ke full episodes</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.subtext} />
      </Pressable>

      {/* Phase 13b: AI Playlist entry (flag gate screen ke andar hai) */}
      <Pressable
        onPress={handleAiPlaylistPress}
        accessibilityRole="button"
        accessibilityLabel="AI Playlist kholo"
        style={({ pressed }) => [styles.likedCard, pressed && styles.pressed]}
      >
        <View style={styles.likedIcon}>
          <Ionicons name="sparkles-outline" size={22} color={colors.primary} />
        </View>
        <View style={styles.likedInfo}>
          <Text style={styles.likedTitle}>AI Playlist</Text>
          <Text style={styles.likedSubtitle}>Prompt likho — AI mix banaye</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.subtext} />
      </Pressable>

      {/* Phase 13c: AI Assistant entry (flag gate screen ke andar hai) */}
      <Pressable
        onPress={handleAiAssistantPress}
        accessibilityRole="button"
        accessibilityLabel="AI Assistant kholo"
        style={({ pressed }) => [styles.likedCard, pressed && styles.pressed]}
      >
        <View style={styles.likedIcon}>
          <Ionicons name="chatbubbles-outline" size={22} color={colors.primary} />
        </View>
        <View style={styles.likedInfo}>
          <Text style={styles.likedTitle}>AI Assistant</Text>
          <Text style={styles.likedSubtitle}>Chat karo — gaane chalao, dhoondo</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.subtext} />
      </Pressable>

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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  importButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  importButtonText: { ...typography.body, color: colors.text, fontWeight: '600' },
  likedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  likedIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary + '22',
  },
  likedInfo: { flex: 1, gap: 2 },
  likedTitle: { ...typography.body, color: colors.text, fontWeight: '700' },
  likedSubtitle: { ...typography.caption, color: colors.subtext },
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
  disabled: { opacity: 0.55 },
});

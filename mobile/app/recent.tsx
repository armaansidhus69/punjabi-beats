/**
 * Recently Played — /recent (Phase 14 "Recently played screen").
 * storage.ts ki last-20 history (playerStore har play pe addRecentlyPlayed
 * call karta hai — FR-8.1). Home screen ke clock icon se khulta hai.
 */
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Song } from '../types';
import { getRecentlyPlayed } from '../services/storage';
import { usePlayer } from '../stores/playerStore';
import { useMiniPlayerPadding } from '../hooks/useMiniPlayerPadding';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { spacing } from '../constants/spacing';
import EmptyState from '../components/EmptyState';
import LoadingSpinner from '../components/LoadingSpinner';
import SongItem from '../components/SongItem';

export default function RecentlyPlayedScreen() {
  const insets = useSafeAreaInsets();
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);

  const playSong = usePlayer(s => s.playSong);
  const currentSongId = usePlayer(s => s.currentSong?.id ?? null);
  const contentPadding = useMiniPlayerPadding(spacing.xl);

  // Mount pe history laao (screen har baar fresh — wapas aane pe nayi plays dikhein)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const recent = await getRecentlyPlayed();
      if (!cancelled) {
        setSongs(recent);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSongPress = useCallback(
    (song: Song) => {
      // Poori history queue ban jaati hai (auto-next ke liye)
      void playSong(song, songs);
    },
    [playSong, songs],
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Wapas jao"
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Recently Played</Text>
        <View style={styles.iconSpacer} />
      </View>

      <FlatList
        data={songs}
        keyExtractor={song => song.id}
        renderItem={({ item }) => (
          <SongItem song={item} onPress={handleSongPress} isActive={item.id === currentSongId} />
        )}
        contentContainerStyle={{ paddingBottom: contentPadding, flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          loading ? (
            <LoadingSpinner label="History load ho rahi hai…" />
          ) : (
            <EmptyState
              icon="time-outline"
              title="Abhi kuch play nahi hua"
              subtitle="Jo songs sunoge wo yahan dikhenge (last 20)"
            />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  iconButton: { padding: spacing.xs },
  iconSpacer: { width: 30 },
  headerTitle: { ...typography.h1, color: colors.text, flex: 1, textAlign: 'center' },
  pressed: { opacity: 0.7 },
});
/**
 * Blend list — /blend/index (Phase 10 roadmap).
 * Meri blends + create CTA. Entry point Library tab ke header se.
 */
import { useCallback } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BlendGate from '../../components/BlendGate';
import EmptyState from '../../components/EmptyState';
import LoadingSpinner from '../../components/LoadingSpinner';
import { Blend } from '../../types';
import { useBlends } from '../../stores/blendStore';
import { colors } from '../../constants/colors';
import { typography } from '../../constants/typography';
import { spacing } from '../../constants/spacing';
import { tapFeedback } from '../../utils/haptics';
import { blendComputeStatusShortLabel } from '../../utils/blendLabels';

export default function BlendListScreen() {
  const insets = useSafeAreaInsets();
  const blends = useBlends(s => s.blends);
  const blendsLoading = useBlends(s => s.blendsLoading);
  const loadBlends = useBlends(s => s.loadBlends);

  // Screen focus pe refresh (dost ne join kiya ho to count fresh dikhe)
  useFocusEffect(
    useCallback(() => {
      void loadBlends();
    }, [loadBlends]),
  );

  const handlePress = useCallback((id: string) => {
    tapFeedback();
    router.push(`/blend/${id}`);
  }, []);

  const handleCreate = useCallback(() => {
    tapFeedback();
    router.push('/blend/create');
  }, []);

  return (
    <BlendGate>
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
          <Text style={styles.headerTitle}>Blends</Text>
          <View style={styles.iconSpacer} />
        </View>

        <FlatList
          data={blends}
          keyExtractor={item => item.id}
          renderItem={({ item }) => <BlendRow blend={item} onPress={handlePress} />}
          contentContainerStyle={{ paddingBottom: 120, flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            blendsLoading ? (
              <LoadingSpinner label="Blends load ho rahe hain…" />
            ) : (
              <EmptyState
                icon="git-merge-outline"
                title="Koi blend nahi"
                subtitle="Dost ke taste ke saath shared playlist banaiye"
              />
            )
          }
        />

        <Pressable
          style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
          onPress={handleCreate}
          accessibilityRole="button"
          accessibilityLabel="Naya Blend banao"
        >
          <Ionicons name="add" size={28} color={colors.background} />
          <Text style={styles.fabText}>Naya Blend</Text>
        </Pressable>
      </View>
    </BlendGate>
  );
}

function BlendRow({ blend, onPress }: { blend: Blend; onPress: (id: string) => void }) {
  const status = blendComputeStatusShortLabel(blend.computeStatus);
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => onPress(blend.id)}
      accessibilityRole="button"
      accessibilityLabel={`${blend.name} kholo`}
    >
      <Ionicons name="git-merge-outline" size={30} color={colors.primary} />
      <View style={styles.rowText}>
        <Text style={styles.rowName} numberOfLines={1}>
          {blend.name}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {status} · code {blend.inviteCode}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.subtext} />
    </Pressable>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.xs,
    padding: spacing.lg,
    borderRadius: 14,
  },
  rowPressed: { opacity: 0.85 },
  rowText: { flex: 1, gap: 2 },
  rowName: { ...typography.h2, color: colors.text },
  rowMeta: { ...typography.caption, color: colors.subtext },
  fab: {
    position: 'absolute',
    right: spacing.xl,
    bottom: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: 999,
    elevation: 4,
  },
  fabText: { ...typography.body, color: colors.background, fontWeight: '700' },
  pressed: { opacity: 0.7 },
});

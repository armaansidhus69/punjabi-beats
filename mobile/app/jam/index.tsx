/**
 * Jam list — /jam/index (Phase 11 roadmap).
 * Meri rooms + create CTA. Entry point Library tab ke Jam card.
 */
import { useCallback } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import JamGate from '../../components/JamGate';
import EmptyState from '../../components/EmptyState';
import LoadingSpinner from '../../components/LoadingSpinner';
import { JamRoom } from '../../types';
import { useJam } from '../../stores/jamStore';
import { colors } from '../../constants/colors';
import { typography } from '../../constants/typography';
import { spacing } from '../../constants/spacing';
import { tapFeedback } from '../../utils/haptics';
import { roomStatusLabel, roomTypeLabel } from '../../utils/jamLabels';

export default function JamListScreen() {
  const insets = useSafeAreaInsets();
  const rooms = useJam(s => s.rooms);
  const roomsLoading = useJam(s => s.roomsLoading);
  const loadRooms = useJam(s => s.loadRooms);

  // Focus pe fresh (naya join/cron expiry dikh jaye)
  useFocusEffect(
    useCallback(() => {
      void loadRooms();
    }, [loadRooms]),
  );

  const handlePress = useCallback((id: string) => {
    tapFeedback();
    router.push(`/jam/${id}`);
  }, []);

  const handleCreate = useCallback(() => {
    tapFeedback();
    router.push('/jam/create');
  }, []);

  return (
    <JamGate>
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
          <Text style={styles.headerTitle}>Jam Rooms</Text>
          <View style={styles.iconSpacer} />
        </View>

        <FlatList
          data={rooms}
          keyExtractor={item => item.id}
          renderItem={({ item }) => <RoomRow room={item} onPress={handlePress} />}
          contentContainerStyle={{ paddingBottom: 120, flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            roomsLoading ? (
              <LoadingSpinner label="Rooms load ho rahe hain…" />
            ) : (
              <EmptyState
                icon="people-circle-outline"
                title="Koi room nahi"
                subtitle="Jam ya Listening Party shuru karo — code se dost jod do"
              />
            )
          }
        />

        <Pressable
          style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
          onPress={handleCreate}
          accessibilityRole="button"
          accessibilityLabel="Naya room banao"
        >
          <Ionicons name="add" size={28} color={colors.background} />
          <Text style={styles.fabText}>Naya Room</Text>
        </Pressable>
      </View>
    </JamGate>
  );
}

function RoomRow({ room, onPress }: { room: JamRoom; onPress: (id: string) => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => onPress(room.id)}
      accessibilityRole="button"
      accessibilityLabel={`${room.title} kholo`}
    >
      <Ionicons name="people-circle-outline" size={34} color={colors.primary} />
      <View style={styles.rowText}>
        <Text style={styles.rowName} numberOfLines={1}>
          {room.title}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {roomTypeLabel(room.type)} · {roomStatusLabel(room.status)} · code {room.inviteCode}
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

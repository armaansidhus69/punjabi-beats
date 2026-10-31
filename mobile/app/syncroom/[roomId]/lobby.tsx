import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSyncRoomStore } from '../../../stores/syncRoomStore';
import { colors } from '../../../constants/colors';
import { typography } from '../../../constants/typography';
import { spacing } from '../../../constants/spacing';
import { tapFeedback } from '../../../utils/haptics';

export default function SyncRoomLobbyScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const snapshot = useSyncRoomStore((s) => s.snapshot);

  const handleStart = () => {
    tapFeedback();
    router.replace(`/syncroom/${roomId}/listen`);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.iconButton}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Room Lobby</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.roomName}>{snapshot?.room.name || 'SyncRoom'}</Text>
        <Text style={styles.subtitle}>
          Sabhi members connect ho rahe hain. Ready hone par listening screen kholo.
        </Text>

        {snapshot?.room.inviteCode ? (
          <View style={styles.codeCard}>
            <Text style={styles.codeLabel}>INVITE CODE</Text>
            <Text style={styles.codeText}>{snapshot.room.inviteCode}</Text>
          </View>
        ) : null}

        <View style={styles.membersCard}>
          <Text style={styles.sectionTitle}>MEMBERS ({snapshot?.members.length ?? 1})</Text>
          {(snapshot?.members ?? []).map((m) => (
            <View key={m.userId} style={styles.memberRow}>
              <Ionicons name="person-circle-outline" size={20} color={colors.primary} />
              <Text style={styles.memberName}>{m.displayName || m.userId.slice(0, 8)}</Text>
              <Text style={styles.memberRole}>{m.role}</Text>
            </View>
          ))}
        </View>

        <Pressable style={styles.btnPrimary} onPress={handleStart}>
          <Ionicons name="play" size={18} color={colors.background} />
          <Text style={styles.btnPrimaryText}>Start Listening</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  btnPrimary: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: spacing.xl,
    paddingVertical: 14,
  },
  btnPrimaryText: {
    color: colors.background,
    fontSize: 15,
    fontWeight: '700',
  },
  codeCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    borderWidth: 1,
    marginVertical: spacing.md,
    padding: spacing.md,
  },
  codeLabel: {
    ...typography.caption,
    color: colors.subtext,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  codeText: {
    color: colors.primary,
    fontFamily: 'monospace',
    fontSize: 24,
    fontWeight: 'bold',
    letterSpacing: 4,
    marginTop: 4,
  },
  container: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  headerSpacer: {
    width: 30,
  },
  headerTitle: {
    ...typography.h1,
    color: colors.text,
    fontSize: 18,
  },
  iconButton: {
    padding: spacing.xs,
  },
  memberName: {
    color: colors.text,
    flex: 1,
    fontSize: 14,
  },
  memberRole: {
    ...typography.caption,
    color: colors.subtext,
    textTransform: 'uppercase',
  },
  memberRow: {
    alignItems: 'center',
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 10,
  },
  membersCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.md,
  },
  roomName: {
    ...typography.h1,
    color: colors.text,
    fontSize: 22,
    textAlign: 'center',
  },
  sectionTitle: {
    ...typography.caption,
    color: colors.subtext,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.subtext,
    marginTop: 4,
    textAlign: 'center',
  },
});


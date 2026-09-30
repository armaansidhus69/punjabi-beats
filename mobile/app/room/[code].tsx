/**
 * Room screen — /room/[code] (Phase 10 + 11).
 *
 * Phase 10: room code prominently, Host/Joined badge, connection status,
 * invite (share sheet) aur leave button.
 * Phase 11: real-time sync yahan se nahi — `roomSync.ts` store ke lifecycle
 * events sun ke khud channel manage karta hai; ye screen sirf state dikhati hai
 * (connection state ko `state_change` listener khud update karta hai, polling nahi).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CONNECTION_DOT, CONNECTION_LABEL } from '../../constants/connection';
import { useRoom } from '../../stores/roomStore';
import { setChatOpen } from '../../services/roomSync';
import ChatModal from '../../components/ChatModal';
import { useMiniPlayerPadding } from '../../hooks/useMiniPlayerPadding';
import { successFeedback, warningFeedback } from '../../utils/haptics';
import { colors } from '../../constants/colors';
import { typography } from '../../constants/typography';
import { spacing } from '../../constants/spacing';
import EmptyState from '../../components/EmptyState';

/** Room code 6 digits (FR-5.1) */
const CODE_PATTERN = /^\d{6}$/;

export default function RoomScreen() {
  const insets = useSafeAreaInsets();
  // Route param deep link se galat bhi aa sakta hai — defensively handle
  const params = useLocalSearchParams<{ code?: string }>();
  const routeCode = typeof params.code === 'string' ? params.code.trim() : '';
  const validCode = CODE_PATTERN.test(routeCode);

  const roomCode = useRoom(s => s.code);
  const isHost = useRoom(s => s.isHost);
  const status = useRoom(s => s.connectionState);
  const roomError = useRoom(s => s.error);
  const members = useRoom(s => s.members);
  const unreadCount = useRoom(s => s.unreadCount);
  const joinRoom = useRoom(s => s.joinRoom);
  const leaveRoom = useRoom(s => s.leaveRoom);

  const [joinError, setJoinError] = useState<string | null>(null);
  /** FR-5.12 chat modal open state (badge modal khulne pe reset hota hai) */
  const [chatVisible, setChatVisible] = useState(false);
  /** Leave dabane ke baad auto-join effect dobara join na kar le (race guard) */
  const leftRef = useRef(false);
  const contentPadding = useMiniPlayerPadding(spacing.xl);

  // Code param se auto-join. Host apne hi room me ho to dobara join nahi karte
  // (warna host flag ud jaata hai).
  useEffect(() => {
    if (leftRef.current) return; // user ne leave kiya — dobara join mat karo
    if (!validCode) {
      setJoinError('Room code 6 digits ka hona chahiye');
      return;
    }
    if (roomCode === routeCode) {
      setJoinError(null);
      return;
    }
    try {
      joinRoom(routeCode);
      setJoinError(null);
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : 'Room join nahi ho paya');
    }
  }, [joinRoom, roomCode, routeCode, validCode]);

  // Connection state roomSync `state_change` event se update karta hai — yahan
  // koi polling nahi chahiye (SDK reconnect khud karta hai, max 6 attempts).

  // NOTE: back pe room leave NAHI hota (minimize jaisa) — sync background me
  // chalta rehta hai (MiniPlayer). Explicit leave = "Leave Room" button neeche
  // (FR-5.7) ya Room tab ke current-room card se.

  const handleLeave = useCallback(() => {
    warningFeedback();
    leftRef.current = true; // pehle flag, warna effect race karke dobara join lega
    leaveRoom();
    router.back();
  }, [leaveRoom]);

  const handleOpenChat = useCallback(() => {
    successFeedback();
    setChatVisible(true);
  }, []);

  const handleInvite = useCallback(() => {
    if (!validCode) return;
    successFeedback();
    void Share.share({
      message: `Punjabi Beats ke group room me aa jao! Room code: ${routeCode}`,
    }).catch(err => {
      console.warn('Room invite share failed:', err);
    });
  }, [routeCode, validCode]);

  // Invalid code (deep link) — crash ki jagah friendly screen
  if (!validCode) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <BackHeader />
        <EmptyState
          icon="key-outline"
          title="Room code galat hai"
          subtitle={`"${routeCode}" 6-digit room code nahi hai`}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <BackHeader />

      <View style={[styles.body, { paddingBottom: contentPadding }]}>
        <Text style={styles.label}>Room Code</Text>
        <Text style={styles.code} accessibilityLabel={`Room code ${routeCode}`}>
          {routeCode}
        </Text>

        <View style={styles.badgeRow}>
          <View style={[styles.badge, isHost ? styles.badgeHost : styles.badgeGuest]}>
            <Ionicons name={isHost ? 'star' : 'person-add'} size={14} color={colors.text} />
            <Text style={styles.badgeText}>{isHost ? 'Host' : 'Joined'}</Text>
          </View>

          <View style={styles.statusPill}>
            <View style={[styles.statusDot, { backgroundColor: CONNECTION_DOT[status] }]} />
            <Text style={styles.statusText}>{CONNECTION_LABEL[status]}</Text>
          </View>
        </View>

        {joinError ?? roomError ? (
          <Text style={styles.errorText}>{joinError ?? roomError}</Text>
        ) : null}

        <Text style={styles.members}>
          {members.length > 1
            ? `${members.length} log room me hain`
            : 'Abhi aap akele ho — code share karo'}
        </Text>
        {members.length > 1 ? (
          <Text style={styles.memberNames}>{members.map(m => m.name).join(', ')}</Text>
        ) : null}

        <Pressable
          onPress={handleInvite}
          accessibilityRole="button"
          accessibilityLabel="Room code share karo"
          style={({ pressed }) => [styles.inviteButton, pressed && styles.pressed]}
        >
          <Ionicons name="share-social-outline" size={18} color={colors.text} />
          <Text style={styles.inviteText}>Invite doston ko</Text>
        </Pressable>

        {/* FR-5.12 room chat — unread badge (modal band ho to aaye messages) */}
        <Pressable
          onPress={handleOpenChat}
          accessibilityRole="button"
          accessibilityLabel={
            unreadCount > 0 ? `Chat kholo, ${unreadCount} naye messages` : 'Chat kholo'
          }
          style={({ pressed }) => [styles.chatButton, pressed && styles.pressed]}
        >
          <Ionicons name="chatbubbles-outline" size={18} color={colors.text} />
          <Text style={styles.inviteText}>Chat</Text>
          {unreadCount > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadText}>{unreadCount > 99 ? '99+' : String(unreadCount)}</Text>
            </View>
          )}
        </Pressable>

        <ChatModal
          visible={chatVisible}
          onClose={() => setChatVisible(false)}
          onOpenChange={setChatOpen}
        />

        <Text style={styles.hint}>
          Room me sab log ek hi song sunte hain — song, play/pause aur seek sab
          connected devices pe saath chalte hain.
        </Text>
      </View>

      <Pressable
        onPress={handleLeave}
        accessibilityRole="button"
        accessibilityLabel="Room chhodo"
        style={({ pressed }) => [
          styles.leaveButton,
          { marginBottom: insets.bottom + spacing.lg },
          pressed && styles.pressed,
        ]}
      >
        <Ionicons name="exit-outline" size={18} color={colors.background} />
        <Text style={styles.leaveText}>Leave Room</Text>
      </Pressable>
    </View>
  );
}

/** Simple back header (root layout me headerShown: false hai) */
function BackHeader() {
  return (
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
      <Text style={styles.headerTitle}>Group Room</Text>
      <View style={styles.headerSpacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  iconButton: { padding: spacing.xs },
  headerTitle: { ...typography.h1, color: colors.text },
  headerSpacer: { width: 30 },
  body: { flex: 1, alignItems: 'center', paddingTop: spacing.xl, paddingHorizontal: spacing.lg },
  label: { ...typography.caption, color: colors.subtext, letterSpacing: 2 },
  code: {
    ...typography.h1,
    fontSize: 46,
    color: colors.primary,
    letterSpacing: 8,
    marginTop: spacing.sm,
  },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeHost: { borderColor: colors.primary, backgroundColor: colors.card },
  badgeGuest: { borderColor: colors.border, backgroundColor: colors.surface },
  badgeText: { ...typography.caption, color: colors.text, fontWeight: '700' },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    backgroundColor: colors.surface,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { ...typography.caption, color: colors.subtext },
  errorText: { ...typography.caption, color: '#ff6b6b', marginTop: spacing.md },
  members: { ...typography.body, color: colors.subtext, marginTop: spacing.lg },
  memberNames: { ...typography.caption, color: colors.text, marginTop: spacing.xs },
  inviteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginTop: spacing.xl,
  },
  chatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginTop: spacing.md,
  },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  unreadText: { ...typography.caption, fontSize: 11, color: colors.background, fontWeight: '700' },
  inviteText: { ...typography.body, color: colors.text, fontWeight: '600' },
  hint: {
    ...typography.caption,
    color: colors.subtext,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  leaveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  leaveText: { ...typography.body, color: colors.background, fontWeight: '700' },
  pressed: { opacity: 0.7 },
});

/**
 * Room screen — /room/[code] (Phase 10 + 11).
 *
 * Phase 10: room code prominently, Host/Joined badge, connection status,
 * invite (share sheet) aur leave button.
 * Phase 11: real-time sync yahan se nahi — `roomSync.ts` store ke lifecycle
 * events sun ke khud channel manage karta hai; ye screen sirf state dikhati hai
 * (connection state ko `state_change` listener khud update karta hai, polling nahi).
 * Real-Time Jam: interactive JamPads soundboard for live collaborative beat-making.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CONNECTION_DOT, CONNECTION_LABEL } from '../../constants/connection';
import { useRoom } from '../../stores/roomStore';
import { usePlayer } from '../../stores/playerStore';
import { setChatOpen } from '../../services/roomSync';
import ChatModal from '../../components/ChatModal';
import JamPads from '../../components/JamPads';
import TrackSleeveArt from '../../components/TrackSleeveArt';
import { useMiniPlayerPadding } from '../../hooks/useMiniPlayerPadding';
import { successFeedback, tapFeedback, warningFeedback } from '../../utils/haptics';
import { colors } from '../../constants/colors';
import { typography } from '../../constants/typography';
import { spacing } from '../../constants/spacing';
import EmptyState from '../../components/EmptyState';
import { shareRoom } from '../../services/shareComposerFacade';

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
  const currentSong = usePlayer(s => s.currentSong);
  const isPlaying = usePlayer(s => s.isPlaying);

  const [joinError, setJoinError] = useState<string | null>(null);
  /** FR-5.12 chat modal open state (badge modal khulne pe reset hota hai) */
  const [chatVisible, setChatVisible] = useState(false);
  const [showJamPads, setShowJamPads] = useState(true);
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
    void shareRoom(routeCode);
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

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: contentPadding }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.body}>
          <View style={styles.sleeveContainer}>
            <TrackSleeveArt
              title={currentSong ? currentSong.title : 'Live Jam'}
              artist={currentSong ? currentSong.artist : 'Punjabi Beats'}
              isPlaying={isPlaying}
              size="md"
            />
          </View>

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

          <View style={styles.actionsRow}>
            <Pressable
              onPress={handleInvite}
              accessibilityRole="button"
              accessibilityLabel="Room code share karo"
              style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
            >
              <Ionicons name="share-social-outline" size={18} color={colors.text} />
              <Text style={styles.actionText}>Invite</Text>
            </Pressable>

            <Pressable
              onPress={handleOpenChat}
              accessibilityRole="button"
              accessibilityLabel={
                unreadCount > 0 ? `Chat kholo, ${unreadCount} naye messages` : 'Chat kholo'
              }
              style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
            >
              <Ionicons name="chatbubbles-outline" size={18} color={colors.text} />
              <Text style={styles.actionText}>Chat</Text>
              {unreadCount > 0 && (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadText}>{unreadCount > 99 ? '99+' : String(unreadCount)}</Text>
                </View>
              )}
            </Pressable>

            <Pressable
              onPress={() => {
                tapFeedback();
                setShowJamPads(p => !p);
              }}
              accessibilityRole="button"
              accessibilityLabel="Jam pads toggle karo"
              style={({ pressed }) => [
                styles.actionButton,
                showJamPads && styles.actionButtonActive,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons
                name="musical-notes-outline"
                size={18}
                color={showJamPads ? colors.primary : colors.text}
              />
              <Text
                style={[
                  styles.actionText,
                  showJamPads && { color: colors.primary, fontWeight: '700' },
                ]}
              >
                {showJamPads ? 'Hide Pads' : 'Jam Pads'}
              </Text>
            </Pressable>
          </View>

          {showJamPads && (
            <View style={styles.padsContainer}>
              <JamPads />
            </View>
          )}

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
      </ScrollView>
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
  actionButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  actionButtonActive: {
    borderColor: colors.primary,
  },
  actionText: { ...typography.body, color: colors.text, fontWeight: '600', fontSize: 13 },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    flexWrap: 'wrap',
  },
  badge: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  badgeGuest: { backgroundColor: colors.surface, borderColor: colors.border },
  badgeHost: { backgroundColor: colors.card, borderColor: colors.primary },
  badgeRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  badgeText: { ...typography.caption, color: colors.text, fontWeight: '700' },
  body: { alignItems: 'center', flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  code: {
    ...typography.h1,
    color: colors.primary,
    fontSize: 46,
    letterSpacing: 8,
    marginTop: spacing.sm,
  },
  container: { backgroundColor: colors.background, flex: 1 },
  errorText: { ...typography.caption, color: '#ff6b6b', marginTop: spacing.md },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  headerSpacer: { width: 30 },
  headerTitle: { ...typography.h1, color: colors.text },
  hint: {
    ...typography.caption,
    color: colors.subtext,
    marginTop: spacing.xl,
    textAlign: 'center',
  },
  iconButton: { padding: spacing.xs },
  label: { ...typography.caption, color: colors.subtext, letterSpacing: 2 },
  leaveButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 999,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
  },
  leaveText: { ...typography.body, color: colors.background, fontWeight: '700' },
  memberNames: { ...typography.caption, color: colors.text, marginTop: spacing.xs },
  members: { ...typography.body, color: colors.subtext, marginTop: spacing.lg },
  padsContainer: {
    marginTop: spacing.md,
    width: '100%',
  },
  sleeveContainer: {
    marginBottom: spacing.md,
  },
  pressed: { opacity: 0.7 },
  scrollContent: {
    flexGrow: 1,
  },
  statusDot: { borderRadius: 4, height: 8, width: 8 },
  statusPill: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 999,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  statusText: { ...typography.caption, color: colors.subtext },
  unreadBadge: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 11,
    height: 22,
    justifyContent: 'center',
    minWidth: 22,
    paddingHorizontal: spacing.xs,
  },
  unreadText: { ...typography.caption, color: colors.background, fontSize: 11, fontWeight: '700' },
});

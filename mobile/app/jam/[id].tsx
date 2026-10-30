/**
 * Jam room detail — /jam/[id] (Phase 11 roadmap).
 * Server-authoritative room UI: now-playing (role-gated controls), queue,
 * member chips + role menu (mute/remove/assign), chat sheet + reactions.
 * share (code+deep link). Playback follow logic jamStore me hai (realtime).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import Toast from 'react-native-toast-message';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import JamGate from '../../components/JamGate';
import AddSongSearchModal from '../../components/AddSongSearchModal';
import LoadingSpinner from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';
import type { JamMessage, JamQueueItem, RoomRole } from '../../types';
import { getCurrentUser } from '../../core/auth/authService';
import { can } from '../../core/room/permissions';
import { shareJam } from '../../services/shareComposerFacade';
import { useJam, canControlPlayback, type AssignableRole } from '../../stores/jamStore';
import { usePlayer } from '../../stores/playerStore';
import { useMiniPlayerPadding } from '../../hooks/useMiniPlayerPadding';
import { isPresenceStale } from '../../core/room/timeModel';
import { colors } from '../../constants/colors';
import { typography } from '../../constants/typography';
import { spacing } from '../../constants/spacing';
import { successFeedback, tapFeedback } from '../../utils/haptics';
import { roomRoleLabel, roomStatusLabel, roomTypeLabel } from '../../utils/jamLabels';

const REACTION_EMOJIS = ['🔥', '❤️', '😂', '🕺', '🎶', '😭'] as const;

export default function JamRoomScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const contentPadding = useMiniPlayerPadding(spacing.xl);

  const room = useJam(s => s.activeRoom);
  const members = useJam(s => s.activeMembers);
  const queue = useJam(s => s.activeQueue);
  const messages = useJam(s => s.activeMessages);
  const myRole = useJam(s => s.myRole);
  const serverPlayback = useJam(s => s.serverPlayback);
  const loading = useJam(s => s.loading);
  const detailError = useJam(s => s.detailError);
  const openRoom = useJam(s => s.openRoom);
  const closeActive = useJam(s => s.closeActive);
  const refreshActive = useJam(s => s.refreshActive);
  const leaveActive = useJam(s => s.leaveActive);
  const queueAddSong = useJam(s => s.queueAddSong);
  const queueRemoveItem = useJam(s => s.queueRemoveItem);
  const jamPlay = useJam(s => s.jamPlay);
  const jamPause = useJam(s => s.jamPause);
  const jamSeek = useJam(s => s.jamSeek);
  const jamNext = useJam(s => s.jamNext);
  const muteMember = useJam(s => s.muteMember);
  const unmuteMember = useJam(s => s.unmuteMember);
  const removeMember = useJam(s => s.removeMember);
  const assignRole = useJam(s => s.assignRole);
  const sendChatMessage = useJam(s => s.sendChatMessage);
  const sendReaction = useJam(s => s.sendReaction);
  const closeRoom = useJam(s => s.closeRoom);

  const playerTrackId = usePlayer(s => s.currentSong?.id ?? null);
  const isPlaying = usePlayer(s => s.isPlaying);
  const playerPositionMs = usePlayer(s => s.position);

  const [meId, setMeId] = useState<string | null>(null);
  const [addSongsVisible, setAddSongsVisible] = useState(false);
  const [chatVisible, setChatVisible] = useState(false);
  const [chatDraft, setChatDraft] = useState('');
  const [menuUserId, setMenuUserId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof id === 'string' && id.length > 0) void openRoom(id);
    void getCurrentUser().then(user => setMeId(user?.id ?? null));
    // leave screen → store teardown (channel + heartbeat)
    return () => closeActive();
  }, [id, openRoom, closeActive]);

  const isOwner = room !== null && meId !== null && room.ownerId === meId;
  const canControl = canControlPlayback(myRole, room?.type ?? 'jam');
  const canQueue = myRole !== null && (can(myRole, 'queue_add', room?.type ?? 'jam'));
  const nowPlaying = room?.type === 'listening_party' && !canControl;

  const handleShare = useCallback(async () => {
    if (!room) return;
    await shareJam(room.title, room.inviteCode, room.type);
  }, [room]);

  const handlePlayPause = useCallback(() => {
    const server = useJam.getState().serverPlayback;
    if (!server) return;
    if (isPlaying) {
      void jamPause(playerPositionMs).catch(() => Toast.show({ type: 'error', text1: 'Pause fail hua' }));
    } else {
      void jamPlay(playerPositionMs).catch(() => Toast.show({ type: 'error', text1: 'Play fail hua' }));
    }
  }, [isPlaying, jamPause, jamPlay, playerPositionMs]);

  const handleSeek = useCallback(
    (deltaMs: number) => {
      const target = Math.max(0, playerPositionMs + deltaMs);
      void jamSeek(target).catch(() => Toast.show({ type: 'error', text1: 'Seek fail hua' }));
    },
    [jamSeek, playerPositionMs],
  );

  const handleNext = useCallback(() => {
    void jamNext().catch(() => Toast.show({ type: 'error', text1: 'Skip fail hua' }));
  }, [jamNext]);

  const handleRemoveQueueItem = useCallback(
    (item: JamQueueItem) => {
      const own = item.addedBy !== null && item.addedBy === meId;
      const permissionOwnRemove =
        myRole !== null && (can(myRole, 'queue_remove_any', room?.type ?? 'jam') || (own && can(myRole, 'queue_remove_own', room?.type ?? 'jam')));
      if (!permissionOwnRemove) {
        Toast.show({ type: 'error', text1: 'Queue permission nahi hai' });
        return;
      }
      void queueRemoveItem(item)
        .then(() => successFeedback())
        .catch(() => Toast.show({ type: 'error', text1: 'Remove fail hua' }));
    },
    [meId, myRole, queueRemoveItem, room?.type],
  );

  const handleSendChat = useCallback(() => {
    const body = chatDraft.trim();
    if (body.length === 0) return;
    setChatDraft('');
    void sendChatMessage(body).catch(() => Toast.show({ type: 'error', text1: 'Chat bheja nahi ja paya' }));
  }, [chatDraft, sendChatMessage]);

  const handleLeave = useCallback(() => {
    Alert.alert(room?.type === 'jam' ? 'Jam chhodo?' : 'Party chhodo?', isOwner
      ? 'Owner nikle to co-host promote hoga (ya room band).'
      : 'Room se nikal jayoge.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: () => {
          void leaveActive()
            .then(() => {
              successFeedback();
              router.back();
            })
            .catch(() => Toast.show({ type: 'error', text1: 'Leave fail hua' }));
        },
      },
    ]);
  }, [isOwner, leaveActive, room?.type]);

  const handleCloseRoom = useCallback(() => {
    Alert.alert('Room band karo?', 'Sab members nikal jayenge — list me closed dikhega.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Close',
        style: 'destructive',
        onPress: () => {
          void closeRoom()
            .then(() => {
              successFeedback();
              router.back();
            })
            .catch(() => Toast.show({ type: 'error', text1: 'Close fail hua' }));
        },
      },
    ]);
  }, [closeRoom]);

  if (typeof id !== 'string' || id.length === 0) {
    return (
      <JamGate>
        <View style={styles.center}>
          <EmptyState icon="people-circle-outline" title="Room missing" subtitle="Link galat lag raha hai" />
        </View>
      </JamGate>
    );
  }

  if (loading || (detailError === null && room === null)) {
    return (
      <JamGate>
        <View style={styles.center}>
          <LoadingSpinner label="Room load ho raha hai…" />
        </View>
      </JamGate>
    );
  }

  if (detailError !== null || room === null) {
    return (
      <JamGate>
        <View style={styles.center}>
          <EmptyState icon="alert-circle-outline" title="Room nahi mila" subtitle={detailError ?? 'Access check karo'} />
          <Pressable style={styles.textButton} onPress={() => void refreshActive()}>
            <Text style={styles.textButtonText}>Refresh</Text>
          </Pressable>
          <Pressable style={styles.textButton} onPress={router.back}>
            <Text style={styles.textButtonText}>Wapas jao</Text>
          </Pressable>
        </View>
      </JamGate>
    );
  }

  return (
    <JamGate>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* header */}
        <View style={st.header}>
          <Pressable onPress={router.back} hitSlop={12} accessibilityRole="button">
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={st.headerTitle} numberOfLines={1}>
              {room.title}
            </Text>
            <Text style={st.headerMeta}>
              {roomTypeLabel(room.type)} · {roomStatusLabel(room.status)}
            </Text>
          </View>
          <Pressable onPress={() => void handleShare()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Invite share karo">
            <Ionicons name="share-social-outline" size={22} color={colors.primary} />
          </Pressable>
        </View>

        {room.status !== 'active' && (
          <View style={st.banner}>
            <Text style={st.bannerText}>Room {roomStatusLabel(room.status)} hai — browse-only.</Text>
          </View>
        )}

        <FlatList
          data={queue}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingBottom: contentPadding, flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View>
              <MemberStrip
                members={members}
                ownerId={room.ownerId}
                meId={meId}
                onOpenMenu={setMenuUserId}
              />

              {/* now playing / host banner */}
              <NowPlayingCard
                serverTitle={serverPlayback?.track?.title ?? null}
                serverIsPlaying={serverPlayback?.isPlaying ?? false}
                canControl={canControl}
                listenerNotice={nowPlaying}
                onPlayPause={handlePlayPause}
                onSeek={handleSeek}
                onNext={handleNext}
              />

              <View style={st.actions}>
                {canQueue && (
                  <ActionChip label="Add songs" icon="add-circle-outline" onPress={() => setAddSongsVisible(true)} />
                )}
                <ActionChip label="Chat" icon="chatbubble-outline" onPress={() => setChatVisible(true)} />
                {/* reactions inline */}
                <View style={st.reactionRow}>
                  {REACTION_EMOJIS.map(emoji => (
                    <Pressable
                      key={emoji}
                      onPress={() => {
                        tapFeedback();
                        void sendReaction(emoji);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`React ${emoji}`}
                      style={({ pressed }) => [st.reactionChip, pressed && { opacity: 0.7 }]}
                    >
                      <Text style={{ fontSize: 16 }}>{emoji}</Text>
                    </Pressable>
                  ))}
                </View>
                {isOwner && (
                  <ActionChip label="Close room" icon="lock-closed-outline" danger onPress={handleCloseRoom} />
                )}
                <ActionChip label="Leave" icon="log-out-outline" danger onPress={handleLeave} />
              </View>

              <Text style={st.sectionTitle}>Queue ({queue.length})</Text>
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon="musical-notes"
              title="Queue khaali"
              subtitle={canQueue ? 'Songs add karo — sab ki queue me chalegi' : 'Host ne abhi kuch add nahi kiya'}
            />
          }
          renderItem={({ item }) => (
            <QueueRow
              item={item}
              contributor={memberName(members, item.addedBy)}
              active={item.trackId === playerTrackId}
              canRemove={myRole !== null && (can(myRole, 'queue_remove_any', room.type) || (item.addedBy === meId && can(myRole, 'queue_remove_own', room.type)))}
              onRemove={() => handleRemoveQueueItem(item)}
            />
          )}
        />

        {/* member moderation menu */}
        <MemberMenuModal
          visible={menuUserId !== null}
          member={members.find(member => member.userId === menuUserId) ?? null}
          isOwner={isOwner}
          myId={meId}
          onClose={() => setMenuUserId(null)}
          onMute={userId => {
            void muteMember(userId)
              .then(() => Toast.show({ type: 'success', text1: 'Member mute ho gaya' }))
              .catch(() => Toast.show({ type: 'error', text1: 'Mute fail hua' }));
            setMenuUserId(null);
          }}
          onUnmute={userId => {
            void unmuteMember(userId).catch(() => Toast.show({ type: 'error', text1: 'Unmute fail hua' }));
            setMenuUserId(null);
          }}
          onRemove={userId => {
            void removeMember(userId)
              .then(() => Toast.show({ type: 'success', text1: 'Member remove ho gaya' }))
              .catch(() => Toast.show({ type: 'error', text1: 'Remove fail hua' }));
            setMenuUserId(null);
          }}
          onAssign={(userId, role) => {
            void assignRole(userId, role)
              .then(() => Toast.show({ type: 'success', text1: `Role set: ${role}` }))
              .catch(() => Toast.show({ type: 'error', text1: 'Role assign fail hua' }));
            setMenuUserId(null);
          }}
        />

        {/* chat sheet */}
        <Modal visible={chatVisible} animationType="slide" onRequestClose={() => setChatVisible(false)}>
          <KeyboardAvoidingView
            style={st.chatRoot}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={st.header}>
              <Text style={{ ...typography.h1, color: colors.text }}>Chat</Text>
              <Pressable onPress={() => setChatVisible(false)} accessibilityRole="button" hitSlop={12}>
                <Ionicons name="close" size={24} color={colors.text} />
              </Pressable>
            </View>
            <FlatList
              data={messages}
              keyExtractor={(message: JamMessage) => message.id}
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: spacing.lg, gap: spacing.xs }}
              ListEmptyComponent={<Text style={st.chatEmpty}>Koi message nahi — pehla bolo!</Text>}
              renderItem={({ item }) => (
                <View style={st.chatBubble}>
                  <Text style={st.chatMeta}>
                    {memberName(members, item.userId)} · {new Date(item.createdAt).toLocaleTimeString()}
                  </Text>
                  <Text style={st.chatBody}>{item.body}</Text>
                </View>
              )}
            />
            <View style={st.chatInputRow}>
              <TextInput
                style={st.chatInput}
                value={chatDraft}
                onChangeText={setChatDraft}
                placeholder="Message likho…"
                placeholderTextColor={colors.subtext}
                maxLength={500}
                multiline
              />
              <Pressable
                onPress={handleSendChat}
                accessibilityRole="button"
                accessibilityLabel="Message bhejo"
                style={({ pressed }) => [st.chatSend, pressed && { opacity: 0.8 }]}
              >
                <Ionicons name="send" size={20} color={colors.background} />
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        <AddSongSearchModal
          visible={addSongsVisible}
          onClose={() => setAddSongsVisible(false)}
          onAdd={songToAdd =>
            queueAddSong(songToAdd).then(() =>
              Toast.show({ type: 'success', text1: 'Queue me add ho gaya', text2: songToAdd.title }),
            )
          }
        />
      </View>
    </JamGate>
  );
}

/* ---------- helpers & sub-components ---------- */

function memberName(members: { userId: string; displayName: string | null }[], userId: string | null): string {
  if (!userId) return 'Room';
  const member = members.find(entry => entry.userId === userId);
  return member?.displayName ?? 'Member';
}

function NowPlayingCard({
  serverTitle,
  serverIsPlaying,
  canControl,
  listenerNotice,
  onPlayPause,
  onSeek,
  onNext,
}: {
  serverTitle: string | null;
  serverIsPlaying: boolean;
  canControl: boolean;
  listenerNotice: boolean;
  onPlayPause: () => void;
  onSeek: (deltaMs: number) => void;
  onNext: () => void;
}) {
  const isPlaying = usePlayer(s => s.isPlaying);
  return (
    <View style={st.nowCard}>
      <View style={st.nowRow}>
        <Ionicons
          name={serverIsPlaying && serverTitle !== null ? 'musical-notes' : 'musical-note'}
          size={34}
          color={colors.primary}
        />
        <View style={{ flex: 1 }}>
          <Text style={st.nowTitle} numberOfLines={1}>
            {serverTitle === null ? 'Kuch nahi chal raha' : serverTitle}
          </Text>
          <Text style={st.nowMeta} numberOfLines={1}>
            {listenerNotice
              ? 'Host playback control karta hai — baaki sunte aur chat karte hain'
              : 'Server-authoritative sync — sab devices isi ko follow karte hain'}
          </Text>
        </View>

        {canControl && (
          <View style={st.controlRow}>
            <Pressable onPress={() => onSeek(-10_000)} accessibilityRole="button" accessibilityLabel="10s peeche">
              <Ionicons name="play-back" size={22} color={colors.text} />
            </Pressable>
            <Pressable onPress={onPlayPause} accessibilityRole="button" accessibilityLabel={isPlaying ? 'Pause' : 'Play'}>
              <Ionicons name={isPlaying ? 'pause' : 'play'} size={26} color={colors.primary} />
            </Pressable>
            <Pressable onPress={() => onSeek(10_000)} accessibilityRole="button" accessibilityLabel="10s aage">
              <Ionicons name="play-forward" size={22} color={colors.text} />
            </Pressable>
            <Pressable onPress={onNext} accessibilityRole="button" accessibilityLabel="Next track">
              <Ionicons name="play-skip-forward" size={22} color={colors.text} />
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

function MemberStrip({
  members,
  ownerId,
  meId,
  onOpenMenu,
}: {
  members: { userId: string; displayName: string | null; role: RoomRole; lastSeenAt: string }[];
  ownerId: string;
  meId: string | null;
  onOpenMenu: (userId: string) => void;
}) {
  const now = Date.now();
  return (
    <View style={st.strip}>
      {members.map(member => {
        const stale = isPresenceStale(member.lastSeenAt, now);
        return (
          <Pressable
            key={member.userId}
            style={st.chip}
            onPress={() => {
              // khud pe menu nahi khulta
              if (member.userId !== meId) onOpenMenu(member.userId);
            }}
            accessibilityRole="button"
            accessibilityLabel={`${member.displayName ?? 'Member'} menu`}
          >
            <Text style={st.chipName} numberOfLines={1}>
              {member.displayName ?? 'Member'}
              {member.role === 'owner' ? ' 👑' : ''}
              {member.userId === meId ? ' (you)' : ''}
            </Text>
            <Text style={st.chipRole}>{stale ? 'offline' : roomRoleLabel(member.role)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function QueueRow({
  item,
  contributor,
  active,
  canRemove,
  onRemove,
}: {
  item: JamQueueItem;
  contributor: string;
  active: boolean;
  canRemove: boolean;
  onRemove: () => void;
}) {
  return (
    <View style={[st.row, active && st.rowActive]}>
      <Ionicons name="musical-notes" size={30} color={active ? colors.primary : colors.subtext} />
      <View style={{ flex: 1 }}>
        <Text style={st.rowTitle} numberOfLines={1}>
          {item.track.title}
        </Text>
        <Text style={st.rowArtist} numberOfLines={1}>
          {item.track.artistNames.join(', ')} · added by {contributor}
        </Text>
      </View>
      {canRemove && (
        <Pressable onPress={onRemove} hitSlop={8} accessibilityRole="button" accessibilityLabel="Queue se remove">
          <Ionicons name="close-circle-outline" size={22} color={colors.subtext} />
        </Pressable>
      )}
    </View>
  );
}

function ActionChip({
  label,
  icon,
  onPress,
  danger,
}: {
  label: string;
  icon: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [st.actionChip, danger && st.actionChipDanger, pressed && { opacity: 0.7 }]}
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={18} color={danger ? colors.subtext : colors.text} />
      <Text style={[st.actionText, danger && { color: colors.subtext }]}>{label}</Text>
    </Pressable>
  );
}

function MemberMenuModal({
  visible,
  member,
  isOwner,
  myId,
  onClose,
  onMute,
  onUnmute,
  onRemove,
  onAssign,
}: {
  visible: boolean;
  member: { userId: string; displayName: string | null; role: RoomRole; mutedUntil: string | null } | null;
  isOwner: boolean;
  myId: string | null;
  onClose: () => void;
  onMute: (userId: string) => void;
  onUnmute: (userId: string) => void;
  onRemove: (userId: string) => void;
  onAssign: (userId: string, role: AssignableRole) => void;
}) {
  if (!member) return null;
  const mutedNow = member.mutedUntil !== null && member.mutedUntil > new Date().toISOString();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={st.modalBackdrop}>
        <View style={st.modalCard}>
          <Text style={st.modalTitle}>{member.displayName ?? 'Member'}</Text>
          <Text style={st.modalMeta}>{roomRoleLabel(member.role)}</Text>

          <View style={st.modalButtons}>
            <Pressable style={st.modalButton} onPress={onClose} accessibilityRole="button">
              <Text style={{ ...typography.body, color: colors.text }}>Cancel</Text>
            </Pressable>
          </View>

          <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
            <Pressable
              style={st.menuRow}
              onPress={() => (mutedNow ? onUnmute(member.userId) : onMute(member.userId))}
              accessibilityRole="button"
            >
              <Ionicons name={mutedNow ? 'mic-outline' : 'mic-off-outline'} size={18} color={colors.text} />
              <Text style={{ ...typography.body, color: colors.text }}>
                {mutedNow ? 'Unmute (chat)' : 'Mute (chat, 10 min)'}
              </Text>
            </Pressable>
            <Pressable style={st.menuRow} onPress={() => onRemove(member.userId)} accessibilityRole="button">
              <Ionicons name="person-remove-outline" size={18} color={colors.subtext} />
              <Text style={{ ...typography.body, color: colors.subtext }}>Room se remove</Text>
            </Pressable>
            {isOwner && member.userId !== myId && (
              <>
                <Pressable
                  style={st.menuRow}
                  onPress={() => onAssign(member.userId, 'co_host')}
                  accessibilityRole="button"
                >
                  <Ionicons name="star-outline" size={18} color={colors.text} />
                  <Text style={{ ...typography.body, color: colors.text }}>Co-host banao</Text>
                </Pressable>
                <Pressable
                  style={st.menuRow}
                  onPress={() => onAssign(member.userId, 'moderator')}
                  accessibilityRole="button"
                >
                  <Ionicons name="shield-outline" size={18} color={colors.text} />
                  <Text style={{ ...typography.body, color: colors.text }}>Moderator banao</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ---------- styles ---------- */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  textButton: { paddingVertical: spacing.xs, paddingHorizontal: spacing.md },
  textButtonText: { ...typography.body, color: colors.primary, fontWeight: '700' },
});

const st = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  headerTitle: { ...typography.h1, color: colors.text, fontSize: 20 },
  headerMeta: { ...typography.caption, color: colors.subtext },
  banner: {
    backgroundColor: colors.card,
    borderRadius: 10,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  bannerText: { ...typography.caption, color: colors.primary },
  strip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.card,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  chipName: { ...typography.caption, color: colors.text, fontWeight: '700', maxWidth: 120 },
  chipRole: { ...typography.caption, color: colors.subtext },
  nowCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    margin: spacing.lg,
    padding: spacing.lg,
  },
  nowRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  nowTitle: { ...typography.h2, color: colors.text, fontSize: 16 },
  nowMeta: { ...typography.caption, color: colors.subtext, marginTop: 2, maxWidth: 180 },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  reactionRow: { flexDirection: 'row', gap: spacing.xs },
  reactionChip: {
    backgroundColor: colors.card,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: { ...typography.h2, color: colors.text, paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.xs,
    padding: spacing.md,
    backgroundColor: colors.card,
    borderRadius: 12,
  },
  rowActive: { borderWidth: 1, borderColor: colors.primary },
  rowTitle: { ...typography.h2, color: colors.text, fontSize: 16 },
  rowArtist: { ...typography.caption, color: colors.subtext, marginTop: 2 },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  actionChipDanger: { opacity: 0.8 },
  actionText: { ...typography.caption, color: colors.text },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  modalCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalTitle: { ...typography.h1, color: colors.text, fontSize: 20 },
  modalMeta: { ...typography.caption, color: colors.subtext, marginTop: 2 },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md },
  modalButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    backgroundColor: colors.card,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: 10,
    backgroundColor: colors.card,
  },
  chatRoot: { flex: 1, backgroundColor: colors.background, paddingTop: spacing.xl },
  chatEmpty: { ...typography.caption, color: colors.subtext, textAlign: 'center' },
  chatBubble: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: spacing.md,
    gap: 2,
  },
  chatMeta: { ...typography.caption, color: colors.primary },
  chatBody: { ...typography.body, color: colors.text },
  chatInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  chatInput: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flex: 1,
    maxHeight: 100,
  },
  chatSend: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    padding: spacing.sm,
  },
});

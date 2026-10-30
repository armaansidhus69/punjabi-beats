/**
 * Blend detail — /blend/[id] (Phase 10 roadmap).
 * Member chips + match %, shared playlist (contributor attribution), owner
 * menu (rename/rotate invite/remove member), member actions (add/remove
 * track, leave), realtime refresh, playback via existing player pipeline.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import Toast from 'react-native-toast-message';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BlendGate from '../../components/BlendGate';
import AddSongSearchModal from '../../components/AddSongSearchModal';
import LoadingSpinner from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';
import type { BlendItem } from '../../types';
import { getCurrentUser } from '../../core/auth/authService';
import { updateBlend } from '../../services/blendService';
import { shareBlend } from '../../services/shareComposerFacade';
import { useBlends } from '../../stores/blendStore';
import { usePlayer } from '../../stores/playerStore';
import { useMiniPlayerPadding } from '../../hooks/useMiniPlayerPadding';
import { blendItemToSong } from '../../core/blend/song';
import { blendComputeStatusDetailLabel } from '../../utils/blendLabels';
import { colors } from '../../constants/colors';
import { typography } from '../../constants/typography';
import { spacing } from '../../constants/spacing';
import { successFeedback, tapFeedback } from '../../utils/haptics';

export default function BlendDetailScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const contentPadding = useMiniPlayerPadding(spacing.xl);

  const blend = useBlends(s => s.activeBlend);
  const members = useBlends(s => s.activeMembers);
  const items = useBlends(s => s.activeItems);
  const matchPercent = useBlends(s => s.matchPercentByMember);
  const loading = useBlends(s => s.loading);
  const detailError = useBlends(s => s.detailError);
  const openBlend = useBlends(s => s.openBlend);
  const closeBlend = useBlends(s => s.closeBlend);
  const refreshActive = useBlends(s => s.refreshActive);
  const leaveActive = useBlends(s => s.leaveActive);
  const removeActiveMember = useBlends(s => s.removeActiveMember);
  const rotateActiveInvite = useBlends(s => s.rotateActiveInvite);
  const addActiveTrack = useBlends(s => s.addActiveTrack);
  const removeActiveTrack = useBlends(s => s.removeActiveTrack);

  const playSong = usePlayer(s => s.playSong);
  const currentSongId = usePlayer(s => s.currentSong?.id ?? null);

  const [meId, setMeId] = useState<string | null>(null);
  const [addSongsVisible, setAddSongsVisible] = useState(false);
  const [renameVisible, setRenameVisible] = useState(false);

  useEffect(() => {
    if (typeof id === 'string' && id.length > 0) void openBlend(id);
    void getCurrentUser().then(user => setMeId(user?.id ?? null));
    // Screen leave pe store state clear (realtime channel ke saath)
    return () => closeBlend();
  }, [id, openBlend, closeBlend]);

  const isOwner = blend !== null && meId !== null && blend.ownerId === meId;
  const songs = useMemo(() => items.map(blendItemToSong), [items]);

  const handlePlay = useCallback(
    (item: BlendItem) => void playSong(blendItemToSong(item), songs),
    [playSong, songs],
  );

  const handleShare = useCallback(async () => {
    if (!blend) return;
    await shareBlend(blend.name, blend.inviteCode);
  }, [blend]);

  const handleRotateInvite = useCallback(() => {
    if (!isOwner) return;
    Alert.alert('Invite regenerate?', 'Purana link/code turant band ho jayega.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Regenerate',
        style: 'destructive',
        onPress: () => {
          void rotateActiveInvite()
            .then(code => {
              successFeedback();
              Toast.show({ type: 'success', text1: 'Naya code', text2: code });
            })
            .catch(() => Toast.show({ type: 'error', text1: 'Rotate fail hua' }));
        },
      },
    ]);
  }, [isOwner, rotateActiveInvite]);

  const handleRemoveMember = useCallback(
    (userId: string, name: string | null) => {
      if (!isOwner) return;
      Alert.alert('Member remove?', `${name ?? 'Member'} blend se nikal denge.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void removeActiveMember(userId)
              .then(() => {
                successFeedback();
                Toast.show({ type: 'success', text1: 'Member remove ho gaya' });
              })
              .catch(() => Toast.show({ type: 'error', text1: 'Remove fail hua' }));
          },
        },
      ]);
    },
    [isOwner, removeActiveMember],
  );

  const handleLeave = useCallback(() => {
    Alert.alert('Blend chhodo?', 'Shared playlist me contribution band ho jayegi.', [
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
  }, [leaveActive]);

  const handleRemoveTrack = useCallback(
    (item: BlendItem) => {
      const canRemove = isOwner || (meId !== null && item.sourceUserId === meId);
      if (!canRemove) {
        Toast.show({ type: 'error', text1: 'Sirf contributor ya owner remove kar sakta hai' });
        return;
      }
      const contributor = memberName(members, item.sourceUserId);
      Alert.alert(
        'Track remove?',
        item.origin === 'generated'
          ? `${contributor} ke taste wala track — recompute me wapas nahi aayega.`
          : 'Manual track hat jayega.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => {
              void removeActiveTrack(item.trackId)
                .then(() => successFeedback())
                .catch(() => Toast.show({ type: 'error', text1: 'Remove fail hua' }));
            },
          },
        ],
      );
    },
    [isOwner, meId, members, removeActiveTrack],
  );

  if (typeof id !== 'string' || id.length === 0) {
    return (
      <BlendGate>
        <View style={styles.center}>
          <EmptyState icon="git-merge-outline" title="Blend missing" subtitle="Link galat lag raha hai" />
        </View>
      </BlendGate>
    );
  }

  if (loading || (detailError === null && blend === null)) {
    return (
      <BlendGate>
        <View style={styles.center}>
          <LoadingSpinner label="Blend load ho raha hai…" />
        </View>
      </BlendGate>
    );
  }

  if (detailError !== null || blend === null) {
    return (
      <BlendGate>
        <View style={styles.center}>
          <EmptyState icon="alert-circle-outline" title="Blend nahi mila" subtitle={detailError ?? 'Access check karo'} />
          <Pressable style={styles.textButton} onPress={() => void refreshActive()}>
            <Text style={styles.textButtonText}>Refresh</Text>
          </Pressable>
          <Pressable style={styles.textButton} onPress={router.back}>
            <Text style={styles.textButtonText}>Wapas jao</Text>
          </Pressable>
        </View>
      </BlendGate>
    );
  }

  return (
    <BlendGate>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={st.header}>
          <Pressable onPress={router.back} hitSlop={12} accessibilityRole="button">
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={st.headerTitle} numberOfLines={1}>
            {blend.name}
          </Text>
          <Pressable onPress={() => void handleShare()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Invite share karo">
            <Ionicons name="share-social-outline" size={22} color={colors.primary} />
          </Pressable>
        </View>

        {blend.computeStatus !== 'ready' && (
          <View style={st.banner}>
            <Text style={st.bannerText}>{blendComputeStatusDetailLabel(blend.computeStatus)}</Text>
          </View>
        )}

        <FlatList
          data={items}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingBottom: contentPadding, flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View>
              <MemberStrip members={members} matchPercent={matchPercent} myId={meId} onRemove={handleRemoveMember} />
              <View style={st.actions}>
                <ActionChip label="Add songs" icon="add-circle-outline" onPress={() => setAddSongsVisible(true)} />
                {isOwner && (
                  <>
                    <ActionChip label="Naya invite" icon="refresh-outline" onPress={handleRotateInvite} />
                    <ActionChip label="Rename" icon="create-outline" onPress={() => setRenameVisible(true)} />
                  </>
                )}
                <ActionChip label="Leave" icon="log-out-outline" danger onPress={handleLeave} />
              </View>
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon="musical-notes"
              title="Playlist abhi khaali"
              subtitle="Compute chal raha hai — taste sync hone ke baad fill ho jayega"
            />
          }
          renderItem={({ item }) => (
            <ItemRow
              item={item}
              contributor={memberName(members, item.sourceUserId)}
              active={item.trackId === currentSongId}
              canRemove={isOwner || (meId !== null && item.sourceUserId === meId)}
              onPress={() => handlePlay(item)}
              onRemove={() => handleRemoveTrack(item)}
            />
          )}
        />

        <RenameModal
          visible={renameVisible}
          currentName={blend.name}
          onClose={() => setRenameVisible(false)}
          onSubmit={name => {
            void updateBlend(blend.id, { name })
              .then(refreshActive)
              .then(() => {
                successFeedback();
                setRenameVisible(false);
              })
              .catch(() => Toast.show({ type: 'error', text1: 'Rename fail hua' }));
          }}
        />

        <AddSongSearchModal
          visible={addSongsVisible}
          onClose={() => setAddSongsVisible(false)}
          onAdd={song =>
            addActiveTrack(song).then(() =>
              Toast.show({ type: 'success', text1: 'Track add ho gaya', text2: song.title }),
            )
          }
        />
      </View>
    </BlendGate>
  );
}

/* ---------- helpers & sub-components ---------- */

function memberName(members: { userId: string; displayName: string | null }[], userId: string | null): string {
  if (!userId) return 'Blend';
  const member = members.find(entry => entry.userId === userId);
  return member?.displayName ?? 'Member';
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

function MemberStrip({
  members,
  matchPercent,
  myId,
  onRemove,
}: {
  members: { userId: string; displayName: string | null; role: string; avatarUrl: string | null }[];
  matchPercent: Record<string, number>;
  myId: string | null;
  onRemove: (userId: string, name: string | null) => void;
}) {
  // owner pehle (joined_at order me hi aata hai, phir bhi deterministic)
  const sorted = [...members].sort(a => (a.role === 'owner' ? -1 : 0));
  return (
    <View style={st.strip}>
      {sorted.map(member => (
        <View key={member.userId} style={st.chip}>
          <Text style={st.chipName} numberOfLines={1}>
            {member.displayName ?? 'Member'}
            {member.role === 'owner' ? ' 👑' : member.userId === myId ? ' (you)' : ''}
          </Text>
          <Text style={st.chipMatch}>
            {member.role === 'owner' ? 'owner' : `${matchPercent[member.userId] ?? 0}%`}
          </Text>
          {member.role !== 'owner' && member.userId !== myId && myId !== null && (
            <Pressable
              onPress={() => onRemove(member.userId, member.displayName)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`${member.displayName ?? 'Member'} remove karo`}
            >
              <Ionicons name="close" size={14} color={colors.subtext} />
            </Pressable>
          )}
        </View>
      ))}
    </View>
  );
}

function ItemRow({
  item,
  contributor,
  active,
  canRemove,
  onPress,
  onRemove,
}: {
  item: BlendItem;
  contributor: string;
  active: boolean;
  canRemove: boolean;
  onPress: () => void;
  onRemove: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [st.row, active && st.rowActive, pressed && { opacity: 0.85 }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.track.title} play karo`}
    >
      <Ionicons name="musical-notes" size={36} color={active ? colors.primary : colors.subtext} />
      <View style={{ flex: 1 }}>
        <Text style={st.rowTitle} numberOfLines={1}>
          {item.track.title}
        </Text>
        <Text style={st.rowArtist} numberOfLines={1}>
          {item.track.artistNames.join(', ')}
        </Text>
        <View style={st.badgeRow}>
          <Text style={st.badge}>🎵 {contributor}</Text>
          {item.origin === 'member' && <Text style={[st.badge, { opacity: 0.7 }]}>manual</Text>}
        </View>
      </View>
      {canRemove && (
        <Pressable
          onPress={onRemove}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${item.track.title} remove karo`}
        >
          <Ionicons name="close-circle-outline" size={22} color={colors.subtext} />
        </Pressable>
      )}
    </Pressable>
  );
}

function RenameModal({
  visible,
  currentName,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  currentName: string;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(currentName);

  useEffect(() => {
    if (visible) setName(currentName);
  }, [visible, currentName]);

  const valid = name.trim().length > 0 && name.trim().length <= 60;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={st.modalBackdrop}>
        <View style={st.modalCard}>
          <Text style={st.modalTitle}>Blend ka naam</Text>
          <TextInput
            style={st.input}
            value={name}
            onChangeText={setName}
            maxLength={60}
            autoFocus
            placeholder="1–60 chars"
            placeholderTextColor={colors.subtext}
          />
          <View style={st.modalButtons}>
            <Pressable style={st.modalButton} onPress={onClose} accessibilityRole="button">
              <Text style={{ ...typography.body, color: colors.text }}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[st.modalButton, st.modalButtonPrimary, !valid && { opacity: 0.4 }]}
              disabled={!valid}
              onPress={() => onSubmit(name.trim())}
              accessibilityRole="button"
            >
              <Text style={{ ...typography.body, color: colors.background, fontWeight: '700' }}>Save</Text>
            </Pressable>
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
  headerTitle: { ...typography.h1, color: colors.text, flex: 1, textAlign: 'center' },
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
  chipMatch: { ...typography.caption, color: colors.primary },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
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
  badgeRow: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs },
  badge: {
    ...typography.caption,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
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
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalTitle: { ...typography.h2, color: colors.text },
  input: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  modalButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    backgroundColor: colors.card,
  },
  modalButtonPrimary: { backgroundColor: colors.primary },
});

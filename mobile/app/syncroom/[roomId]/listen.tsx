import React, { useEffect, useRef } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSyncRoomStore } from '../../../stores/syncRoomStore';
import { usePlayer } from '../../../stores/playerStore';
import TrackSleeveArt from '../../../components/TrackSleeveArt';
import { colors } from '../../../constants/colors';
import { typography } from '../../../constants/typography';
import { spacing } from '../../../constants/spacing';
import { tapFeedback, warningFeedback } from '../../../utils/haptics';

export default function SyncRoomListenScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const snapshot = useSyncRoomStore((s) => s.snapshot);
  const personal = useSyncRoomStore((s) => s.personal);
  const setPersonalPaused = useSyncRoomStore((s) => s.setPersonalPaused);
  const rejoinLive = useSyncRoomStore((s) => s.rejoinLive);
  const voteSkip = useSyncRoomStore((s) => s.voteSkip);
  const hostPlayPause = useSyncRoomStore((s) => s.hostPlayPause);
  const hostSkip = useSyncRoomStore((s) => s.hostSkip);
  const leaveRoom = useSyncRoomStore((s) => s.leaveRoom);
  const tickPlayer = useSyncRoomStore((s) => s.tickPlayer);

  const localPosition = usePlayer((s) => s.position);
  const seekPlayer = usePlayer((s) => s.seek);

  // Sync tick loop: compares ideal server time against local playback position
  const posRef = useRef(localPosition);
  posRef.current = localPosition;

  useEffect(() => {
    const id = setInterval(() => {
      const { seekTo } = tickPlayer(posRef.current);
      if (seekTo != null) {
        void seekPlayer(seekTo);
      }
    }, 600);
    return () => clearInterval(id);
  }, [tickPlayer, seekPlayer]);

  const handleLeave = async () => {
    warningFeedback();
    await leaveRoom();
    router.replace('/syncroom');
  };

  const handlePersonalToggle = () => {
    tapFeedback();
    if (personal.isPausedForMe) {
      rejoinLive();
    } else {
      setPersonalPaused(true);
    }
  };

  const handleVoteSkip = () => {
    tapFeedback();
    void voteSkip();
  };

  const handleHostPlayPause = () => {
    tapFeedback();
    void hostPlayPause();
  };

  const handleHostSkip = () => {
    tapFeedback();
    void hostSkip();
  };

  if (!snapshot) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.loadingText}>SyncRoom load ho raha hai...</Text>
        <Pressable
          style={styles.btnSecondary}
          onPress={() => router.replace('/syncroom')}
        >
          <Text style={styles.btnSecondaryText}>Wapas Jao</Text>
        </Pressable>
      </View>
    );
  }

  const { playback, queue, room, members } = snapshot;
  const current = queue.find((q) => q.id === snapshot.currentItemId) ?? queue[0];
  const isPlaying = playback.status === 'playing' && !personal.isPausedForMe;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Top Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>

        <View style={styles.headerTitleWrap}>
          <Text style={styles.roomName} numberOfLines={1}>
            {room.name}
          </Text>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor:
                    personal.localStatus === 'synced'
                      ? '#10B981'
                      : personal.localStatus === 'catching_up'
                      ? '#F59E0B'
                      : '#6B7280',
                },
              ]}
            />
            <Text style={styles.statusText}>{personal.localStatus.replace('_', ' ')}</Text>
            {room.inviteCode ? (
              <Text style={styles.codeBadge}>Code: {room.inviteCode}</Text>
            ) : null}
          </View>
        </View>

        <Pressable
          onPress={handleLeave}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Leave room"
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <Ionicons name="exit-outline" size={22} color="#FF6B6B" />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Animated Vinyl Disc Art */}
        <View style={styles.sleeveWrapper}>
          <TrackSleeveArt
            title={current?.title ?? 'No song playing'}
            artist={current?.artist ?? 'Queue is empty'}
            isPlaying={isPlaying}
            size="lg"
          />
        </View>

        {/* Member presence indicator */}
        <View style={styles.memberRow}>
          <Ionicons name="people-outline" size={16} color={colors.subtext} />
          <Text style={styles.memberCount}>
            {members.length} {members.length === 1 ? 'member' : 'members'} online
          </Text>
        </View>

        {/* Action Controls */}
        <View style={styles.buttonRow}>
          <Pressable
            style={({ pressed }) => [
              styles.actionBtn,
              personal.isPausedForMe && styles.actionBtnActive,
              pressed && styles.pressed,
            ]}
            onPress={handlePersonalToggle}
          >
            <Ionicons
              name={personal.isPausedForMe ? 'play-outline' : 'pause-outline'}
              size={18}
              color={colors.text}
            />
            <Text style={styles.actionBtnText}>
              {personal.isPausedForMe ? 'Rejoin live' : 'Pause for me'}
            </Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}
            onPress={handleVoteSkip}
          >
            <Ionicons name="play-skip-forward-outline" size={18} color={colors.text} />
            <Text style={styles.actionBtnText}>Vote Skip</Text>
          </Pressable>
        </View>

        {/* Host Controls */}
        <View style={styles.hostControls}>
          <Text style={styles.hostLabel}>HOST CONTROLS</Text>
          <View style={styles.buttonRow}>
            <Pressable
              style={({ pressed }) => [styles.btnPrimary, pressed && styles.pressed]}
              onPress={handleHostPlayPause}
            >
              <Ionicons
                name={playback.status === 'playing' ? 'pause' : 'play'}
                size={18}
                color={colors.background}
              />
              <Text style={styles.btnPrimaryText}>
                {playback.status === 'playing' ? 'Pause Room' : 'Play Room'}
              </Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.btnSecondaryHost, pressed && styles.pressed]}
              onPress={handleHostSkip}
            >
              <Ionicons name="play-skip-forward" size={18} color={colors.text} />
              <Text style={styles.btnSecondaryHostText}>Skip Track</Text>
            </Pressable>
          </View>
        </View>

        {/* Fair Turns Queue */}
        <View style={styles.queueCard}>
          <View style={styles.queueHeader}>
            <Text style={styles.sectionTitle}>UP NEXT — FAIR TURNS</Text>
            <Text style={styles.queueCount}>{queue.length} tracks</Text>
          </View>

          {queue.length === 0 ? (
            <Text style={styles.emptyQueueText}>
              Queue khali hai. Gaane add karo fair turns ke liye.
            </Text>
          ) : (
            queue.map((item, idx) => {
              const isCurrent = item.id === snapshot.currentItemId || (!snapshot.currentItemId && idx === 0);
              return (
                <View
                  key={item.id}
                  style={[styles.queueItemRow, isCurrent && styles.queueItemRowCurrent]}
                >
                  <Text style={styles.queueIndex}>{isCurrent ? '▶' : idx + 1}</Text>
                  <View style={styles.queueMeta}>
                    <Text style={[styles.queueTrack, isCurrent && styles.queueTrackCurrent]} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={styles.queueArtist} numberOfLines={1}>
                      {item.artist} · Added by {item.addedByName || item.addedBy.slice(0, 6)}
                    </Text>
                  </View>
                  {isCurrent ? (
                    <View style={styles.liveBadge}>
                      <Text style={styles.liveBadgeText}>LIVE</Text>
                    </View>
                  ) : null}
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  actionBtn: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    paddingVertical: 12,
  },
  actionBtnActive: {
    borderColor: colors.primary,
  },
  actionBtnText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  btnPrimary: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 12,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    paddingVertical: 12,
  },
  btnPrimaryText: {
    color: colors.background,
    fontSize: 14,
    fontWeight: '700',
  },
  btnSecondary: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  btnSecondaryHost: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    paddingVertical: 12,
  },
  btnSecondaryHostText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  btnSecondaryText: {
    color: colors.text,
    fontSize: 14,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  codeBadge: {
    color: colors.primary,
    fontFamily: 'monospace',
    fontSize: 11,
    marginLeft: 6,
  },
  container: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  emptyQueueText: {
    ...typography.caption,
    color: colors.subtext,
    paddingVertical: spacing.md,
    textAlign: 'center',
  },
  header: {
    alignItems: 'center',
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  headerTitleWrap: {
    flex: 1,
  },
  hostControls: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 16,
    borderWidth: 1,
    padding: spacing.md,
  },
  hostLabel: {
    ...typography.caption,
    color: colors.subtext,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  iconButton: {
    padding: spacing.xs,
  },
  liveBadge: {
    backgroundColor: 'rgba(236, 72, 153, 0.2)',
    borderColor: '#EC4899',
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  liveBadgeText: {
    color: '#EC4899',
    fontSize: 10,
    fontWeight: '800',
  },
  loadingText: {
    ...typography.body,
    color: colors.subtext,
    marginBottom: spacing.md,
  },
  memberCount: {
    ...typography.caption,
    color: colors.subtext,
    fontSize: 12,
  },
  memberRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.75,
  },
  queueArtist: {
    ...typography.caption,
    color: colors.subtext,
    fontSize: 11,
    marginTop: 2,
  },
  queueCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 16,
    borderWidth: 1,
    padding: spacing.md,
  },
  queueCount: {
    ...typography.caption,
    color: colors.subtext,
    fontSize: 11,
  },
  queueHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  queueIndex: {
    color: colors.subtext,
    fontFamily: 'monospace',
    fontSize: 12,
    width: 20,
  },
  queueItemRow: {
    alignItems: 'center',
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 10,
  },
  queueItemRowCurrent: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 8,
    paddingHorizontal: 8,
  },
  queueMeta: {
    flex: 1,
  },
  queueTrack: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  queueTrackCurrent: {
    color: colors.primary,
    fontWeight: '700',
  },
  roomName: {
    ...typography.h2,
    color: colors.text,
    fontSize: 16,
  },
  sectionTitle: {
    ...typography.caption,
    color: colors.subtext,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  sleeveWrapper: {
    alignItems: 'center',
    marginVertical: spacing.sm,
  },
  statusDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginTop: 2,
  },
  statusText: {
    ...typography.caption,
    color: colors.subtext,
    fontSize: 11,
    textTransform: 'capitalize',
  },
});


/**
 * Room tab — Phase 10 (create/join) + Phase 11 (live connection status).
 *
 * States:
 *   • Room me nahi → "Create Room" (6-digit code generate) + 6-digit code input
 *     se "Join Room" (FR-5.1 / FR-5.2)
 *   • Room me ho → current-room card: code, Host/Joined badge (FR-5.6),
 *     connection status pill (FR-5.8), members line (FR-5.10), Open/Leave (FR-5.7)
 *
 * Realtime wiring store ke through hai: `createRoom()/joinRoom()/leaveRoom()`
 * → roomStore lifecycle event → `roomSync.ts` channel subscribe/unsubscribe.
 * Ye screen SDK ko chhuti nahi karti (roomStore ↔ roomSync circular import nahi).
 *
 * Missing env: `EXPO_PUBLIC_APINATOR_KEY` (socket) / `EXPO_PUBLIC_PUBLISH_URL`
 * (broadcast) na ho to warning card dikhta hai — UI testable rehta hai, sync
 * Phase 12 (Vercel deploy) ke baad live hota hai.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoom } from '../../stores/roomStore';
import { isKeyConfigured, isPublishConfigured } from '../../services/apinator';
import { CONNECTION_DOT, CONNECTION_LABEL } from '../../constants/connection';
import { useMiniPlayerPadding } from '../../hooks/useMiniPlayerPadding';
import { successFeedback, tapFeedback, warningFeedback } from '../../utils/haptics';
import { colors } from '../../constants/colors';
import { typography } from '../../constants/typography';
import { spacing } from '../../constants/spacing';

/** FR-5.1: room code hamesha 6 digits */
const CODE_PATTERN = /^\d{6}$/;

/** Module scope pe check — env runtime pe change nahi hoti */
const SOCKET_READY = isKeyConfigured();
const BROADCAST_READY = isPublishConfigured();

export default function RoomScreen() {
  const insets = useSafeAreaInsets();
  const contentPadding = useMiniPlayerPadding(spacing.xl);

  const code = useRoom(s => s.code);
  const isHost = useRoom(s => s.isHost);
  const connectionState = useRoom(s => s.connectionState);
  const roomError = useRoom(s => s.error);
  const members = useRoom(s => s.members);
  const createRoom = useRoom(s => s.createRoom);
  const joinRoom = useRoom(s => s.joinRoom);
  const leaveRoom = useRoom(s => s.leaveRoom);
  // FR-5.11 — join se pehle naam (default Guest-XXXX, AsyncStorage me persist)
  const name = useRoom(s => s.name);
  const setName = useRoom(s => s.setName);
  const hydrateName = useRoom(s => s.hydrateName);

  useEffect(() => {
    void hydrateName();
  }, [hydrateName]);

  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [nameFocused, setNameFocused] = useState(false);

  const handleCreate = useCallback(() => {
    Keyboard.dismiss();
    if (code) return; // room pehle se hai → card dikh raha hoga
    successFeedback();
    const newCode = createRoom(); // lifecycle → roomSync channel subscribe
    router.push(`/room/${newCode}`);
  }, [code, createRoom]);

  const handleJoin = useCallback(() => {
    Keyboard.dismiss();
    const clean = joinCode.trim();
    if (!CODE_PATTERN.test(clean)) {
      warningFeedback();
      setJoinError('Room code 6 digits ka hona chahiye');
      return;
    }
    try {
      joinRoom(clean); // lifecycle → roomSync channel subscribe
      setJoinError(null);
      successFeedback();
      router.push(`/room/${clean}`);
    } catch (err) {
      warningFeedback();
      setJoinError(err instanceof Error ? err.message : 'Room join nahi ho paya');
    }
  }, [joinCode, joinRoom]);

  const handleOpenRoom = useCallback(() => {
    if (!code) return;
    tapFeedback();
    router.push(`/room/${code}`);
  }, [code]);

  const handleLeave = useCallback(() => {
    warningFeedback();
    setJoinCode('');
    setJoinError(null);
    leaveRoom(); // lifecycle → channel unsubscribe (playback chalta rehta hai)
  }, [leaveRoom]);

  /* ---------- In-room card (FR-5.6 / FR-5.7 / FR-5.8) ---------- */
  if (code) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + spacing.lg }]}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: contentPadding }]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.heroTitle}>Aap room me ho</Text>
          <Text style={styles.heroSubtitle}>Sab log ek hi song sun rahe hain</Text>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>ROOM CODE</Text>
            <Text style={styles.cardCode} accessibilityLabel={`Room code ${code}`}>
              {code}
            </Text>

            <View style={styles.badgeRow}>
              <View style={[styles.badge, isHost ? styles.badgeHost : styles.badgeGuest]}>
                <Ionicons name={isHost ? 'star' : 'person-add'} size={14} color={colors.text} />
                <Text style={styles.badgeText}>{isHost ? 'Host' : 'Joined'}</Text>
              </View>
              <View style={styles.statusPill}>
                <View
                  style={[styles.statusDot, { backgroundColor: CONNECTION_DOT[connectionState] }]}
                />
                <Text style={styles.statusText}>{CONNECTION_LABEL[connectionState]}</Text>
              </View>
            </View>

            {roomError ? <Text style={styles.errorText}>{roomError}</Text> : null}

            <Text style={styles.membersText}>
              {members.length > 1
                ? `${members.length} log online hain`
                : 'Abhi aap akele ho — code share karo'}
            </Text>
            {members.length > 1 ? (
              <Text style={styles.memberNames}>{members.map(m => m.name).join(', ')}</Text>
            ) : null}
          </View>

          <Pressable
            onPress={handleOpenRoom}
            accessibilityRole="button"
            accessibilityLabel="Room screen khole"
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          >
            <Ionicons name="people-outline" size={18} color={colors.background} />
            <Text style={styles.primaryText}>Open Room</Text>
          </Pressable>

          <Pressable
            onPress={handleLeave}
            accessibilityRole="button"
            accessibilityLabel="Room chhodo"
            style={({ pressed }) => [styles.dangerButton, pressed && styles.pressed]}
          >
            <Ionicons name="exit-outline" size={18} color="#ff6b6b" />
            <Text style={styles.dangerText}>Leave Room</Text>
          </Pressable>

          <Text style={styles.hint}>
            Back karne par bhi room chalta rehta hai — sirf &quot;Leave Room&quot; se
            connection todta hai (FR-5.7).
          </Text>
        </ScrollView>
      </View>
    );
  }

  /* ---------- Not-in-room: create + join (FR-5.1 / FR-5.2) ---------- */
  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.lg }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: contentPadding }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.heroTitle}>Group Room</Text>
        <Text style={styles.heroSubtitle}>
          Doston ke saath ek hi song — sab devices pe sync
        </Text>

        {!SOCKET_READY || !BROADCAST_READY ? (
          <View style={styles.warnCard}>
            <Ionicons name="cloud-offline-outline" size={18} color="#f1c40f" />
            <Text style={styles.warnText}>
              Realtime setup pending — .env me{' '}
              {!SOCKET_READY ? 'EXPO_PUBLIC_APINATOR_KEY' : 'EXPO_PUBLIC_PUBLISH_URL'} set
              karo (Phase 12 deploy ke baad sync live hoga).
            </Text>
          </View>
        ) : null}

        <Text style={styles.nameFieldLabel}>AAPKA NAAM (ROOM ME DIKHEGA)</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Jaise: Rahul"
          placeholderTextColor={colors.subtext}
          maxLength={20}
          autoCapitalize="words"
          style={[styles.nameInput, nameFocused && styles.codeInputFocused]}
          onFocus={() => setNameFocused(true)}
          onBlur={() => setNameFocused(false)}
          accessibilityLabel="Aapka display name"
        />

        <Pressable
          onPress={handleCreate}
          accessibilityRole="button"
          accessibilityLabel="Naya room banao"
          style={({ pressed }) => [
            styles.primaryButton,
            styles.createButton,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="add-circle-outline" size={20} color={colors.background} />
          <Text style={styles.primaryText}>Create Room</Text>
        </Pressable>

        <View style={styles.dividerRow}>
          <View style={styles.divider} />
          <Text style={styles.dividerText}>ya code se join</Text>
          <View style={styles.divider} />
        </View>

        <Text style={styles.inputLabel}>ROOM CODE</Text>
        <TextInput
          value={joinCode}
          onChangeText={text => {
            setJoinCode(text.replace(/\D/g, '').slice(0, 6));
            setJoinError(null);
          }}
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={6}
          placeholder="••••••"
          placeholderTextColor={colors.subtext}
          accessibilityLabel="6 digit room code"
          onFocus={() => {
            setFocused(true);
            tapFeedback();
          }}
          onBlur={() => setFocused(false)}
          onSubmitEditing={handleJoin}
          returnKeyType="join"
          style={[styles.codeInput, focused && styles.codeInputFocused]}
        />

        {joinError ? <Text style={styles.errorText}>{joinError}</Text> : null}

        <Pressable
          onPress={handleJoin}
          disabled={joinCode.length !== 6}
          accessibilityRole="button"
          accessibilityLabel="Room me join karo"
          style={({ pressed }) => [
            styles.secondaryButton,
            joinCode.length !== 6 && styles.buttonDisabled,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="log-in-outline" size={18} color={colors.text} />
          <Text style={styles.secondaryText}>Join Room</Text>
        </Pressable>

        <Text style={styles.hint}>
          Host &quot;Create Room&quot; dabata hai aur code share karta hai — baaki
          6-digit code daal ke join karte hain.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  heroTitle: { ...typography.h1, color: colors.text, textAlign: 'center' },
  heroSubtitle: {
    ...typography.body,
    color: colors.subtext,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },

  /* Setup warning (Phase 12 tak) */
  warnCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  warnText: { ...typography.caption, color: colors.subtext, flex: 1 },

  /* Current room card */
  card: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  cardLabel: { ...typography.caption, color: colors.subtext, letterSpacing: 2 },
  cardCode: {
    ...typography.h1,
    fontSize: 46,
    color: colors.primary,
    letterSpacing: 8,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeHost: { borderColor: colors.primary, backgroundColor: colors.surface },
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
  membersText: { ...typography.body, color: colors.subtext },
  memberNames: { ...typography.caption, color: colors.text, marginTop: spacing.xs },
  /* Naam field (FR-5.11) */
  nameFieldLabel: {
    ...typography.caption,
    color: colors.subtext,
    letterSpacing: 2,
    textAlign: 'center',
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  nameInput: {
    ...typography.body,
    color: colors.text,
    textAlign: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },

  /* Buttons */
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  createButton: { marginTop: spacing.sm },
  primaryText: { ...typography.body, color: colors.background, fontWeight: '700' },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  secondaryText: { ...typography.body, color: colors.text, fontWeight: '700' },
  buttonDisabled: { opacity: 0.5 },
  dangerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#ff6b6b',
    backgroundColor: colors.surface,
  },
  dangerText: { ...typography.body, color: '#ff6b6b', fontWeight: '700' },

  /* Join form */
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  divider: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { ...typography.caption, color: colors.subtext },
  inputLabel: {
    ...typography.caption,
    color: colors.subtext,
    letterSpacing: 2,
    textAlign: 'center',
    marginBottom: -spacing.xs,
  },
  codeInput: {
    ...typography.h1,
    fontSize: 32,
    letterSpacing: 10,
    color: colors.text,
    textAlign: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  codeInputFocused: { borderColor: colors.primary },

  errorText: {
    ...typography.caption,
    color: '#ff6b6b',
    textAlign: 'center',
  },
  hint: {
    ...typography.caption,
    color: colors.subtext,
    textAlign: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  pressed: { opacity: 0.7 },
});

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSyncRoomStore } from '../../stores/syncRoomStore';
import { colors } from '../../constants/colors';
import { typography } from '../../constants/typography';
import { spacing } from '../../constants/spacing';
import { tapFeedback, successFeedback, warningFeedback } from '../../utils/haptics';

export default function SyncRoomHome() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const createRoom = useSyncRoomStore((s) => s.createRoom);
  const joinRoom = useSyncRoomStore((s) => s.joinRoom);
  const isHydrating = useSyncRoomStore((s) => s.isHydrating);
  const storeError = useSyncRoomStore((s) => s.error);

  const [roomName, setRoomName] = useState('Punjabi Jam Crew');
  const [code, setCode] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const handleCreate = async () => {
    Keyboard.dismiss();
    tapFeedback();
    try {
      setLocalError(null);
      const roomId = await createRoom({ name: roomName.trim() || 'SyncRoom' });
      successFeedback();
      router.push(`/syncroom/${roomId}/listen`);
    } catch (err: any) {
      warningFeedback();
      setLocalError(err?.message || 'Room create nahi ho paya');
    }
  };

  const handleJoin = async () => {
    Keyboard.dismiss();
    tapFeedback();
    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode) {
      warningFeedback();
      setLocalError('Invite code daalo');
      return;
    }
    try {
      setLocalError(null);
      const roomId = await joinRoom(cleanCode);
      successFeedback();
      router.push(`/syncroom/${roomId}/listen`);
    } catch (err: any) {
      warningFeedback();
      setLocalError(err?.message || 'Room join nahi ho paya');
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
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
        <Text style={styles.headerTitle}>SyncRoom</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.heroTitle}>Fair-Turns SyncRoom</Text>
        <Text style={styles.heroSubtitle}>
          Doston ke saath milkar suno — equal turns, synchronized playback aur skip voting!
        </Text>

        {(localError || storeError) ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={18} color="#FF6B6B" />
            <Text style={styles.errorText}>{localError || storeError}</Text>
          </View>
        ) : null}

        {/* Create Room Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Naya Room Banao</Text>
          <Text style={styles.cardSubtitle}>Aap host hoge aur sabhi log saath sunenge</Text>

          <Text style={styles.inputLabel}>ROOM KA NAAM</Text>
          <TextInput
            value={roomName}
            onChangeText={setRoomName}
            placeholder="Jaise: Punjabi Jam Crew"
            placeholderTextColor={colors.subtext}
            style={styles.input}
            maxLength={32}
          />

          <Pressable
            style={({ pressed }) => [styles.btnPrimary, pressed && styles.pressed]}
            onPress={handleCreate}
            disabled={isHydrating}
          >
            {isHydrating ? (
              <ActivityIndicator color={colors.background} size="small" />
            ) : (
              <>
                <Ionicons name="add-circle-outline" size={20} color={colors.background} />
                <Text style={styles.btnPrimaryText}>Create Room</Text>
              </>
            )}
          </Pressable>
        </View>

        {/* Divider */}
        <View style={styles.dividerRow}>
          <View style={styles.divider} />
          <Text style={styles.dividerText}>ya code se join karo</Text>
          <View style={styles.divider} />
        </View>

        {/* Join Room Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Invite Code Se Join Karo</Text>
          <Text style={styles.cardSubtitle}>Host ka share kiya gaya invite code daalo</Text>

          <Text style={styles.inputLabel}>INVITE CODE</Text>
          <TextInput
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase())}
            placeholder="Jaise: A1B2C3D4"
            placeholderTextColor={colors.subtext}
            style={[styles.input, styles.codeInput]}
            autoCapitalize="characters"
            maxLength={16}
          />

          <Pressable
            style={({ pressed }) => [
              styles.btnSecondary,
              !code.trim() && styles.btnDisabled,
              pressed && styles.pressed,
            ]}
            onPress={handleJoin}
            disabled={!code.trim() || isHydrating}
          >
            <Ionicons name="enter-outline" size={20} color={colors.text} />
            <Text style={styles.btnSecondaryText}>Join Room</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  btnDisabled: {
    opacity: 0.4,
  },
  btnPrimary: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: spacing.md,
    paddingVertical: 14,
  },
  btnPrimaryText: {
    color: colors.background,
    fontSize: 15,
    fontWeight: '700',
  },
  btnSecondary: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: spacing.md,
    paddingVertical: 14,
  },
  btnSecondaryText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 16,
    borderWidth: 1,
    padding: spacing.lg,
  },
  cardSubtitle: {
    ...typography.caption,
    color: colors.subtext,
    marginBottom: spacing.md,
    marginTop: 2,
  },
  cardTitle: {
    ...typography.h2,
    color: colors.text,
    fontSize: 17,
  },
  codeInput: {
    fontFamily: 'monospace',
    letterSpacing: 2,
  },
  container: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  divider: {
    backgroundColor: colors.border,
    flex: 1,
    height: 1,
  },
  dividerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  dividerText: {
    ...typography.caption,
    color: colors.subtext,
  },
  errorBox: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 107, 107, 0.1)',
    borderColor: 'rgba(255, 107, 107, 0.3)',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.md,
  },
  errorText: {
    ...typography.caption,
    color: '#FF6B6B',
    flex: 1,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  headerSpacer: {
    width: 30,
  },
  headerTitle: {
    ...typography.h1,
    color: colors.text,
    fontSize: 20,
  },
  heroSubtitle: {
    ...typography.body,
    color: colors.subtext,
    fontSize: 13,
    marginBottom: spacing.xs,
    marginTop: 2,
    textAlign: 'center',
  },
  heroTitle: {
    ...typography.h1,
    color: colors.text,
    fontSize: 24,
    textAlign: 'center',
  },
  iconButton: {
    padding: spacing.xs,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  inputLabel: {
    ...typography.caption,
    color: colors.subtext,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 6,
  },
  pressed: {
    opacity: 0.75,
  },
});


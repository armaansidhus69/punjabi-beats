/**
 * Create room — /jam/create (Phase 11).
 * Type (jam / listening_party) + title + visibility → create → detail push.
 */
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Toast from 'react-native-toast-message';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import JamGate from '../../components/JamGate';
import { JamServiceError } from '../../services/jamService';
import { useJam } from '../../stores/jamStore';
import { colors } from '../../constants/colors';
import { typography } from '../../constants/typography';
import { spacing } from '../../constants/spacing';
import { successFeedback, tapFeedback } from '../../utils/haptics';
import { roomTypeLabel, roomTypeSubtitleLabel } from '../../utils/jamLabels';
import type { RoomType } from '../../types';

export default function CreateJamScreen() {
  const insets = useSafeAreaInsets();
  const createRoomAndOpen = useJam(s => s.createRoomAndOpen);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<RoomType>('jam');
  const [visibility, setVisibility] = useState<'private_invite' | 'public'>('private_invite');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = title.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const room = await createRoomAndOpen({ title, type, visibility });
      successFeedback();
      Toast.show({ type: 'success', text1: 'Room ban gaya', text2: title.trim() });
      router.replace(`/jam/${room.id}`);
    } catch (err) {
      const message =
        err instanceof JamServiceError ? err.message : 'Room create nahi hui. Phir try karo.';
      Toast.show({ type: 'error', text1: 'Create failed', text2: message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <JamGate>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
          <Pressable
            onPress={router.back}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Wapas jao"
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Naya Room</Text>
          <View style={styles.iconSpacer} />
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Room type</Text>
          <View style={styles.typeRow}>
            {(['jam', 'listening_party'] as const).map(option => (
              <Pressable
                key={option}
                style={[styles.typeButton, type === option && styles.typeButtonActive]}
                onPress={() => {
                  tapFeedback();
                  setType(option);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: type === option }}
              >
                <Text style={[styles.typeTitle, type === option && styles.typeTextActive]}>
                  {roomTypeLabel(option)}
                </Text>
                <Text
                  style={[styles.typeSubtitle, type === option && styles.typeTextActive]}
                  numberOfLines={2}
                >
                  {roomTypeSubtitleLabel(option)}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Room ka naam</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Late Night Bhangra"
            placeholderTextColor={colors.subtext}
            maxLength={80}
            returnKeyType="done"
          />

          <Text style={styles.label}>Visibility</Text>
          <View style={styles.visibilityRow}>
            {(['private_invite', 'public'] as const).map(option => (
              <Pressable
                key={option}
                style={[styles.visibilityButton, visibility === option && styles.visibilityActive]}
                onPress={() => {
                  tapFeedback();
                  setVisibility(option);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: visibility === option }}
              >
                <Text style={[styles.visibilityText, visibility === option && styles.visibilityTextActive]}>
                  {option === 'private_invite' ? 'Invite only' : 'Public'}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.caption}>
            {type === 'jam'
              ? 'Jam: max 8 members — sab songs queue me add kar sakte hain.'
              : 'Listening Party: max 100 — playback sirf host/co-host chalte hain.'}
          </Text>

          <Pressable
            style={({ pressed }) => [
              styles.submit,
              pressed && styles.pressed,
              !canSubmit && styles.submitDisabled,
            ]}
            onPress={() => void handleSubmit()}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityLabel="Room banao"
          >
            <Text style={styles.submitText}>{submitting ? 'Banaya ja raha…' : 'Room banao'}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </JamGate>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  iconButton: { padding: spacing.xs },
  iconSpacer: { width: 30 },
  headerTitle: { ...typography.h1, color: colors.text, flex: 1, textAlign: 'center' },
  body: { padding: spacing.lg, gap: spacing.sm },
  label: { ...typography.h2, color: colors.text, marginTop: spacing.md },
  typeRow: { flexDirection: 'row', gap: spacing.sm },
  typeButton: {
    flex: 1,
    padding: spacing.md,
    borderRadius: 10,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  typeButtonActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  typeTitle: { ...typography.h2, color: colors.text, fontSize: 16 },
  typeSubtitle: { ...typography.caption, color: colors.subtext },
  typeTextActive: { color: colors.background },
  input: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.card,
    borderRadius: 10,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  visibilityRow: { flexDirection: 'row', gap: spacing.sm },
  visibilityButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: 10,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  visibilityActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  visibilityText: { ...typography.body, color: colors.text },
  visibilityTextActive: { color: colors.background, fontWeight: '700' },
  caption: { ...typography.caption, color: colors.subtext },
  submit: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  submitDisabled: { opacity: 0.4 },
  submitText: { ...typography.body, color: colors.background, fontWeight: '700', fontSize: 16 },
  pressed: { opacity: 0.85 },
});

/**
 * Create Blend — /blend/create (Phase 10 roadmap).
 * Name (1–60) + visibility → create → snapshot upload → instant compute →
 * detail screen push. Flag off ho to is route ki haveli BlendGate pe hai.
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
import BlendGate from '../../components/BlendGate';
import { BlendServiceError } from '../../services/blendService';
import { useBlends } from '../../stores/blendStore';
import { colors } from '../../constants/colors';
import { typography } from '../../constants/typography';
import { spacing } from '../../constants/spacing';
import { successFeedback, tapFeedback } from '../../utils/haptics';

export default function CreateBlendScreen() {
  const insets = useSafeAreaInsets();
  const createBlendAndOpen = useBlends(s => s.createBlendAndOpen);
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<'members' | 'public'>('members');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = name.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const blend = await createBlendAndOpen({ name, visibility });
      successFeedback();
      Toast.show({ type: 'success', text1: 'Blend ban gaya', text2: name.trim() });
      router.replace(`/blend/${blend.id}`);
    } catch (err) {
      const message =
        err instanceof BlendServiceError ? err.message : 'Blend create nahi hui. Phir try karo.';
      Toast.show({ type: 'error', text1: 'Create failed', text2: message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <BlendGate>
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
          <Text style={styles.headerTitle}>Naya Blend</Text>
          <View style={styles.iconSpacer} />
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.hint}>
            Apni aur dost ki library se dup Bhangra-Indi fusion playlist banigi 🎶
          </Text>

          <Text style={styles.label}>Blend ka naam</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Gabbroo Gidhe wale"
            placeholderTextColor={colors.subtext}
            maxLength={60}
            returnKeyType="done"
          />

          <Text style={styles.label}>Visibility</Text>
          <View style={styles.visibilityRow}>
            {(['members', 'public'] as const).map(option => (
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
                  {option === 'members' ? 'Sirf members' : 'Public'}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.caption}>
            Members = link/code se hi join hoga. Public list me dikh patnda rahega.
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
            accessibilityLabel="Blend banao"
          >
            <Text style={styles.submitText}>{submitting ? 'Banaya ja raha…' : 'Blend banao'}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </BlendGate>
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
  hint: { ...typography.body, color: colors.subtext, marginBottom: spacing.sm },
  label: { ...typography.h2, color: colors.text, marginTop: spacing.md },
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

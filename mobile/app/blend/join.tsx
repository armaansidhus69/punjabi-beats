/**
 * Blend join — /blend/join?code=XXXXXXXX (Phase 10 invitation).
 * Deep link (punjabi-beats://blend/join?code=…) + manual code entry dono
 * isi screen pe aate hain. Login gate: guest → /auth/login pe homage,
 * wapas aane pe isi code ke saath next aayega.
 */
import { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import Toast from 'react-native-toast-message';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BlendGate from '../../components/BlendGate';
import { BlendServiceError } from '../../services/blendService';
import { useBlends } from '../../stores/blendStore';
import { colors } from '../../constants/colors';
import { typography } from '../../constants/typography';
import { spacing } from '../../constants/spacing';
import { successFeedback } from '../../utils/haptics';

export default function BlendJoinScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ code?: string }>();
  const joinWithCode = useBlends(s => s.joinWithCode);

  const [code, setCode] = useState(typeof params.code === 'string' ? params.code.toUpperCase() : '');
  const [joining, setJoining] = useState(false);

  // Login se wapas aaya ho (deep-link redirect) → code yaad rakho
  useEffect(() => {
    if (typeof params.code === 'string' && params.code.length > 0) {
      setCode(params.code.toUpperCase());
    }
  }, [params.code]);

  const handleJoin = useCallback(
    async (candidate: string) => {
      const trimmed = candidate.trim().toUpperCase();
      if (trimmed.length !== 8 || joining) return;
      setJoining(true);
      try {
        const blendId = await joinWithCode(trimmed);
        successFeedback();
        Toast.show({ type: 'success', text1: 'Blend joined! 🎉', text2: 'Welcome aboard' });
        router.replace(`/blend/${blendId}`);
      } catch (err) {
        const message =
          err instanceof BlendServiceError
            ? translateJoinError(err)
            : 'Join nahi ho paya. Phir try karo.';
        Toast.show({ type: 'error', text1: 'Join failed', text2: message });
      } finally {
        setJoining(false);
      }
    },
    [joining, joinWithCode],
  );

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
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Blend</Text>
          <View style={styles.iconSpacer} />
        </View>

        <View style={styles.body}>
          <Ionicons name="git-merge-outline" size={56} color={colors.primary} />
          <Text style={styles.title}>Blend join karo</Text>
          <Text style={styles.subtitle}>
            Dost ne 8-letter code diya hai jo wo invite me share karta hai. Link khole to code khud bhar jayega.
          </Text>

          <TextInput
            style={styles.codeInput}
            value={code}
            onChangeText={text => setCode(text.toUpperCase().replace(/[^A-Z2-9]/g, ''))}
            placeholder="ABCDEFGH"
            placeholderTextColor={colors.subtext}
            autoCapitalize="characters"
            maxLength={8}
            autoComplete="off"
            spellCheck={false}
            returnKeyType="go"
            onSubmitEditing={() => void handleJoin(code)}
          />

          <Pressable
            style={({ pressed }) => [
              styles.joinButton,
              pressed && styles.pressed,
              (code.length !== 8 || joining) && styles.joinButtonDisabled,
            ]}
            onPress={() => void handleJoin(code)}
            disabled={code.length !== 8 || joining}
            accessibilityRole="button"
            accessibilityLabel="Blend join karo"
          >
            <Text style={styles.joinText}>{joining ? 'Join ho raha…' : 'Blend join karo'}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </BlendGate>
  );
}

function translateJoinError(err: BlendServiceError): string {
  switch (err.code) {
    case 'invite_invalid_or_expired':
      return 'Link expired ho gaya ya code galat hai.';
    case 'member_cap_reached':
      return 'Blend full hai (10 members max).';
    case 'not_authenticated':
      return 'Login karo phir code daalo.';
    case 'not_configured':
    case 'feature_disabled':
      return 'Blend abhi available nahi hai.';
    default:
      return 'Join nahi ho paya. Phir try karo.';
  }
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
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: { ...typography.h1, color: colors.text, textAlign: 'center' },
  subtitle: { ...typography.body, color: colors.subtext, textAlign: 'center', lineHeight: 20 },
  codeInput: {
    ...typography.h1,
    color: colors.text,
    letterSpacing: 8,
    textAlign: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    width: '100%',
  },
  joinButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: 999,
    marginTop: spacing.sm,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  joinButtonDisabled: { opacity: 0.4 },
  joinText: { ...typography.body, color: colors.background, fontWeight: '700', fontSize: 16 },
  pressed: { opacity: 0.85 },
});

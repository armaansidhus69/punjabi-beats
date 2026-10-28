import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput } from 'react-native';
import { router } from 'expo-router';
import AuthShell, { authStyles } from '../../components/AuthShell';
import { colors } from '../../constants/colors';
import { useAuthStore } from '../../stores/authStore';

export default function ForgotPasswordScreen() {
  const resetPassword = useAuthStore(state => state.resetPassword);
  const storeError = useAuthStore(state => state.error);
  const clearError = useAuthStore(state => state.clearError);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim()) {
      setLocalError('Email bharna zaroori hai.');
      return;
    }
    setBusy(true);
    setLocalError(null);
    setSent(false);
    clearError();
    try {
      await resetPassword(email);
      setSent(true);
    } catch {
      // The store exposes the stable error for the rendered message.
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Reset password" subtitle="Email paake password reset link mangwao.">
      <Text style={authStyles.label}>Email</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        placeholderTextColor={colors.subtext}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        style={authStyles.input}
        accessibilityLabel="Email"
      />

      {sent ? <Text style={authStyles.success}>Reset link email te bheji gayi hai.</Text> : null}
      {localError || storeError ? <Text style={authStyles.error}>{localError ?? storeError?.message}</Text> : null}

      <Pressable
        onPress={() => void submit()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Send password reset link"
        style={({ pressed }) => [authStyles.primaryButton, pressed && styles.pressed, busy && styles.disabled]}
      >
        <Text style={authStyles.primaryButtonText}>{busy ? 'Sending…' : 'Send reset link'}</Text>
      </Pressable>

      <Pressable
        onPress={() => router.replace('/auth/login')}
        accessibilityRole="button"
        accessibilityLabel="Back to sign in"
        style={authStyles.secondaryButton}
      >
        <Text style={authStyles.secondaryButtonText}>Back to sign in</Text>
      </Pressable>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.55 },
});

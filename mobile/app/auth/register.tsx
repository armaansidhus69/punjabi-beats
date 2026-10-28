import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import AuthShell, { authStyles } from '../../components/AuthShell';
import { colors } from '../../constants/colors';
import { useAuthStore } from '../../stores/authStore';
import GoogleAuthButton from '../../components/GoogleAuthButton';

export default function RegisterScreen() {
  const register = useAuthStore(state => state.register);
  const storeError = useAuthStore(state => state.error);
  const clearError = useAuthStore(state => state.clearError);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim() || !password) {
      setLocalError('Email te password dono bharna zaroori hai.');
      return;
    }
    if (password.length < 6) {
      setLocalError('Password kam ton kam 6 characters da hona chahida hai.');
      return;
    }

    setBusy(true);
    setLocalError(null);
    setSuccess(null);
    clearError();
    try {
      const needsVerification = await register(email, password, displayName);
      if (needsVerification) {
        setSuccess('Verification email bheji gayi hai. Email verify karke phir sign in karo.');
      } else {
        router.replace('/auth/profile');
      }
    } catch {
      // The store exposes the stable error for the rendered message.
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Create account" subtitle="Apni library nu devices te ready rakho.">
      <View style={authStyles.row}>
        <Text style={authStyles.label}>Display name (optional)</Text>
        <TextInput
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Your name"
          placeholderTextColor={colors.subtext}
          autoCapitalize="words"
          style={authStyles.input}
          accessibilityLabel="Display name"
        />
      </View>

      <View style={authStyles.row}>
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
      </View>

      <View style={authStyles.row}>
        <Text style={authStyles.label}>Password</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="At least 6 characters"
          placeholderTextColor={colors.subtext}
          secureTextEntry
          autoComplete="new-password"
          style={authStyles.input}
          accessibilityLabel="Password"
        />
      </View>

      {success ? <Text style={authStyles.success}>{success}</Text> : null}
      {localError || storeError ? <Text style={authStyles.error}>{localError ?? storeError?.message}</Text> : null}

      <Pressable
        onPress={() => void submit()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Create account"
        style={({ pressed }) => [authStyles.primaryButton, pressed && styles.pressed, busy && styles.disabled]}
      >
        <Text style={authStyles.primaryButtonText}>{busy ? 'Creating…' : 'Create account'}</Text>
      </Pressable>

      <View style={styles.oauthDivider}>
        <View style={styles.dividerLine} />
        <Text style={styles.orText}>or</Text>
        <View style={styles.dividerLine} />
      </View>

      <GoogleAuthButton onNativeSuccess={() => router.replace('/')} />

      <Pressable
        onPress={() => router.replace('/auth/login')}
        accessibilityRole="button"
        accessibilityLabel="Go to sign in"
        style={authStyles.secondaryButton}
      >
        <Text style={authStyles.secondaryButtonText}>Already have an account? Sign in</Text>
      </Pressable>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  oauthDivider: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  orText: { ...authStyles.secondaryButtonText, color: colors.subtext, fontWeight: '400' },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.55 },
});

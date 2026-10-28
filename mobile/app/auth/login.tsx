import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import AuthShell, { authStyles } from '../../components/AuthShell';
import { colors } from '../../constants/colors';
import { spacing } from '../../constants/spacing';
import { useAuthStore } from '../../stores/authStore';
import GoogleAuthButton from '../../components/GoogleAuthButton';

export default function LoginScreen() {
  const login = useAuthStore(state => state.login);
  const storeError = useAuthStore(state => state.error);
  const clearError = useAuthStore(state => state.clearError);
  const authStatus = useAuthStore(state => state.status);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (authStatus === 'authenticated') router.replace('/');
  }, [authStatus]);

  const submit = async () => {
    if (!email.trim() || !password) {
      setLocalError('Email te password dono bharna zaroori hai.');
      return;
    }
    setBusy(true);
    setLocalError(null);
    clearError();
    try {
      await login(email, password);
      router.replace('/');
    } catch {
      // The store exposes the stable error for the rendered message.
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Welcome back" subtitle="Apne Punjabi Beats account vich sign in karo.">
      <View style={authStyles.row}>
        <Text style={authStyles.label}>Email</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          onFocus={() => {
            setLocalError(null);
            clearError();
          }}
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
          placeholder="Your password"
          placeholderTextColor={colors.subtext}
          secureTextEntry
          autoComplete="password"
          style={authStyles.input}
          accessibilityLabel="Password"
        />
      </View>

      {localError || storeError ? <Text style={authStyles.error}>{localError ?? storeError?.message}</Text> : null}

      <Pressable
        onPress={() => void submit()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Sign in"
        style={({ pressed }) => [authStyles.primaryButton, pressed && styles.pressed, busy && styles.disabled]}
      >
        <Text style={authStyles.primaryButtonText}>{busy ? 'Signing in…' : 'Sign in'}</Text>
      </Pressable>

      <View style={styles.oauthDivider}>
        <View style={styles.dividerLine} />
        <Text style={styles.orText}>or</Text>
        <View style={styles.dividerLine} />
      </View>

      <GoogleAuthButton onNativeSuccess={() => router.replace('/')} />

      <Pressable
        onPress={() => router.push('/auth/forgot-password')}
        accessibilityRole="button"
        accessibilityLabel="Forgot password"
        style={authStyles.secondaryButton}
      >
        <Text style={authStyles.secondaryButtonText}>Forgot password?</Text>
      </Pressable>

      <View style={styles.divider} />

      <Pressable
        onPress={() => router.push('/auth/register')}
        accessibilityRole="button"
        accessibilityLabel="Create account"
        style={authStyles.secondaryButton}
      >
        <Text style={authStyles.secondaryButtonText}>Create account</Text>
      </Pressable>

      <Pressable
        onPress={() => router.replace('/')}
        accessibilityRole="button"
        accessibilityLabel="Continue as guest"
        style={authStyles.secondaryButton}
      >
        <Text style={styles.guestText}>Continue as guest</Text>
      </Pressable>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
  oauthDivider: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  orText: { ...authStyles.secondaryButtonText, color: colors.subtext, fontWeight: '400' },
  guestText: { ...authStyles.secondaryButtonText, color: colors.subtext },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.55 },
});

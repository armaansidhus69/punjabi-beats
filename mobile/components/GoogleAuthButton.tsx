import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Platform, Pressable, StyleSheet, Text } from 'react-native';
import { useAuthStore } from '../stores/authStore';
import { authStyles } from './AuthShell';
import { colors } from '../constants/colors';

interface GoogleAuthButtonProps {
  onNativeSuccess?: () => void;
}

export default function GoogleAuthButton({ onNativeSuccess }: GoogleAuthButtonProps) {
  const loginWithGoogle = useAuthStore(state => state.loginWithGoogle);
  const [busy, setBusy] = useState(false);

  const handlePress = async () => {
    setBusy(true);
    try {
      await loginWithGoogle();
      if (Platform.OS !== 'web') onNativeSuccess?.();
    } catch {
      // The auth store exposes the stable error to the parent screen.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable
      onPress={() => void handlePress()}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel="Continue with Google"
      style={({ pressed }) => [styles.button, pressed && styles.pressed, busy && styles.disabled]}
    >
      <Ionicons name="logo-google" size={18} color={colors.text} />
      <Text style={styles.text}>{busy ? 'Opening Google…' : 'Continue with Google'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    ...authStyles.secondaryButton,
    flexDirection: 'row',
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    backgroundColor: colors.surface,
  },
  text: {
    ...authStyles.secondaryButtonText,
    color: colors.text,
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.55 },
});

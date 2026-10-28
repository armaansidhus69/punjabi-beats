import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput } from 'react-native';
import { router } from 'expo-router';
import AuthShell, { authStyles } from '../../components/AuthShell';
import { colors } from '../../constants/colors';
import { useAuthStore } from '../../stores/authStore';

export default function ProfileScreen() {
  const status = useAuthStore(state => state.status);
  const initialized = useAuthStore(state => state.initialized);
  const user = useAuthStore(state => state.user);
  const profile = useAuthStore(state => state.profile);
  const storeError = useAuthStore(state => state.error);
  const saveProfile = useAuthStore(state => state.saveProfile);
  const logout = useAuthStore(state => state.logout);
  const clearError = useAuthStore(state => state.clearError);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [loggedOut, setLoggedOut] = useState(false);

  useEffect(() => {
    setDisplayName(profile?.display_name ?? '');
    setUsername(profile?.username ?? '');
  }, [profile]);

  useEffect(() => {
    if (initialized && status === 'guest' && !loggedOut) router.replace('/auth/login');
  }, [initialized, loggedOut, status]);

  const save = async () => {
    setBusy(true);
    clearError();
    try {
      await saveProfile({
        display_name: displayName.trim(),
        username: username.trim() || null,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    setBusy(true);
    clearError();
    try {
      await logout();
      setLoggedOut(true);
      router.replace('/');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Your profile"
      subtitle={user?.email ? `Signed in as ${user.email}` : 'Apni account details update karo.'}
    >
      <Text style={authStyles.label}>Display name</Text>
      <TextInput
        value={displayName}
        onChangeText={setDisplayName}
        placeholder="Your name"
        placeholderTextColor={colors.subtext}
        autoCapitalize="words"
        style={authStyles.input}
        accessibilityLabel="Display name"
      />

      <Text style={authStyles.label}>Username (optional)</Text>
      <TextInput
        value={username}
        onChangeText={setUsername}
        placeholder="punjabi_fan"
        placeholderTextColor={colors.subtext}
        autoCapitalize="none"
        autoCorrect={false}
        style={authStyles.input}
        accessibilityLabel="Username"
      />

      {storeError ? <Text style={authStyles.error}>{storeError.message}</Text> : null}

      <Pressable
        onPress={() => void save()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Save profile"
        style={({ pressed }) => [authStyles.primaryButton, pressed && styles.pressed, busy && styles.disabled]}
      >
        <Text style={authStyles.primaryButtonText}>{busy ? 'Saving…' : 'Save profile'}</Text>
      </Pressable>

      <Pressable
        onPress={() => void handleLogout()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Log out"
        style={authStyles.secondaryButton}
      >
        <Text style={[authStyles.secondaryButtonText, styles.logoutText]}>Log out</Text>
      </Pressable>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.55 },
  logoutText: { color: '#ff8d9e' },
});

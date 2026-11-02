import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput } from 'react-native';
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
  const logoutEverywhere = useAuthStore(state => state.logoutEverywhere);
  const deleteAccountAction = useAuthStore(state => state.deleteAccount);
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

  /* Phase 1 completion — sab devices logout + account deletion */
  const handleLogoutEverywhere = async () => {
    setBusy(true);
    clearError();
    try {
      await logoutEverywhere();
      setLoggedOut(true);
      router.replace('/');
    } catch {
      // store.error set ho chuka — storeError render karta hai
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Account delete karo?',
      'Profile anonymize ho jayegi te tu sign out ho jayega. Ye wapas nahi hunda.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy(true);
              clearError();
              try {
                await deleteAccountAction();
                setLoggedOut(true);
                router.replace('/');
              } catch {
                // store.error set ho chuka — storeError render karta hai
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ],
    );
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

      {/* Phase 1 completion — multi-device + deletion */}
      <Pressable
        onPress={() => void handleLogoutEverywhere()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Sab devices se log out"
        style={authStyles.secondaryButton}
      >
        <Text style={[authStyles.secondaryButtonText, styles.logoutText]}>
          Log out of all devices
        </Text>
      </Pressable>

      <Pressable
        onPress={handleDeleteAccount}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Account delete karo"
        style={authStyles.secondaryButton}
      >
        <Text style={[authStyles.secondaryButtonText, { color: colors.danger }]}>
          Delete account
        </Text>
      </Pressable>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.55 },
  logoutText: { color: '#ff8d9e' },
});

/**
 * Blend gate (Phase 10) — har blend route pe use hota hai.
 * Conditions: `blend_enabled` flag + login session. Flag off / guest ho to
 * upsell panel render hota hai, children nahi. Guest ko login pe bhej dete
 * hain, wapas isi route pe aayega.
 */

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { getCurrentUser } from '../core/auth/authService';
import { isFeatureEnabled } from '../core/featureflags/featureFlags';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { spacing } from '../constants/spacing';
import { tapFeedback } from '../utils/haptics';

interface GateState {
  checking: boolean;
  enabled: boolean;
  authed: boolean;
}

export default function BlendGate({ children }: { children: React.ReactNode }) {
  const [gate, setGate] = useState<GateState>({ checking: true, enabled: false, authed: false });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const enabled = isFeatureEnabled('blend_enabled');
      const user = await getCurrentUser();
      if (cancelled) return;
      setGate({ checking: false, enabled, authed: user !== null });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (gate.checking) {
    return null;
  }

  if (!gate.enabled || !gate.authed) {
    return (
      <View style={styles.container}>
        <Ionicons name="git-merge-outline" size={48} color={colors.primary} />
        <Text style={styles.title}>Blend tease hai 👥</Text>
        <Text style={styles.subtitle}>
          {!gate.enabled
            ? 'Blend feature abhi internal testing me hai.'
            : 'Blend ke liye login zaroori hai — yahin apne dost ke taste se ek shared playlist banayiye.'}
        </Text>
        {gate.enabled && (
          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={() => {
              tapFeedback();
              router.push('/auth/login');
            }}
            accessibilityRole="button"
            accessibilityLabel="Login karo"
          >
            <Text style={styles.buttonText}>Login</Text>
          </Pressable>
        )}
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: { ...typography.h1, color: colors.text, textAlign: 'center' },
  subtitle: {
    ...typography.body,
    color: colors.subtext,
    textAlign: 'center',
    lineHeight: 20,
  },
  button: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: 999,
    marginTop: spacing.sm,
  },
  buttonPressed: { opacity: 0.85 },
  buttonText: {
    ...typography.body,
    color: colors.background,
    fontWeight: '700',
  },
});

/**
 * Podcast gate (Phase 12a) — JamGate pattern, par local-only: sirf
 * `podcasts_enabled` flag, koi login nahi (guest bhi chalega).
 */

import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { isFeatureEnabled } from '../core/featureflags/featureFlags';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { spacing } from '../constants/spacing';

export default function PodcastGate({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const enabledFlag = isFeatureEnabled('podcasts_enabled');
    setEnabled(enabledFlag);
    setChecking(false);
  }, []);

  if (checking) return null;

  if (!enabled) {
    return (
      <View style={styles.container}>
        <Ionicons name="mic-outline" size={48} color={colors.primary} />
        <Text style={styles.title}>Podcasts lock hain 🔒</Text>
        <Text style={styles.subtitle}>
          Podcasts abhi internal testing me hain — jald aapke liye uplabdh honge.
        </Text>
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
  title: { ...typography.h2, color: colors.text, textAlign: 'center' },
  subtitle: { ...typography.body, color: colors.subtext, textAlign: 'center' },
});

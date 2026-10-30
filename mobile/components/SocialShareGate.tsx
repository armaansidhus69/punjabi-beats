/**
 * Signed share landing gate (Phase 8a). Existing legacy native share actions
 * flag-off pe bhi rehte; naya resolve screen/network sirf flag on pe mount.
 */

import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { isFeatureEnabled } from '../core/featureflags/featureFlags';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { spacing } from '../constants/spacing';

export default function SocialShareGate({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(isFeatureEnabled('social_share_enabled'));
    setChecking(false);
  }, []);

  if (checking) return null;
  if (!enabled) {
    return (
      <View style={styles.container}>
        <Ionicons name="share-social-outline" size={48} color={colors.primary} />
        <Text style={styles.title}>Signed links lock hain 🔒</Text>
        <Text style={styles.subtitle}>
          Secure share links abhi internal testing me hain — legacy text sharing chalta rahega.
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

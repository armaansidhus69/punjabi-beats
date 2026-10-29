/**
 * AI Playlist gate (Phase 13b) — PodcastGate pattern: sirf
 * `ai_playlist_enabled` flag, koi login nahi (guest bhi chalega).
 */

import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { isFeatureEnabled } from '../core/featureflags/featureFlags';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { spacing } from '../constants/spacing';

export default function AiPlaylistGate({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(isFeatureEnabled('ai_playlist_enabled'));
    setChecking(false);
  }, []);

  if (checking) return null;

  if (!enabled) {
    return (
      <View style={styles.container}>
        <Ionicons name="sparkles-outline" size={48} color={colors.primary} />
        <Text style={styles.title}>AI Playlist lock hai 🔒</Text>
        <Text style={styles.subtitle}>
          AI playlist abhi internal testing me hai — jald aapke liye available hoga.
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

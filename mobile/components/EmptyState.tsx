/**
 * EmptyState — jab koi results / playlist / history na ho.
 * Consistent look: icon + title + optional subtitle + optional children (actions).
 */
import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { spacing } from '../constants/spacing';

interface EmptyStateProps {
  icon?: keyof typeof Ionicons.glyphMap;
  /** Ionicons ke bajaye bada emoji (search ke 🎤 / 😕 states) */
  emoji?: string;
  title: string;
  subtitle?: string;
  children?: ReactNode;
}

export default function EmptyState({
  icon = 'musical-notes-outline',
  emoji,
  title,
  subtitle,
  children,
}: EmptyStateProps) {
  return (
    <View style={styles.container}>
      {emoji ? (
        <Text style={styles.emoji}>{emoji}</Text>
      ) : (
        <Ionicons name={icon} size={44} color={colors.border} />
      )}
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {children ? <View style={styles.actions}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  emoji: { fontSize: 60 },
  title: { ...typography.h2, color: colors.text, textAlign: 'center', marginTop: spacing.sm },
  subtitle: { ...typography.body, color: colors.subtext, textAlign: 'center' },
  actions: { marginTop: spacing.lg, width: '100%', alignItems: 'center' },
});
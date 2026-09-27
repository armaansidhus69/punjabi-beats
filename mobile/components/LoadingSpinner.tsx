/**
 * LoadingSpinner — consistent loading indicator (optional label ke saath).
 */
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { spacing } from '../constants/spacing';

interface LoadingSpinnerProps {
  label?: string;
  /** chhota inline version (lists ke andar) */
  compact?: boolean;
}

export default function LoadingSpinner({ label, compact }: LoadingSpinnerProps) {
  return (
    <View style={[styles.container, compact && styles.compact]}>
      <ActivityIndicator color={colors.primary} size={compact ? 'small' : 'large'} />
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  compact: { flex: 0, padding: spacing.lg },
  label: { ...typography.body, color: colors.subtext },
});
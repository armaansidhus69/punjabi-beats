/**
 * AppErrorBoundary — friendly crash screen (kisi bhi screen pe JS error aaye to
 * red screen / blank screen ki jagah ye dikhega).
 *
 * NOTE (verified: expo-router@3.5 build/views/Try.d.ts): error *catch* khud
 * expo-router karta hai (andar ka class `Try` getDerivedStateFromError use karta
 * hai) aur route ke ErrorBoundary export ko sirf `{ error, retry }` props milte
 * hain. Isliye ye functional component hai — PROMPT ka "no class components"
 * rule follow hota hai.
 *
 * Route file me wiring aise karo (router static analysis ke liye inline export):
 *   import { ErrorBoundaryProps } from 'expo-router';
 *   import AppErrorBoundary from '../components/ErrorBoundary';
 *   export function ErrorBoundary(props: ErrorBoundaryProps) {
 *     return <AppErrorBoundary {...props} />;
 *   }
 */
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ErrorBoundaryProps } from 'expo-router';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { spacing } from '../constants/spacing';

export default function AppErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={styles.container}>
      <Ionicons name="alert-circle-outline" size={52} color={colors.primary} />
      <Text style={styles.title}>Kuch galat ho gaya 😔</Text>
      <Text style={styles.subtitle}>
        App ek unexpected error se ruk gaya. Neeche wala button try karo.
      </Text>

      <ScrollView style={styles.errorBox} contentContainerStyle={styles.errorContent}>
        <Text style={styles.errorText} selectable>
          {error.message || 'Unknown error'}
        </Text>
      </ScrollView>

      <Pressable
        onPress={() => {
          void retry();
        }}
        accessibilityRole="button"
        accessibilityLabel="Dobara try karo"
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <Ionicons name="refresh" size={18} color={colors.background} />
        <Text style={styles.buttonText}>Try Again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  title: { ...typography.h1, color: colors.text, textAlign: 'center' },
  subtitle: { ...typography.body, color: colors.subtext, textAlign: 'center' },
  errorBox: {
    maxHeight: 140,
    width: '100%',
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
  },
  errorContent: { padding: spacing.lg },
  errorText: { ...typography.caption, color: colors.subtext, fontFamily: 'monospace' },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  buttonText: { ...typography.body, color: colors.background, fontWeight: '700' },
  pressed: { opacity: 0.7 },
});

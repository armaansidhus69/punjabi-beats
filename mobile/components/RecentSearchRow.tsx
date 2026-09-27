/**
 * RecentSearchRow — "Recent Searches" list ka ek row (Phase 5).
 * Clock icon + query + X (sirf ye entry hatao). Row tap pe wahi query dobara
 * search hoti hai — decision parent screen ka hai (controlled component).
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { spacing } from '../constants/spacing';
import { tapFeedback, warningFeedback } from '../utils/haptics';

interface RecentSearchRowProps {
  query: string;
  onPress: (query: string) => void;
  onRemove: (query: string) => void;
}

export default function RecentSearchRow({ query, onPress, onRemove }: RecentSearchRowProps) {
  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => {
          tapFeedback();
          onPress(query);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${query} dobara search karo`}
        style={({ pressed }) => [styles.main, pressed && styles.pressed]}
      >
        <Ionicons name="time-outline" size={16} color={colors.subtext} />
        <Text style={styles.query} numberOfLines={1}>
          {query}
        </Text>
      </Pressable>

      <Pressable
        onPress={() => {
          warningFeedback();
          onRemove(query);
        }}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`${query} ko recent searches se hatao`}
        style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
      >
        <Ionicons name="close" size={16} color={colors.subtext} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    paddingHorizontal: spacing.lg,
  },
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    height: '100%',
  },
  query: { ...typography.body, color: colors.text, flex: 1 },
  removeButton: { padding: spacing.xs },
  pressed: { opacity: 0.6 },
});

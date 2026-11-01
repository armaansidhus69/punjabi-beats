/**
 * MoodCard — home grid ka ek card (emoji + title + accent color).
 * Fully controlled: tap pe parent ko mood deta hai, navigation parent karta hai.
 *
 * Press animation Reanimated se (Phase 13) — spring scale UI thread pe chalta
 * hai, isliye list smooth rehti hai (babel plugin: babel-preset-expo auto lagata hai).
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Mood } from '../types';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { spacing } from '../constants/spacing';

/** Spring tuning — tez par soft (card pe tap jaisa feel) */
const PRESS_SPRING = { damping: 14, stiffness: 260, mass: 0.6 };

/** Reanimated-wrapped Pressable — animated style native thread pe chalta hai */
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface MoodCardProps {
  mood: Mood;
  onPress: (mood: Mood) => void;
}

export default function MoodCard({ mood, onPress }: MoodCardProps) {
  const accent = mood.color ?? colors.primary;
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={`${mood.title} playlist`}
      onPress={() => onPress(mood)}
      onPressIn={() => {
        scale.value = withSpring(1.03, PRESS_SPRING);
      }}
      onPressOut={() => {
        scale.value = withSpring(1, PRESS_SPRING);
      }}
      style={[styles.card, animatedStyle]}
    >
      <View style={styles.topRow}>
        <View style={styles.emojiContainer}>
          <Text style={styles.emoji}>{mood.emoji}</Text>
        </View>
        {mood.punjabi ? (
          <View style={[styles.punjabiBadge, { borderColor: `${accent}40` }]}>
            <Text style={[styles.punjabiText, { color: accent }]}>{mood.punjabi}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.footer}>
        <Text style={styles.title} numberOfLines={1}>
          {mood.title}
        </Text>
        {mood.note ? (
          <Text style={styles.note} numberOfLines={1}>
            {mood.note}
          </Text>
        ) : null}
        {/* Accent bar — har mood ka apna rang */}
        <View style={[styles.accentBar, { backgroundColor: accent }]} />
      </View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minHeight: 124,
    backgroundColor: '#161622',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: spacing.md,
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  emojiContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: { fontSize: 22 },
  punjabiBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
  },
  punjabiText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  footer: { gap: spacing.xs },
  title: { ...typography.body, fontSize: 16, fontWeight: '700', color: colors.text },
  note: { ...typography.caption, fontSize: 11, color: colors.subtext },
  accentBar: { width: 28, height: 3, borderRadius: 2, marginTop: 2 },
});
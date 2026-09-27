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
      <Text style={styles.emoji}>{mood.emoji}</Text>
      <View style={styles.footer}>
        <Text style={styles.title} numberOfLines={1}>
          {mood.title}
        </Text>
        {/* Accent bar — har mood ka apna rang */}
        <View style={[styles.accentBar, { backgroundColor: accent }]} />
      </View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minHeight: 104,
    backgroundColor: colors.card,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    justifyContent: 'space-between',
  },
  emoji: { fontSize: 26 },
  footer: { gap: spacing.sm },
  title: { ...typography.h2, color: colors.text },
  accentBar: { width: 28, height: 3, borderRadius: 2 },
});
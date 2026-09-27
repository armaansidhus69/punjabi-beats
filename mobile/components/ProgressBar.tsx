/**
 * ProgressBar — seek bar. Dependency-free (react-native ka PanResponder),
 * isliye koi extra install nahi chahiye.
 *
 * `onSeek` diya jaaye tabhi interactive hota hai — MiniPlayer read-only
 * variant (variant="mini") use karta hai, full player drag-to-seek (FR-2.5).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { spacing } from '../constants/spacing';
import { formatDuration, progressRatio } from '../utils/format';

interface ProgressBarProps {
  /** ms */
  position: number;
  /** ms */
  duration: number;
  /** diya jaaye to drag/tap se seek enabled */
  onSeek?: (positionMs: number) => void;
  variant?: 'mini' | 'full';
  /** full variant me neeche current/total time dikhao */
  showTimes?: boolean;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function ratioFromX(locationX: number, width: number): number {
  if (width <= 0) return 0;
  return clamp01(locationX / width);
}

export default function ProgressBar({
  position,
  duration,
  onSeek,
  variant = 'full',
  showTimes = false,
}: ProgressBarProps) {
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const widthRef = useRef(0);
  const durationRef = useRef(duration);
  const seekRef = useRef(onSeek);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  useEffect(() => {
    seekRef.current = onSeek;
  }, [onSeek]);

  // PanResponder ek hi baar bane (refs se latest values milte hain)
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => seekRef.current !== undefined,
        onMoveShouldSetPanResponder: () => seekRef.current !== undefined,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: event =>
          setDragRatio(ratioFromX(event.nativeEvent.locationX, widthRef.current)),
        onPanResponderMove: event =>
          setDragRatio(ratioFromX(event.nativeEvent.locationX, widthRef.current)),
        onPanResponderRelease: event => {
          const ratio = ratioFromX(event.nativeEvent.locationX, widthRef.current);
          setDragRatio(null);
          seekRef.current?.(Math.round(ratio * durationRef.current));
        },
        onPanResponderTerminate: () => setDragRatio(null),
      }),
    [],
  );

  const interactive = onSeek !== undefined;
  const isMini = variant === 'mini';
  const ratio = dragRatio ?? progressRatio(position, duration);
  // Drag ke dauraan thumb ke position ka time dikhao (store value stale lagti hai)
  const shownPosition = dragRatio === null ? position : Math.round(dragRatio * duration);

  return (
    <View>
      <View
        style={[styles.hitArea, isMini && styles.hitAreaMini]}
        onLayout={event => {
          widthRef.current = event.nativeEvent.layout.width;
        }}
        {...panResponder.panHandlers}
        accessibilityRole={interactive ? 'adjustable' : 'progressbar'}
        accessibilityValue={{ min: 0, max: Math.round(duration), now: Math.round(position) }}
      >
        <View style={[styles.track, isMini && styles.trackMini]}>
          <View style={[styles.fill, { width: `${ratio * 100}%` }]} />
        </View>
        {interactive && !isMini ? (
          <View style={[styles.knob, { left: `${ratio * 100}%` }]} />
        ) : null}
      </View>
      {showTimes ? (
        <View style={styles.times}>
          <Text style={styles.time}>{formatDuration(shownPosition)}</Text>
          <Text style={styles.time}>{formatDuration(duration)}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hitArea: { height: 28, justifyContent: 'center' },
  hitAreaMini: { height: 10 },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: 'hidden' },
  trackMini: { height: 2, borderRadius: 1 },
  fill: { height: '100%', backgroundColor: colors.primary },
  knob: {
    position: 'absolute',
    top: 8,
    width: 12,
    height: 12,
    borderRadius: 6,
    marginLeft: -6,
    backgroundColor: colors.primary,
  },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  time: { ...typography.caption, color: colors.subtext },
});

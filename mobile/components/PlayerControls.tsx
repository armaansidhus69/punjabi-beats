/**
 * PlayerControls — play/pause/next/prev (+ full variant me shuffle/repeat).
 * Mini variant (PROMPT: mini player) sirf play/pause + next dikhata hai.
 */
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/colors';
import { spacing } from '../constants/spacing';
import { successFeedback, tapFeedback } from '../utils/haptics';

interface PlayerControlsProps {
  isPlaying: boolean;
  onPlayPause: () => void;
  onNext: () => void;
  /** full variant me previous button (optional) */
  onPrev?: () => void;
  variant?: 'mini' | 'full';
  shuffleOn?: boolean;
  repeatOn?: boolean;
  /** diya jaaye tabhi shuffle button render hota hai */
  onToggleShuffle?: () => void;
  /** diya jaaye tabhi repeat button render hota hai */
  onToggleRepeat?: () => void;
  disabled?: boolean;
}

interface ControlIconProps {
  icon: keyof typeof Ionicons.glyphMap;
  size: number;
  onPress: () => void;
  label: string;
  active?: boolean;
  disabled?: boolean;
}

function ControlIcon({ icon, size, onPress, label, active, disabled }: ControlIconProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled === true, selected: active === true }}
      style={({ pressed }) => [pressed && styles.pressed, disabled === true && styles.disabled]}
    >
      <Ionicons name={icon} size={size} color={active ? colors.primary : colors.text} />
    </Pressable>
  );
}

export default function PlayerControls({
  isPlaying,
  onPlayPause,
  onNext,
  onPrev,
  variant = 'full',
  shuffleOn = false,
  repeatOn = false,
  onToggleShuffle,
  onToggleRepeat,
  disabled = false,
}: PlayerControlsProps) {
  const isMini = variant === 'mini';
  const mainSize = isMini ? 34 : 64;
  const mainIconSize = isMini ? 18 : 28;

  const handleMode = (toggle: () => void) => () => {
    successFeedback();
    toggle();
  };

  return (
    <View style={[styles.row, isMini && styles.rowMini]}>
      {!isMini && onToggleShuffle ? (
        <ControlIcon
          icon="shuffle"
          size={22}
          label="Shuffle toggle"
          active={shuffleOn}
          onPress={handleMode(onToggleShuffle)}
          disabled={disabled}
        />
      ) : null}

      {!isMini && onPrev ? (
        <ControlIcon
          icon="play-skip-back"
          size={30}
          label="Previous song"
          onPress={() => {
            tapFeedback();
            onPrev();
          }}
          disabled={disabled}
        />
      ) : null}

      <Pressable
        onPress={() => {
          tapFeedback();
          onPlayPause();
        }}
        disabled={disabled}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
        style={({ pressed }) => [
          styles.mainButton,
          { width: mainSize, height: mainSize, borderRadius: mainSize / 2 },
          pressed && styles.pressed,
          disabled && styles.disabled,
        ]}
      >
        <Ionicons
          name={isPlaying ? 'pause' : 'play'}
          size={mainIconSize}
          color={colors.background}
        />
      </Pressable>

      <ControlIcon
        icon="play-skip-forward"
        size={isMini ? 18 : 30}
        label="Next song"
        onPress={() => {
          tapFeedback();
          onNext();
        }}
        disabled={disabled}
      />

      {!isMini && onToggleRepeat ? (
        <ControlIcon
          icon="repeat"
          size={22}
          label="Repeat toggle"
          active={repeatOn}
          onPress={handleMode(onToggleRepeat)}
          disabled={disabled}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
  },
  rowMini: { gap: spacing.md },
  mainButton: {
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.35 },
});

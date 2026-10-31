import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

interface TrackSleeveArtProps {
  title?: string;
  artist?: string;
  colors?: [string, string, string];
  isPlaying?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export default function TrackSleeveArt({
  title = 'Live Jam Room',
  artist = 'Punjabi Beats',
  colors = ['#7C3AED', '#EC4899', '#06B6D4'],
  isPlaying = false,
  size = 'md',
}: TrackSleeveArtProps) {
  const spinValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let animation: Animated.CompositeAnimation | null = null;
    if (isPlaying) {
      animation = Animated.loop(
        Animated.timing(spinValue, {
          toValue: 1,
          duration: 7000,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );
      animation.start();
    } else {
      spinValue.stopAnimation();
    }

    return () => {
      animation?.stop();
    };
  }, [isPlaying, spinValue]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const discSize = size === 'sm' ? 48 : size === 'md' ? 84 : 140;
  const centerSize = discSize * 0.38;

  return (
    <View style={styles.container}>
      {/* Ambient background glow */}
      <View
        style={[
          styles.glow,
          {
            backgroundColor: colors[0],
            width: discSize + 16,
            height: discSize + 16,
            borderRadius: (discSize + 16) / 2,
          },
        ]}
      />

      {/* Vinyl Disc */}
      <Animated.View
        style={[
          styles.vinyl,
          {
            width: discSize,
            height: discSize,
            borderRadius: discSize / 2,
            transform: [{ rotate: spin }],
          },
        ]}
      >
        {/* Grooves ring 1 */}
        <View
          style={[
            styles.groove,
            {
              width: discSize * 0.82,
              height: discSize * 0.82,
              borderRadius: (discSize * 0.82) / 2,
            },
          ]}
        />
        {/* Grooves ring 2 */}
        <View
          style={[
            styles.groove,
            {
              width: discSize * 0.6,
              height: discSize * 0.6,
              borderRadius: (discSize * 0.6) / 2,
            },
          ]}
        />

        {/* Center colorful label */}
        <View
          style={[
            styles.centerLabel,
            {
              width: centerSize,
              height: centerSize,
              borderRadius: centerSize / 2,
              backgroundColor: colors[1],
            },
          ]}
        >
          {/* Spindle hole */}
          <View style={styles.spindleHole} />
        </View>
      </Animated.View>

      {size !== 'sm' && (
        <View style={styles.meta}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.artist} numberOfLines={1}>
            {artist}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  artist: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 1,
  },
  centerLabel: {
    alignItems: 'center',
    borderColor: 'rgba(255, 255, 255, 0.4)',
    borderWidth: 1.5,
    justifyContent: 'center',
    position: 'absolute',
  },
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  glow: {
    opacity: 0.25,
    position: 'absolute',
  },
  groove: {
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    position: 'absolute',
  },
  meta: {
    alignItems: 'center',
    marginTop: 8,
  },
  spindleHole: {
    backgroundColor: '#0A0A0F',
    borderColor: 'rgba(255, 255, 255, 0.5)',
    borderRadius: 4,
    borderWidth: 1,
    height: 8,
    width: 8,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
  },
  vinyl: {
    alignItems: 'center',
    backgroundColor: '#0F1117',
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderWidth: 2,
    justifyContent: 'center',
    position: 'relative',
  },
});


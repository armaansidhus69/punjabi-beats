import React, { useCallback, useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { getAudio, JAM_PADS, type Voice } from '../core/room/jamAudio';
import { tapFeedback } from '../utils/haptics';

interface JamPadsProps {
  onPadTrigger?: (voice: Voice, midi: number) => void;
}

export default function JamPads({ onPadTrigger }: JamPadsProps) {
  const [activeVoice, setActiveVoice] = useState<string | null>(null);
  const [recentHits, setRecentHits] = useState<{ id: string; voice: string; label: string }[]>([]);

  const handleHit = useCallback(
    (voice: Voice, midi: number, label: string) => {
      tapFeedback();
      setActiveVoice(voice);
      setTimeout(() => setActiveVoice((prev) => (prev === voice ? null : prev)), 140);

      try {
        getAudio().previewPad(voice, midi);
      } catch {
        /* safe on environments without Web Audio */
      }

      setRecentHits((prev) => [
        { id: `${Date.now()}-${Math.random()}`, voice, label },
        ...prev.slice(0, 4),
      ]);

      onPadTrigger?.(voice, midi);
    },
    [onPadTrigger]
  );

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;

      const matched = JAM_PADS.find((p) => p.hint.toLowerCase() === e.key.toLowerCase());
      if (matched) {
        e.preventDefault();
        handleHit(matched.voice, matched.midi, matched.label);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleHit]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>🥁 Live Jam Pads</Text>
          <Text style={styles.subtitle}>
            Tap pads or use keys {Platform.OS === 'web' ? '(Q, W, E, R, A, S, D, F, Z, X)' : ''} to jam over the music
          </Text>
        </View>
      </View>

      <View style={styles.grid}>
        {JAM_PADS.map((pad) => {
          const isActive = activeVoice === pad.voice;
          return (
            <Pressable
              key={pad.voice}
              style={[
                styles.pad,
                { backgroundColor: pad.color + (isActive ? 'EE' : '33') },
                isActive && styles.padActive,
              ]}
              onPress={() => handleHit(pad.voice, pad.midi, pad.label)}
            >
              <Text style={styles.padLabel}>{pad.label}</Text>
              <View style={styles.hintBadge}>
                <Text style={styles.hintText}>{pad.hint}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {recentHits.length > 0 && (
        <View style={styles.hitsRow}>
          <Text style={styles.hitsTitle}>Recent hits:</Text>
          {recentHits.map((hit) => (
            <View key={hit.id} style={styles.hitPill}>
              <Text style={styles.hitPillText}>{hit.label}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 16,
    borderWidth: 1,
    marginVertical: 12,
    padding: 14,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  hintBadge: {
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    borderRadius: 4,
    bottom: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    position: 'absolute',
    right: 4,
  },
  hintText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 9,
    fontWeight: 'bold',
  },
  hitPill: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  hitPillText: {
    color: '#E2E8F0',
    fontSize: 11,
    fontWeight: '500',
  },
  hitsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  hitsTitle: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
    marginRight: 4,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
  },
  pad: {
    alignItems: 'center',
    borderColor: 'rgba(255, 255, 255, 0.18)',
    borderRadius: 10,
    borderWidth: 1,
    height: 52,
    justifyContent: 'center',
    position: 'relative',
    width: '18%',
  },
  padActive: {
    borderColor: '#FFFFFF',
    borderWidth: 2,
    transform: [{ scale: 0.96 }],
  },
  padLabel: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 2,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: 'bold',
  },
});


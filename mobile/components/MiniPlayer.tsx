/**
 * MiniPlayer — har screen pe dikhne wala chhota player (FR-6.1..FR-6.3).
 *
 * Usage: screen ke root container (flex: 1) ke andar render karo —
 *  - tab screens:   <MiniPlayer bottomOffset={TAB_BAR_HEIGHT} />
 *  - pushed screens (mood/playlist/room): <MiniPlayer /> (bottomOffset 0)
 *    bottomOffset 0 hone pe safe-area bottom inset automatically add hota hai.
 * Current song na ho to kuch render nahi karta.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../stores/playerStore';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { spacing } from '../constants/spacing';
import { MINI_PLAYER_HEIGHT } from '../constants/layout';
import { tapFeedback } from '../utils/haptics';
import SongArtwork from './SongArtwork';
import ProgressBar from './ProgressBar';
import PlayerControls from './PlayerControls';

interface MiniPlayerProps {
  /** neeche se kitna upar baithe (tab bar ke upar ke liye TAB_BAR_HEIGHT do) */
  bottomOffset?: number;
}

export default function MiniPlayer({ bottomOffset = 0 }: MiniPlayerProps) {
  const insets = useSafeAreaInsets();
  const currentSong = usePlayer(s => s.currentSong);
  const isPlaying = usePlayer(s => s.isPlaying);
  const position = usePlayer(s => s.position);
  const duration = usePlayer(s => s.duration);
  const togglePlay = usePlayer(s => s.togglePlay);
  const playNext = usePlayer(s => s.playNext);

  if (!currentSong) return null;

  // Tab bar na hone pe (bottomOffset 0) safe-area inset khud handle karo
  const bottomPad = bottomOffset === 0 ? insets.bottom : 0;
  const effectiveBottom = bottomOffset > 0 ? bottomOffset + 6 : 6 + bottomPad;
  const effectiveDuration = currentSong.previewOnly && duration <= 30000 ? 161000 : duration;

  return (
    <View style={[styles.container, { bottom: effectiveBottom }]}>
      {/* Thin progress bar top pe (non-interactive) */}
      <View style={styles.progress} pointerEvents="none">
        <ProgressBar position={position} duration={effectiveDuration} variant="mini" />
      </View>

      <View style={styles.row}>
        <Pressable
          style={styles.tapArea}
          onPress={() => {
            tapFeedback();
            router.push('/player');
          }}
          accessibilityRole="button"
          accessibilityLabel="Poora player kholo"
        >
          <SongArtwork uri={currentSong.cover} size={46} radius={10} />
          <View style={styles.info}>
            <Text style={styles.title} numberOfLines={1}>
              {currentSong.title}
            </Text>
            <Text style={styles.artist} numberOfLines={1}>
              {currentSong.artist}
            </Text>
          </View>
        </Pressable>

        <PlayerControls
          variant="mini"
          isPlaying={isPlaying}
          onPlayPause={togglePlay}
          onNext={playNext}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    backgroundColor: 'rgba(25, 25, 39, 0.97)',
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 65, 108, 0.30)',
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 8,
  },
  progress: { position: 'absolute', top: -5, left: 0, right: 0 },
  row: {
    height: MINI_PLAYER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  tapArea: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  info: { flex: 1 },
  title: { ...typography.body, color: colors.text, fontWeight: '600' },
  artist: { ...typography.caption, color: colors.subtext },
});

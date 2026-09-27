/**
 * useMiniPlayerPadding — list/screen ke bottom padding me MiniPlayer ki height
 * jodta hai (warna aakhri song mini player ke neeche chhup jaata hai).
 *
 * MiniPlayer root layout me tab bar ke upar (absolute) mount hai, isliye tab
 * screens ki FlatList ko extra bottom padding chahiye jab song chal raha ho.
 */
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing } from '../constants/spacing';
import { MINI_PLAYER_HEIGHT } from '../constants/layout';
import { usePlayer } from '../stores/playerStore';

/**
 * @param base base bottom padding (default: spacing.lg)
 * @returns paddingBottom (px) — MiniPlayer visible ho to badha hua
 */
export function useMiniPlayerPadding(base: number = spacing.lg): number {
  const insets = useSafeAreaInsets();
  const hasSong = usePlayer(s => s.currentSong !== null);
  if (!hasSong) return base;
  return base + MINI_PLAYER_HEIGHT + insets.bottom + spacing.md;
}

export { MINI_PLAYER_HEIGHT };


/**
 * Layout constants — repeated paddings/heights ek jagah.
 * TAB_BAR_HEIGHT (tabs)/_layout.tsx aur MiniPlayer dono use karte hain, isliye
 * value ek hi jagah honi chahiye warna mini player tab bar se overlap karega.
 */
import { spacing } from './spacing';

/** Bottom tab bar ki total height (tabs/_layout.tsx se match karta hai) */
export const TAB_BAR_HEIGHT = 58 + spacing.md;

/** Mini player ki row height (PROMPT spec: 60px) */
export const MINI_PLAYER_HEIGHT = 60;

/** Screen content ka extra bottom padding jab mini player visible ho */
export const MINI_PLAYER_BOTTOM_INSET = MINI_PLAYER_HEIGHT + spacing.sm;

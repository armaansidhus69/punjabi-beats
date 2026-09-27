/**
 * Typography scale (per PROMPT.md): 28 h1 / 18 h2 / 14 body / 12 caption.
 * System font, headings 700 weight.
 */
import { TextStyle } from 'react-native';

export const typography = {
  h1: { fontSize: 28, fontWeight: '700' } as TextStyle,
  h2: { fontSize: 18, fontWeight: '700' } as TextStyle,
  body: { fontSize: 14, fontWeight: '400' } as TextStyle,
  caption: { fontSize: 12, fontWeight: '400' } as TextStyle,
} as const;

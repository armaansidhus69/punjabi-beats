/**
 * React Native Paper (MD3) dark theme — hamare custom colors ke saath mapped.
 * Root layout isse PaperProvider ko deta hai.
 */
import { MD3DarkTheme, configureFonts } from 'react-native-paper';
import { colors } from './colors';

export const paperTheme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: colors.primary,
    background: colors.background,
    surface: colors.surface,
    surfaceVariant: colors.card,
    outline: colors.border,
    onSurface: colors.text,
    onSurfaceVariant: colors.subtext,
    onPrimary: '#FFFFFF',
    elevation: {
      ...MD3DarkTheme.colors.elevation,
      level2: colors.card,
    },
  },
  fonts: configureFonts({ config: { fontFamily: 'System' } }),
};

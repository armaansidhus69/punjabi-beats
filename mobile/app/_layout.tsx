/**
 * Root layout — providers (SafeArea, Paper) + toast + dark background.
 * Expo Router file-based navigation ka entry point.
 *
 * ErrorBoundary export: kisi bhi screen pe uncaught JS error aaye to expo-router
 * humein { error, retry } deta hai aur hum friendly screen render karte hain.
 *
 * Room sync (Phase 11): `initRoomSync()` yahan ek baar chalta hai — player action
 * + room lifecycle listeners register ho jaate hain. Missing env pe ye silently
 * skip hota hai (app crash nahi hota), sirf ek warning log hota hai.
 */
import { useEffect } from 'react';
import { ErrorBoundaryProps, Stack, useSegments } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Provider as PaperProvider } from 'react-native-paper';
import Toast from 'react-native-toast-message';
import { paperTheme } from '../constants/theme';
import { colors } from '../constants/colors';
import { TAB_BAR_HEIGHT } from '../constants/layout';
import AppErrorBoundary from '../components/ErrorBoundary';
import MiniPlayer from '../components/MiniPlayer';
import AddToPlaylistSheet from '../components/AddToPlaylistSheet';
import { initRoomSync } from '../services/roomSync';
import { disposePlayer } from '../stores/playerStore';

export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <AppErrorBoundary {...props} />;
}

/**
 * AppShell — Stack + ek hi jagah mount hua MiniPlayer (FR-6.1..FR-6.3).
 * MiniPlayer absolute hai; tab screens pe tab bar ke upar, pushed screens
 * (mood/playlist/room) pe bottom pe (safe-area inset khud handle karta hai).
 * Full player modal khula ho to mini player hide ho jaata hai.
 */
function AppShell() {
  const segments = useSegments();
  const topRoute: string | undefined = segments[0];
  const isTabScreen = topRoute === '(tabs)';
  const isFullPlayerOpen = topRoute === 'player';

  return (
    <View style={styles.root}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" />
        {/* Full player modal (Phase 8) — neeche se slide hokar aata hai */}
        <Stack.Screen
          name="player"
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
      </Stack>

      {isFullPlayerOpen ? null : (
        <MiniPlayer bottomOffset={isTabScreen ? TAB_BAR_HEIGHT : 0} />
      )}

      {/* Add-to-playlist bottom sheet — ek hi instance, sabhi screens ke '+' ke liye (Phase 9) */}
      <AddToPlaylistSheet />
    </View>
  );
}

export default function RootLayout() {
  // Room sync (Phase 11) — ek hi baar init: player action + room lifecycle
  // listeners + socket state listener register. Idempotent aur missing-env par
  // non-crashing (warning + failed state).
  useEffect(() => {
    initRoomSync();
    // Unmount/dev-teardown pe audio cleanup — pending load cancel + active
    // Sound unload (double-play + iOS Sound leak dono se bachav)
    return () => {
      void disposePlayer();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <PaperProvider theme={paperTheme}>
        <StatusBar style="light" />
        <AppShell />
        <Toast />
      </PaperProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
});

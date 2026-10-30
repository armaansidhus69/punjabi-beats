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
import { Platform, StyleSheet, View } from 'react-native';
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
import { hydrateDeadMirrorCache } from '../services/musicApi';
import TrackPlayer from 'react-native-track-player';
import { playbackService } from '../services/playbackService';
import { useLikedSongs } from '../stores/likedSongsStore';
import { initializeCore } from '../core/bootstrap';
import { initializeMedia } from '../core/media/mediaFacade';
import { useAuthStore } from '../stores/authStore';
import { handleInitialOAuthCallback } from '../core/auth/authService';
import usePodcastProgressWriter from '../hooks/usePodcastProgress';

TrackPlayer.registerPlaybackService(() => playbackService);

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
  const isFullPlayerOpen = topRoute === 'player' || topRoute === 'lyrics';

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
        {/* Lyrics player-extension modal (Phase 7a) — player ke upar khulta */}
        <Stack.Screen
          name="lyrics"
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
  // Podcast progress writer (Phase 12a) — global mount; flag off pe zero-op
  usePodcastProgressWriter();

  // Room sync (Phase 11) — ek hi baar init: player action + room lifecycle
  // listeners + socket state listener register. Idempotent aur missing-env par
  // non-crashing (warning + failed state).
  useEffect(() => {
    void initializeCore()
      .then(() => handleInitialOAuthCallback())
      .then(() => useAuthStore.getState().initialize())
      .catch(error => console.warn('[auth] initial OAuth callback failed:', error));
    initRoomSync();
    // Dead JioSaavn mirrors AsyncStorage se preload karo — warna pehli search
    // app launch pe ~5s wait karti (5 dead mirrors × 2 paths × timeout).
    void hydrateDeadMirrorCache();
    void useLikedSongs.getState().load();
    if (Platform.OS !== 'web') {
      void initializeMedia().catch(err => console.warn('TrackPlayer setup failed:', err));
    }
    return () => useAuthStore.getState().dispose();
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

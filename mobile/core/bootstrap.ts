import { configureAnalytics } from './analytics/analytics';
import { getOrCreateDeviceIdentity, getOrCreateGuestIdentity } from './auth/identity';
import { initializeAuthSession } from './auth/authService';
import { ensureGuestSession } from './auth/sessionManager';
import { runLocalMigrations } from './database/migrations';
import { configureErrorReporting } from './errors/errorReporting';
import { initializeDeepLinkRouter } from './navigation/deepLinkRouter';
import { initializeNotifications } from './notifications/notificationManager';
import { initializeFeatureFlags } from './featureflags/featureFlags';

/**
 * Phase 0 bootstrap is deliberately best-effort. A foundation service must not
 * prevent the existing player or guest UI from starting.
 */
export async function initializeCore(): Promise<void> {
  const steps: [string, () => Promise<void> | void][] = [
    ['feature flags', initializeFeatureFlags],
    ['local migrations', runLocalMigrations],
    ['guest identity', async () => {
      await getOrCreateGuestIdentity();
      await getOrCreateDeviceIdentity();
    }],
    ['guest session', async () => {
      await ensureGuestSession();
    }],
    ['supabase auth session', initializeAuthSession],
    ['deep links', initializeDeepLinkRouter],
    ['notifications', initializeNotifications],
    ['analytics', () => configureAnalytics({ enabled: false })],
    ['error reporting', () => configureErrorReporting(null)],
  ];

  for (const [name, step] of steps) {
    try {
      await step();
    } catch (error) {
      console.warn(`[core/bootstrap] ${name} initialization failed:`, error);
    }
  }
}

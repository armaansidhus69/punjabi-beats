export type NotificationPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';

let initialized = false;

export function initializeNotifications(): void {
  initialized = true;
}

export function isNotificationsInitialized(): boolean {
  return initialized;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  // Push provider integration belongs to the account/notification phases.
  return 'unavailable';
}

export function openNotificationSettings(): void {
  // Native settings integration will be added with the notification provider.
}

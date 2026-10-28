import * as Linking from 'expo-linking';

export interface AppDeepLink {
  path: string;
  queryParams: Record<string, string | string[] | undefined>;
}

export function parseAppDeepLink(url: string): AppDeepLink | null {
  try {
    const parsed = Linking.parse(url);
    return {
      path: parsed.path ?? '',
      queryParams: parsed.queryParams ?? {},
    };
  } catch (error) {
    console.warn('[core/navigation] deep link parse failed:', error);
    return null;
  }
}

export function initializeDeepLinkRouter(): void {
  // Route-specific handling stays with Expo Router until canonical server links exist.
}

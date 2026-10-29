export const FEATURE_FLAG_NAMES = [
  'auth_enabled',
  'catalog_enabled',
  'social_share_enabled',
  'chat_enabled',
  'blend_enabled',
  'jam_enabled',
  'podcasts_enabled',
  'lyrics_enabled',
  'downloads_enabled',
  'ai_playlist_enabled',
  'premium_enabled',
  'events_enabled',
] as const;

export type FeatureFlagName = (typeof FEATURE_FLAG_NAMES)[number];
export type FeatureFlags = Record<FeatureFlagName, boolean>;

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  auth_enabled: false,
  catalog_enabled: false,
  social_share_enabled: false,
  chat_enabled: false,
  blend_enabled: false,
  jam_enabled: false,
  podcasts_enabled: false,
  lyrics_enabled: false,
  downloads_enabled: false,
  ai_playlist_enabled: false,
  premium_enabled: false,
  events_enabled: false,
};

let currentFlags: FeatureFlags = {
  ...DEFAULT_FEATURE_FLAGS,
  auth_enabled: process.env.EXPO_PUBLIC_AUTH_ENABLED === 'true',
};

export function initializeFeatureFlags(): void {
  // Internal/beta opt-in only. Production defaults remain disabled unless the
  // app bundle explicitly enables a feature for a controlled build.
  if (process.env.EXPO_PUBLIC_AUTH_ENABLED === 'true') {
    currentFlags = { ...currentFlags, auth_enabled: true };
  }
  if (process.env.EXPO_PUBLIC_BLEND_ENABLED === 'true') {
    currentFlags = { ...currentFlags, blend_enabled: true };
  }
  if (process.env.EXPO_PUBLIC_JAM_ENABLED === 'true') {
    currentFlags = { ...currentFlags, jam_enabled: true };
  }
  if (process.env.EXPO_PUBLIC_PODCASTS_ENABLED === 'true') {
    currentFlags = { ...currentFlags, podcasts_enabled: true };
  }
}

export function isFeatureEnabled(flag: FeatureFlagName): boolean {
  return currentFlags[flag];
}

export function getFeatureFlags(): FeatureFlags {
  return { ...currentFlags };
}

/** Internal/beta harness only; production defaults remain disabled. */
export function setFeatureFlag(flag: FeatureFlagName, enabled: boolean): void {
  currentFlags = { ...currentFlags, [flag]: enabled };
}

export function resetFeatureFlags(): void {
  currentFlags = { ...DEFAULT_FEATURE_FLAGS };
}

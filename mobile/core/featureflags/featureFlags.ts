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
  'ai_assistant_enabled',
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
  ai_assistant_enabled: false,
  events_enabled: false,
};

export function resolveFlagsFromEnv(): FeatureFlags {
  return {
    ...DEFAULT_FEATURE_FLAGS,
    auth_enabled: process.env.EXPO_PUBLIC_AUTH_ENABLED === 'true',
    catalog_enabled: process.env.EXPO_PUBLIC_CATALOG_ENABLED === 'true',
    social_share_enabled: process.env.EXPO_PUBLIC_SOCIAL_SHARE_ENABLED === 'true',
    chat_enabled: process.env.EXPO_PUBLIC_CHAT_ENABLED === 'true',
    blend_enabled: process.env.EXPO_PUBLIC_BLEND_ENABLED === 'true',
    jam_enabled: process.env.EXPO_PUBLIC_JAM_ENABLED === 'true',
    podcasts_enabled: process.env.EXPO_PUBLIC_PODCASTS_ENABLED === 'true',
    lyrics_enabled: process.env.EXPO_PUBLIC_LYRICS_ENABLED === 'true',
    downloads_enabled: process.env.EXPO_PUBLIC_DOWNLOADS_ENABLED === 'true',
    ai_playlist_enabled: process.env.EXPO_PUBLIC_AI_PLAYLIST_ENABLED === 'true',
    ai_assistant_enabled: process.env.EXPO_PUBLIC_AI_ASSISTANT_ENABLED === 'true',
    // NOTE: premium/payments flag deliberately NAHI hai — app free-forever hai
    // (user decision, ROADMAP.md Phase 14). Koi entitlement/billing code nahi.
    events_enabled: process.env.EXPO_PUBLIC_EVENTS_ENABLED === 'true',
  };
}

let currentFlags: FeatureFlags = resolveFlagsFromEnv();

export function initializeFeatureFlags(): void {
  // Internal/beta opt-in only. Production defaults remain disabled unless the
  // app bundle explicitly enables a feature for a controlled build.
  currentFlags = resolveFlagsFromEnv();
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

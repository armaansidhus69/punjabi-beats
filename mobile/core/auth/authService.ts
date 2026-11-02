import { Platform } from 'react-native';
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import { makeRedirectUri } from 'expo-auth-session';
import { getQueryParams } from 'expo-auth-session/build/QueryParams';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { getOrCreateDeviceIdentity } from './identity';
import { saveAccountIdentity, restoreGuestIdentity } from './identity';
import { restoreGuestSession, saveAuthenticatedSession } from './sessionManager';
import { isSupabaseConfigured, supabase } from './supabaseClient';
import { isFeatureEnabled } from '../featureflags/featureFlags';

export type AuthErrorCode =
  | 'not_configured'
  | 'invalid_credentials'
  | 'email_not_verified'
  | 'email_in_use'
  | 'weak_password'
  | 'invalid_email'
  | 'network'
  | 'not_authenticated'
  | 'profile_unavailable'
  | 'oauth_cancelled'
  | 'oauth_failed'
  | 'unknown';

export class AuthServiceError extends Error {
  readonly code: AuthErrorCode;
  readonly cause?: unknown;

  constructor(code: AuthErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'AuthServiceError';
    this.code = code;
    this.cause = cause;
  }
}

export interface AuthProfile {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  country: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface UpdateProfileInput {
  display_name?: string;
  username?: string | null;
  avatar_url?: string | null;
  country?: string | null;
}

export interface AuthResult {
  user: User | null;
  session: Session | null;
  needsEmailVerification: boolean;
}

export type AuthStateListener = (session: Session | null, event?: AuthChangeEvent) => void;

WebBrowser.maybeCompleteAuthSession();

function requireClient() {
  if (!supabase) {
    throw new AuthServiceError(
      'not_configured',
      'Supabase is not configured. The app is continuing in guest mode.',
    );
  }
  return supabase;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function getGoogleRedirectUrl(): string {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.location?.origin) {
      return `${window.location.origin}/auth/login`;
    }
    return 'https://punjabi-beats.expo.app/auth/login';
  }
  return makeRedirectUri({
    scheme: 'punjabi-beats',
    path: 'auth/callback',
  });
}

function mapError(error: unknown): AuthServiceError {
  if (error instanceof AuthServiceError) return error;

  const candidate = error as { message?: unknown; status?: unknown; code?: unknown } | null;
  const message = typeof candidate?.message === 'string' ? candidate.message : 'Authentication failed';
  const normalized = message.toLowerCase();

  let code: AuthErrorCode = 'unknown';
  if (normalized.includes('invalid login credentials') || normalized.includes('invalid credentials')) {
    code = 'invalid_credentials';
  } else if (normalized.includes('email not confirmed') || normalized.includes('not verified')) {
    code = 'email_not_verified';
  } else if (normalized.includes('already registered') || normalized.includes('already exists')) {
    code = 'email_in_use';
  } else if (normalized.includes('password') && normalized.includes('at least')) {
    code = 'weak_password';
  } else if (normalized.includes('email') && normalized.includes('invalid')) {
    code = 'invalid_email';
  } else if (
    normalized.includes('network') ||
    normalized.includes('fetch') ||
    normalized.includes('timeout')
  ) {
    code = 'network';
  }

  return new AuthServiceError(code, message, error);
}

function getDisplayName(user: User, profile?: AuthProfile | null): string {
  return (
    profile?.display_name?.trim() ||
    (typeof user.user_metadata?.display_name === 'string'
      ? user.user_metadata.display_name.trim()
      : '') ||
    user.email?.split('@')[0] ||
    'User'
  );
}

async function syncAppSession(session: Session | null): Promise<void> {
  if (session?.user) {
    const profile = await getProfile(session.user.id).catch(() => null);
    await saveAccountIdentity({
      userId: session.user.id,
      email: session.user.email,
      displayName: getDisplayName(session.user, profile),
      avatarUrl: profile?.avatar_url,
      createdAt: new Date(session.user.created_at).getTime(),
    });
    await saveAuthenticatedSession(session.user.id);
    await registerCurrentDevice(session.user.id).catch(error => {
      console.warn('[auth] device registration failed:', error);
    });
    return;
  }

  await restoreGuestIdentity();
  await restoreGuestSession();
}

export function getAuthSession(): Promise<{ session: Session | null }> {
  if (!supabase) return Promise.resolve({ session: null });
  return supabase.auth
    .getSession()
    .then(({ data, error }) => {
      if (error) throw mapError(error);
      return { session: data.session };
    })
    .catch(error => {
      throw mapError(error);
    });
}

export async function getCurrentUser(): Promise<User | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data.user;
  } catch {
    return null;
  }
}

export function subscribeToAuthState(listener: AuthStateListener): () => void {
  if (!supabase) return () => undefined;

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, session) => {
    listener(session, event);
    void syncAppSession(session).catch(error => {
      console.warn('[auth] app session synchronization failed:', error);
    });
  });

  return () => subscription.unsubscribe();
}

export async function registerWithPassword(
  email: string,
  password: string,
  displayName?: string,
): Promise<AuthResult> {
  const client = requireClient();
  try {
    const { data, error } = await client.auth.signUp({
      email: normalizeEmail(email),
      password,
      options: {
        data: displayName?.trim() ? { display_name: displayName.trim() } : undefined,
      },
    });
    if (error) throw error;
    await syncAppSession(data.session);
    return {
      user: data.user,
      session: data.session,
      needsEmailVerification: Boolean(data.user && !data.session),
    };
  } catch (error) {
    throw mapError(error);
  }
}

export async function signInWithPassword(email: string, password: string): Promise<AuthResult> {
  const client = requireClient();
  try {
    const { data, error } = await client.auth.signInWithPassword({
      email: normalizeEmail(email),
      password,
    });
    if (error) throw error;
    await syncAppSession(data.session);
    return {
      user: data.user,
      session: data.session,
      needsEmailVerification: Boolean(data.user && !data.session),
    };
  } catch (error) {
    throw mapError(error);
  }
}

export async function handleOAuthCallback(url: string): Promise<void> {
  const client = requireClient();
  const { errorCode, params } = getQueryParams(url);
  if (errorCode) {
    throw new AuthServiceError(
      'oauth_failed',
      params.error_description || params.error || 'Google sign-in was not completed.',
    );
  }

  try {
    if (params.code) {
      const { data, error } = await client.auth.exchangeCodeForSession(params.code);
      if (error) throw error;
      await syncAppSession(data.session);
      return;
    }

    if (params.access_token && params.refresh_token) {
      const { data, error } = await client.auth.setSession({
        access_token: params.access_token,
        refresh_token: params.refresh_token,
      });
      if (error) throw error;
      await syncAppSession(data.session);
    }
  } catch (error) {
    throw new AuthServiceError('oauth_failed', 'Google sign-in could not be completed.', error);
  }
}

export async function signInWithGoogle(): Promise<void> {
  const client = requireClient();
  const redirectTo = getGoogleRedirectUrl();
  try {
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        skipBrowserRedirect: Platform.OS !== 'web',
      },
    });
    if (error) throw error;

    if (Platform.OS !== 'web') {
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type === 'success') {
        await handleOAuthCallback(result.url);
      } else {
        throw new AuthServiceError('oauth_cancelled', 'Google sign-in was cancelled.');
      }
    }
  } catch (error) {
    if (error instanceof AuthServiceError) throw error;
    throw new AuthServiceError('oauth_failed', 'Google sign-in could not be started.', error);
  }
}

export async function handleInitialOAuthCallback(): Promise<void> {
  if (Platform.OS === 'web' || !supabase) return;
  const url = await Linking.getInitialURL();
  if (!url || (!url.includes('code=') && !url.includes('access_token='))) return;
  await handleOAuthCallback(url);
}

export async function requestPasswordReset(email: string, redirectTo?: string): Promise<void> {
  const client = requireClient();
  try {
    const { error } = await client.auth.resetPasswordForEmail(normalizeEmail(email), {
      redirectTo,
    });
    if (error) throw error;
  } catch (error) {
    throw mapError(error);
  }
}

export async function signOut(): Promise<void> {
  const client = requireClient();
  try {
    const { error } = await client.auth.signOut();
    if (error) throw error;
    await syncAppSession(null);
  } catch (error) {
    throw mapError(error);
  }
}

/**
 * Sab devices se sign out (Phase 1 completion) — scope 'global' refresh tokens
 * revoke karta hai. Profile screen "Logout all devices" button.
 */
export async function signOutEverywhere(): Promise<void> {
  const client = requireClient();
  try {
    const { error } = await client.auth.signOut({ scope: 'global' });
    if (error) throw error;
    await syncAppSession(null);
  } catch (error) {
    throw mapError(error);
  }
}

/**
 * Account deletion (Phase 1 completion) — migration 004 ka
 * request_account_deletion() RPC profile anonymize karta hai (PII null,
 * status 'deleted'); auth.users row Supabase admin panel me purge hota hai.
 * Client-side delete API auth me nahi hota — ye saaf pattern hai.
 */
export async function deleteAccount(): Promise<void> {
  const client = requireClient();
  try {
    const { error } = await client.rpc('request_account_deletion');
    if (error) throw error;
    const { error: signOutError } = await client.auth.signOut({ scope: 'global' });
    if (signOutError) throw signOutError;
    await syncAppSession(null);
  } catch (error) {
    throw mapError(error);
  }
}

export async function getProfile(userId?: string): Promise<AuthProfile | null> {
  const client = requireClient();
  const id = userId ?? (await getCurrentUser())?.id;
  if (!id) return null;

  try {
    const { data, error } = await client
      .from('profiles')
      .select('id,display_name,username,avatar_url,country,status,created_at,updated_at')
      .eq('id', id)
      .maybeSingle<AuthProfile>();
    if (error) throw error;
    return data;
  } catch (error) {
    throw new AuthServiceError('profile_unavailable', 'Profile could not be loaded.', error);
  }
}

export async function updateProfile(input: UpdateProfileInput): Promise<AuthProfile> {
  const client = requireClient();
  const user = await getCurrentUser();
  if (!user) throw new AuthServiceError('not_authenticated', 'Sign in to update your profile.');

  try {
    const { data, error } = await client
      .from('profiles')
      .upsert(
        {
          id: user.id,
          ...input,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' },
      )
      .select('id,display_name,username,avatar_url,country,status,created_at,updated_at')
      .single<AuthProfile>();
    if (error) throw error;
    await saveAccountIdentity({
      userId: user.id,
      email: user.email,
      displayName: data.display_name,
      avatarUrl: data.avatar_url,
      createdAt: new Date(user.created_at).getTime(),
    });
    return data;
  } catch (error) {
    if (error instanceof AuthServiceError) throw error;
    throw new AuthServiceError('profile_unavailable', 'Profile could not be updated.', error);
  }
}

export async function registerCurrentDevice(userId?: string): Promise<void> {
  const client = requireClient();
  const id = userId ?? (await getCurrentUser())?.id;
  if (!id) throw new AuthServiceError('not_authenticated', 'Sign in to register this device.');

  const device = await getOrCreateDeviceIdentity();
  const { error } = await client.from('devices').upsert(
    {
      device_id: device.deviceId,
      user_id: id,
      platform: Platform.OS,
      last_active_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'device_id' },
  );
  if (error) throw new AuthServiceError('profile_unavailable', 'Device could not be registered.', error);
}

export async function initializeAuthSession(): Promise<void> {
  if (!isFeatureEnabled('auth_enabled') || !isSupabaseConfigured()) {
    await restoreGuestSession();
    return;
  }
  try {
    const { session } = await getAuthSession();
    await syncAppSession(session);
  } catch (error) {
    console.warn('[auth] session restoration failed:', mapError(error));
    await restoreGuestSession();
  }
}

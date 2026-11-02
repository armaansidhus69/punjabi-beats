import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import {
  AuthServiceError,
  getAuthSession,
  getProfile,
  registerWithPassword,
  requestPasswordReset,
  signInWithGoogle,
  signInWithPassword,
  signOut,
  signOutEverywhere,
  deleteAccount as deleteAccountRequest,
  subscribeToAuthState,
  updateProfile,
} from '../core/auth/authService';
import type { AuthProfile, UpdateProfileInput } from '../core/auth/authService';
import { isFeatureEnabled } from '../core/featureflags/featureFlags';

export type AuthStoreStatus = 'loading' | 'disabled' | 'guest' | 'authenticated';

interface AuthStore {
  status: AuthStoreStatus;
  session: Session | null;
  user: User | null;
  profile: AuthProfile | null;
  error: AuthServiceError | null;
  initialized: boolean;
  initialize: () => Promise<void>;
  dispose: () => void;
  register: (email: string, password: string, displayName?: string) => Promise<boolean>;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Phase 1 completion — sab devices revoke (refresh tokens global signout) */
  logoutEverywhere: () => Promise<void>;
  /** Phase 1 completion — profile anonymize (RPC) + global signout */
  deleteAccount: () => Promise<void>;
  saveProfile: (input: UpdateProfileInput) => Promise<void>;
  clearError: () => void;
}

let unsubscribe: (() => void) | null = null;

function toAuthError(error: unknown): AuthServiceError {
  if (error instanceof AuthServiceError) return error;
  return new AuthServiceError('unknown', 'Authentication failed.', error);
}

async function loadProfileForUser(user: User | null): Promise<AuthProfile | null> {
  if (!user) return null;
  try {
    return await getProfile(user.id);
  } catch {
    return null;
  }
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  status: 'loading',
  session: null,
  user: null,
  profile: null,
  error: null,
  initialized: false,

  initialize: async () => {
    if (get().initialized) return;
    if (!isFeatureEnabled('auth_enabled')) {
      set({ status: 'disabled', initialized: true });
      return;
    }

    set({ status: 'loading', error: null });
    try {
      const { session } = await getAuthSession();
      const profile = await loadProfileForUser(session?.user ?? null);
      set({
        status: session?.user ? 'authenticated' : 'guest',
        session,
        user: session?.user ?? null,
        profile,
        initialized: true,
      });
    } catch (error) {
      set({ status: 'guest', error: toAuthError(error), initialized: true });
    }

    unsubscribe?.();
    unsubscribe = subscribeToAuthState((session) => {
      void (async () => {
        const profile = await loadProfileForUser(session?.user ?? null);
        set({
          status: session?.user ? 'authenticated' : 'guest',
          session,
          user: session?.user ?? null,
          profile,
          error: null,
          initialized: true,
        });
      })();
    });
  },

  dispose: () => {
    unsubscribe?.();
    unsubscribe = null;
  },

  register: async (email, password, displayName) => {
    set({ error: null });
    try {
      const result = await registerWithPassword(email, password, displayName);
      const profile = await loadProfileForUser(result.user);
      set({
        status: result.session ? 'authenticated' : 'guest',
        session: result.session,
        user: result.user,
        profile,
      });
      return result.needsEmailVerification;
    } catch (error) {
      const authError = toAuthError(error);
      set({ error: authError });
      throw authError;
    }
  },

  login: async (email, password) => {
    set({ error: null });
    try {
      const result = await signInWithPassword(email, password);
      const profile = await loadProfileForUser(result.user);
      set({ status: 'authenticated', session: result.session, user: result.user, profile });
    } catch (error) {
      const authError = toAuthError(error);
      set({ error: authError });
      throw authError;
    }
  },

  loginWithGoogle: async () => {
    set({ error: null });
    try {
      await signInWithGoogle();
    } catch (error) {
      const authError = toAuthError(error);
      set({ error: authError });
      throw authError;
    }
  },

  resetPassword: async email => {
    set({ error: null });
    try {
      await requestPasswordReset(email);
    } catch (error) {
      const authError = toAuthError(error);
      set({ error: authError });
      throw authError;
    }
  },

  logout: async () => {
    set({ error: null });
    try {
      await signOut();
      set({ status: 'guest', session: null, user: null, profile: null });
    } catch (error) {
      const authError = toAuthError(error);
      set({ error: authError });
      throw authError;
    }
  },

  logoutEverywhere: async () => {
    set({ error: null });
    try {
      await signOutEverywhere();
      set({ status: 'guest', session: null, user: null, profile: null });
    } catch (error) {
      const authError = toAuthError(error);
      set({ error: authError });
      throw authError;
    }
  },

  deleteAccount: async () => {
    set({ error: null });
    try {
      await deleteAccountRequest();
      set({ status: 'guest', session: null, user: null, profile: null });
    } catch (error) {
      const authError = toAuthError(error);
      set({ error: authError });
      throw authError;
    }
  },

  saveProfile: async input => {
    set({ error: null });
    try {
      const profile = await updateProfile(input);
      set({ profile });
    } catch (error) {
      const authError = toAuthError(error);
      set({ error: authError });
      throw authError;
    }
  },

  clearError: () => set({ error: null }),
}));

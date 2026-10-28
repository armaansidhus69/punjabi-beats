import { readLocalJson, writeLocalJson } from '../database/localStore';
import {
  getOrCreateDeviceIdentity,
  getOrCreateGuestIdentity,
  restoreGuestIdentity,
  UserIdentity,
} from './identity';

const SESSION_KEY = '@pb_core_session';

export type SessionStatus = 'guest' | 'authenticated';

export interface AppSession {
  status: SessionStatus;
  userId: string;
  deviceId: string;
  startedAt: number;
  provider?: 'supabase';
}

function isSession(value: unknown): value is AppSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<AppSession>;
  return (
    (session.status === 'guest' || session.status === 'authenticated') &&
    typeof session.userId === 'string' &&
    typeof session.deviceId === 'string' &&
    typeof session.startedAt === 'number'
  );
}

export async function getSession(): Promise<AppSession | null> {
  const session = await readLocalJson<unknown>(SESSION_KEY);
  return isSession(session) ? session : null;
}

export async function ensureGuestSession(): Promise<AppSession> {
  const existing = await getSession();
  if (existing) return existing;

  const [identity, device] = await Promise.all([
    getOrCreateGuestIdentity(),
    getOrCreateDeviceIdentity(),
  ]);
  const session = createGuestSession(identity, device.deviceId);
  await writeLocalJson(SESSION_KEY, session);
  return session;
}

export function createGuestSession(identity: UserIdentity, deviceId: string): AppSession {
  return {
    status: 'guest',
    userId: identity.userId,
    deviceId,
    startedAt: Date.now(),
  };
}

export function createAuthenticatedSession(userId: string, deviceId: string): AppSession {
  return {
    status: 'authenticated',
    userId,
    deviceId,
    startedAt: Date.now(),
    provider: 'supabase',
  };
}

export async function saveAuthenticatedSession(userId: string): Promise<AppSession> {
  const device = await getOrCreateDeviceIdentity();
  const session = createAuthenticatedSession(userId, device.deviceId);
  await saveSession(session);
  return session;
}

export async function restoreGuestSession(): Promise<AppSession> {
  const [identity, device] = await Promise.all([
    restoreGuestIdentity(),
    getOrCreateDeviceIdentity(),
  ]);
  const session = createGuestSession(identity, device.deviceId);
  await saveSession(session);
  return session;
}

export async function saveSession(session: AppSession): Promise<void> {
  await writeLocalJson(SESSION_KEY, session);
}

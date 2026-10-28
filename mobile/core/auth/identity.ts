import { Platform } from 'react-native';
import { readLocalJson, writeLocalJson } from '../database/localStore';

const IDENTITY_KEY = '@pb_core_identity';
const GUEST_IDENTITY_KEY = '@pb_core_guest_identity';
const DEVICE_KEY = '@pb_core_device';

export type IdentityKind = 'guest' | 'account';

export interface UserIdentity {
  userId: string;
  kind: IdentityKind;
  displayName: string;
  createdAt: number;
  email?: string;
  avatarUrl?: string;
  provider?: 'supabase';
}

export interface DeviceIdentity {
  deviceId: string;
  platform: string;
  createdAt: number;
}

function createId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 12);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

function isUserIdentity(value: unknown): value is UserIdentity {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<UserIdentity>;
  return (
    typeof item.userId === 'string' &&
    (item.kind === 'guest' || item.kind === 'account') &&
    typeof item.displayName === 'string' &&
    typeof item.createdAt === 'number'
  );
}

function isDeviceIdentity(value: unknown): value is DeviceIdentity {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<DeviceIdentity>;
  return (
    typeof item.deviceId === 'string' &&
    typeof item.platform === 'string' &&
    typeof item.createdAt === 'number'
  );
}

export async function getOrCreateDeviceIdentity(): Promise<DeviceIdentity> {
  const existing = await readLocalJson<unknown>(DEVICE_KEY);
  if (isDeviceIdentity(existing)) return existing;

  const created: DeviceIdentity = {
    deviceId: createId('device'),
    platform: Platform.OS,
    createdAt: Date.now(),
  };
  await writeLocalJson(DEVICE_KEY, created);
  return created;
}

export async function getOrCreateGuestIdentity(): Promise<UserIdentity> {
  const storedGuest = await readLocalJson<unknown>(GUEST_IDENTITY_KEY);
  if (isUserIdentity(storedGuest) && storedGuest.kind === 'guest') return storedGuest;

  // Migrate the Phase 0 guest identity without overwriting an active account
  // identity stored under the current-identity key.
  const existing = await readLocalJson<unknown>(IDENTITY_KEY);
  if (isUserIdentity(existing) && existing.kind === 'guest') {
    await writeLocalJson(GUEST_IDENTITY_KEY, existing);
    return existing;
  }

  const created: UserIdentity = {
    userId: createId('guest'),
    kind: 'guest',
    displayName: 'Guest',
    createdAt: Date.now(),
  };
  await writeLocalJson(GUEST_IDENTITY_KEY, created);
  return created;
}

export async function restoreGuestIdentity(): Promise<UserIdentity> {
  const guest = await getOrCreateGuestIdentity();
  await saveIdentity(guest);
  return guest;
}

export interface AccountIdentityInput {
  userId: string;
  displayName?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  createdAt?: number;
}

export function createAccountIdentity(input: AccountIdentityInput): UserIdentity {
  return {
    userId: input.userId,
    kind: 'account',
    displayName: input.displayName?.trim() || input.email?.split('@')[0] || 'User',
    createdAt: input.createdAt ?? Date.now(),
    email: input.email ?? undefined,
    avatarUrl: input.avatarUrl ?? undefined,
    provider: 'supabase',
  };
}

export async function saveAccountIdentity(input: AccountIdentityInput): Promise<UserIdentity> {
  const identity = createAccountIdentity(input);
  await saveIdentity(identity);
  return identity;
}

export async function getCurrentIdentity(): Promise<UserIdentity | null> {
  const identity = await readLocalJson<unknown>(IDENTITY_KEY);
  return isUserIdentity(identity) ? identity : null;
}

export async function saveIdentity(identity: UserIdentity): Promise<void> {
  await writeLocalJson(IDENTITY_KEY, identity);
}

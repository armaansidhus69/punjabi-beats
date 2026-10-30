/**
 * Signed-share client boundary (Phase 8a).
 *
 * Low-level Vercel create/resolve + native sheet. Phase 8c facade decides
 * flag-off legacy vs composer; token/body kabhi log nahi.
 */

import axios from 'axios';
import { Share } from 'react-native';
import Toast from 'react-native-toast-message';
import { getOrCreateDeviceIdentity } from '../core/auth/identity';
import {
  fallbackShareText,
  signedShareMessage,
  validateCreateResponse,
  validateResolvedShare,
  type ResolvedSharePayload,
  type ShareCreateResponse,
  type ShareEntity,
} from '../core/share/share';
import { tapFeedback, warningFeedback } from '../utils/haptics';

const REQUEST_TIMEOUT_MS = 15_000;
const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/+$/, '');
const CLIENT_TOKEN = process.env.EXPO_PUBLIC_PUBLISH_TOKEN ?? '';

export type ShareServiceErrorCode =
  | 'no_key'
  | 'unauthorized'
  | 'rate_limited'
  | 'bad_request'
  | 'network'
  | 'invalid';

export class ShareServiceError extends Error {
  readonly code: ShareServiceErrorCode;
  readonly retryAfterSec?: number;

  constructor(code: ShareServiceErrorCode, message: string, retryAfterSec?: number) {
    super(message);
    this.name = 'ShareServiceError';
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
}

function assertBaseUrl(): void {
  if (API_BASE.length === 0 || /YOUR-|YAHAN_/i.test(API_BASE)) {
    throw new ShareServiceError('no_key', 'Share API config missing');
  }
}

function assertCreateConfig(): void {
  assertBaseUrl();
  if (CLIENT_TOKEN.length === 0) {
    throw new ShareServiceError('no_key', 'Share client token missing');
  }
}

function mapRequestError(err: unknown): ShareServiceError {
  if (err instanceof ShareServiceError) return err;
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const body = err.response?.data as { error?: unknown; retryAfterSec?: unknown } | undefined;
    const retry = typeof body?.retryAfterSec === 'number' ? body.retryAfterSec : undefined;
    if (status === 401) return new ShareServiceError('unauthorized', 'Share client token mismatch');
    if (status === 429) return new ShareServiceError('rate_limited', 'Share rate limit', retry);
    if (status === 400 || status === 410) return new ShareServiceError('bad_request', 'Share invalid/expired');
    if (body?.error === 'no_key') return new ShareServiceError('no_key', 'Share server env missing');
    return new ShareServiceError('network', 'Share API connect nahi hua');
  }
  return new ShareServiceError('network', err instanceof Error ? err.message : 'Share request failed');
}

export async function createShareLink(entity: ShareEntity): Promise<ShareCreateResponse> {
  assertCreateConfig();
  const identity = await getOrCreateDeviceIdentity();
  try {
    const response = await axios.post(
      `${API_BASE}/api/share`,
      { kind: entity.kind, data: entity.data, deviceId: identity.deviceId },
      {
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          'content-type': 'application/json',
          'x-publish-token': CLIENT_TOKEN,
        },
      },
    );
    const result = validateCreateResponse(response.data, API_BASE);
    if (!result) throw new ShareServiceError('invalid', 'Share response guard failed');
    return result;
  } catch (err) {
    throw mapRequestError(err);
  }
}

export async function resolveShareToken(token: string): Promise<ResolvedSharePayload> {
  assertBaseUrl();
  if (token.length === 0 || token.length > 8192 || !/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    throw new ShareServiceError('bad_request', 'Share token invalid');
  }
  try {
    const response = await axios.get(`${API_BASE}/api/share`, {
      timeout: REQUEST_TIMEOUT_MS,
      params: { token, format: 'json' },
    });
    const raw = response.data as { payload?: unknown } | null;
    const payload = validateResolvedShare(raw?.payload, Math.floor(Date.now() / 1000));
    if (!payload) throw new ShareServiceError('invalid', 'Share payload guard failed');
    return payload;
  } catch (err) {
    throw mapRequestError(err);
  }
}

export async function openNativeShare(
  entity: ShareEntity,
  signedUrl?: string | null,
): Promise<boolean> {
  const message = signedUrl ? signedShareMessage(entity, signedUrl) : fallbackShareText(entity);
  try {
    await Share.share({ message });
    return true;
  } catch (err) {
    console.warn('Native share sheet failed:', err);
    warningFeedback();
    Toast.show({ type: 'error', text1: 'Share sheet nahi khuli' });
    return false;
  }
}

/** Legacy/immediate path (flag off facade). */
export async function shareEntity(entity: ShareEntity): Promise<boolean> {
  tapFeedback();
  return openNativeShare(entity);
}

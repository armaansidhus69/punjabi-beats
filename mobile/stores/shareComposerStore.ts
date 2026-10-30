/**
 * Share composer state (Phase 8c) — signed link once, Share/Copy/QR actions.
 * Cache memory-only max10; low-level service import only (facade imports store).
 */

import { create } from 'zustand';
import * as Clipboard from 'expo-clipboard';
import Toast from 'react-native-toast-message';
import {
  SHARE_COMPOSER_CACHE_CAP,
  canRenderShareQr,
  shareEntityFingerprint,
  type ShareCreateResponse,
  type ShareEntity,
} from '../core/share/share';
import {
  createShareLink,
  openNativeShare,
  ShareServiceError,
} from '../services/shareService';
import { selectionFeedback, successFeedback, warningFeedback } from '../utils/haptics';

interface ShareComposerStore {
  visible: boolean;
  entity: ShareEntity | null;
  created: ShareCreateResponse | null;
  loading: boolean;
  error: string | null;
  qrVisible: boolean;
  qrError: string | null;

  open: (entity: ShareEntity) => void;
  retryLink: () => Promise<boolean>;
  nativeShare: () => Promise<boolean>;
  copyLink: () => Promise<boolean>;
  showQr: () => boolean;
  hideQr: () => void;
  setQrError: (message: string) => void;
  close: () => void;
}

const linkCache = new Map<string, ShareCreateResponse>();
let requestToken = 0;

function cacheGet(key: string): ShareCreateResponse | null {
  const hit = linkCache.get(key) ?? null;
  if (!hit) return null;
  if (!Number.isFinite(Date.parse(hit.expiresAt)) || Date.parse(hit.expiresAt) <= Date.now()) {
    linkCache.delete(key);
    return null;
  }
  // LRU-lite: cache hit ko newest insertion banao.
  linkCache.delete(key);
  linkCache.set(key, hit);
  return hit;
}

function cachePut(key: string, value: ShareCreateResponse): void {
  linkCache.delete(key);
  linkCache.set(key, value);
  while (linkCache.size > SHARE_COMPOSER_CACHE_CAP) {
    const oldest = linkCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    linkCache.delete(oldest);
  }
}

function errorText(err: unknown): string {
  if (err instanceof ShareServiceError) {
    if (err.code === 'rate_limited') {
      return `Signed link limit — ${Math.ceil(err.retryAfterSec ?? 60)}s baad retry karo`;
    }
    if (err.code === 'no_key' || err.code === 'unauthorized') {
      return 'Signed share server configure nahi hai';
    }
  }
  return 'Signed link nahi bana — Native Share abhi bhi available hai';
}

export const useShareComposer = create<ShareComposerStore>((set, get) => ({
  visible: false,
  entity: null,
  created: null,
  loading: false,
  error: null,
  qrVisible: false,
  qrError: null,

  open: entity => {
    requestToken += 1;
    const cached = cacheGet(shareEntityFingerprint(entity));
    set({
      visible: true,
      entity,
      created: cached,
      loading: cached === null,
      error: null,
      qrVisible: false,
      qrError: null,
    });
    if (cached === null) void get().retryLink();
  },

  retryLink: async () => {
    const entity = get().entity;
    if (!entity) return false;
    const fingerprint = shareEntityFingerprint(entity);
    const token = ++requestToken;
    selectionFeedback();
    set({ loading: true, error: null, qrError: null });
    try {
      const created = await createShareLink(entity);
      if (
        token !== requestToken ||
        !get().visible ||
        !get().entity ||
        shareEntityFingerprint(get().entity as ShareEntity) !== fingerprint
      ) {
        return false;
      }
      cachePut(fingerprint, created);
      set({ created, loading: false });
      return true;
    } catch (err) {
      if (token !== requestToken || !get().visible) return false;
      set({ loading: false, error: errorText(err) });
      return false;
    }
  },

  nativeShare: async () => {
    const { entity, created } = get();
    if (!entity) return false;
    selectionFeedback();
    const shared = await openNativeShare(entity, created?.url);
    if (shared) get().close();
    return shared;
  },

  copyLink: async () => {
    const url = get().created?.url;
    if (!url) return false;
    try {
      // WebKit user gesture: Clipboard call is the first awaited operation.
      const copied = await Clipboard.setStringAsync(url);
      if (!copied) throw new Error('clipboard returned false');
      successFeedback();
      Toast.show({ type: 'success', text1: 'Share link copy ho gaya' });
      return true;
    } catch (err) {
      console.warn('[share-composer] clipboard failed:', err);
      warningFeedback();
      Toast.show({ type: 'error', text1: 'Link copy nahi hua' });
      return false;
    }
  },

  showQr: () => {
    const url = get().created?.url ?? '';
    if (!canRenderShareQr(url)) {
      warningFeedback();
      Toast.show({ type: 'error', text1: 'Ye link QR ke liye bahut lamba ya invalid hai' });
      return false;
    }
    selectionFeedback();
    set({ qrVisible: true, qrError: null });
    return true;
  },

  hideQr: () => set({ qrVisible: false, qrError: null }),

  setQrError: message => {
    warningFeedback();
    set({ qrError: message, qrVisible: false });
    Toast.show({ type: 'error', text1: message });
  },

  close: () => {
    requestToken += 1;
    set({
      visible: false,
      entity: null,
      created: null,
      loading: false,
      error: null,
      qrVisible: false,
      qrError: null,
    });
  },
}));

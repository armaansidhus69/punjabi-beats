/**
 * Blend realtime sync (Phase 10) — Supabase Realtime postgres_changes.
 * roomSync.ts (Apinator) ko HAATH NAHI lagana — ye sirf blends ke liye.
 *
 * Reconnect/fallback: channel drop ho to detail screen onFocus pe
 * `fetchKnownState` khud hi fresh data pull kar leta hai (realtime ki
 * correctness yahin hai — full state-version protocol Phase 11 Jam spec ka
 * domain hai).
 */

import type { RealtimeChannel } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../core/auth/supabaseClient';

export type BlendChangeKind = 'blend' | 'members' | 'items';
export type BlendChangeListener = (kind: BlendChangeKind) => void;

interface ActiveSubscription {
  channel: RealtimeChannel;
  listeners: Set<BlendChangeListener>;
}

const subscriptions = new Map<string, ActiveSubscription>();

/**
 * Blend-scoped realtime subscription. Ek blend ke saare listeners ek
 * channel share karte hain (screen remount pe duplicate subscribe nahi).
 * Supabase unconfigured (guest mode) me listener register hota rahega,
 * realtime silently off — store khud poll se fresh ho jayega.
 */
export function subscribeBlendChanges(blendId: string, listener: BlendChangeListener): () => void {
  const existing = subscriptions.get(blendId);
  if (existing) {
    existing.listeners.add(listener);
    return () => {
      existing.listeners.delete(listener);
      if (existing.listeners.size === 0) {
        void existing.channel.unsubscribe();
        subscriptions.delete(blendId);
      }
    };
  }

  const listeners = new Set<BlendChangeListener>();
  if (!supabase || !isSupabaseConfigured()) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  const channel = supabase
    .channel(`blend:${blendId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'blends', filter: `id=eq.${blendId}` },
      () => {
        for (const l of listeners) l('blend');
      },
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'blend_members', filter: `blend_id=eq.${blendId}` },
      () => {
        for (const l of listeners) l('members');
      },
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'blend_items', filter: `blend_id=eq.${blendId}` },
      () => {
        for (const l of listeners) l('items');
      },
    );

  listeners.add(listener);
  subscriptions.set(blendId, { channel, listeners });
  void channel.subscribe();

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      void channel.unsubscribe();
      subscriptions.delete(blendId);
    }
  };
}

export function unsubscribeAllBlends(): void {
  for (const active of subscriptions.values()) {
    void active.channel.unsubscribe();
  }
  subscriptions.clear();
}

/**
 * Jam realtime (Phase 11) — Supabase Realtime postgres_changes (4 tables)
 * + ephemeral broadcast (reactions/typing). roomSync.ts (Apinator) ko
 * HAATH NAHI — ye Jam/LP account rooms ke liye.
 *
 * Reconnect: channel 'SUBSCRIBED' status change pe listener ko full refresh
 * signal milo — server rows hamesha win (versioning gate store me hai).
 */

import type { RealtimeChannel } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../core/auth/supabaseClient';

export type JamChangeKind =
  | 'members' // room_members change (join/leave/roles/mute/heartbeat render)
  | 'playback' // room_playback_state row change (version-gated apply in store)
  | 'queue' // room_queue_items change
  | 'messages' // room_messages change
  | 'room'; // rooms row change (status flips: closed/expired)

export type JamChangeListener = (kind: JamChangeKind) => void;

export interface JamEphemeralEvent {
  /** broadcast event name: 'reaction' | 'typing' */
  event: 'reaction' | 'typing';
  payload: { userId?: string; emoji?: string };
}

interface JamSubscription {
  channel: RealtimeChannel;
  changeListeners: Set<JamChangeListener>;
  ephemeralListeners: Set<(event: JamEphemeralEvent) => void>;
}

const subscriptions = new Map<string, JamSubscription>();

/**
 * Room-scoped subscription — ek room ke saare listeners ek channel share
 * karte hain (idempotent). Unconfigured (guest) me listeners register
 * rehte hain, realtime silently off.
 */
export function subscribeJamChanges(
  roomId: string,
  changeListener?: JamChangeListener,
  ephemeralListener?: (event: JamEphemeralEvent) => void,
): () => void {
  const existing = subscriptions.get(roomId);
  if (existing) {
    if (changeListener) existing.changeListeners.add(changeListener);
    if (ephemeralListener) existing.ephemeralListeners.add(ephemeralListener);
    return () => {
      if (changeListener) existing.changeListeners.delete(changeListener);
      if (ephemeralListener) existing.ephemeralListeners.delete(ephemeralListener);
      if (
        existing.changeListeners.size === 0 &&
        existing.ephemeralListeners.size === 0
      ) {
        void existing.channel.unsubscribe();
        subscriptions.delete(roomId);
      }
    };
  }

  const channel = supabase && isSupabaseConfigured()
    ? supabase
        .channel(`jam:${roomId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
          () => notifyChange('room'),
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'room_members', filter: `room_id=eq.${roomId}` },
          () => notifyChange('members'),
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'room_playback_state', filter: `room_id=eq.${roomId}` },
          () => notifyChange('playback'),
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'room_queue_items', filter: `room_id=eq.${roomId}` },
          () => notifyChange('queue'),
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'room_messages', filter: `room_id=eq.${roomId}` },
          () => notifyChange('messages'),
        )
        .on(
          'broadcast',
          { event: 'reaction' },
          payload => notifyEphemeral({ event: 'reaction', payload: (payload.payload ?? {}) as JamEphemeralEvent['payload'] }),
        )
        .on(
          'broadcast',
          { event: 'typing' },
          payload => notifyEphemeral({ event: 'typing', payload: (payload.payload ?? {}) as JamEphemeralEvent['payload'] }),
        )
    : null;

  const changeListeners = new Set<JamChangeListener>();
  const ephemeralListeners = new Set<(event: JamEphemeralEvent) => void>();
  if (changeListener) changeListeners.add(changeListener);
  if (ephemeralListener) ephemeralListeners.add(ephemeralListener);

  // notify closures capture listener sets — channel ho ya na ho, sab same path
  function notifyChange(kind: JamChangeKind): void {
    for (const listener of changeListeners) listener(kind);
  }
  function notifyEphemeral(event: JamEphemeralEvent): void {
    for (const listener of ephemeralListeners) listener(event);
  }

  if (channel === null) {
    return () => {
      if (changeListener) changeListeners.delete(changeListener);
      if (ephemeralListener) ephemeralListeners.delete(ephemeralListener);
    };
  }

  const subscription: JamSubscription = { channel, changeListeners, ephemeralListeners };
  subscriptions.set(roomId, subscription);
  void channel.subscribe();

  return () => {
    if (changeListener) changeListeners.delete(changeListener);
    if (ephemeralListener) ephemeralListeners.delete(ephemeralListener);
    if (changeListeners.size === 0 && ephemeralListeners.size === 0) {
      void channel.unsubscribe();
      subscriptions.delete(roomId);
    }
  };
}

/** Ephemeral send — reaction fire-and-forget (DB log sendReactionLog me) */
export function sendEphemeral(roomId: string, event: JamEphemeralEvent['event'], payload: JamEphemeralEvent['payload']): void {
  const subscription = subscriptions.get(roomId);
  if (!subscription) return;
  void subscription.channel.send({
    type: 'broadcast',
    event,
    payload,
  });
}

export function unsubscribeAllJam(): void {
  for (const subscription of subscriptions.values()) {
    void subscription.channel.unsubscribe();
  }
  subscriptions.clear();
}

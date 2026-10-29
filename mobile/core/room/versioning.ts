/**
 * Room event versioning gate (Phase 11 Jam).
 *
 * state_version server-side monotonic counter hai — client sirf AAGE wale
 * versions apply karta hai. Purana event (race/out-of-order delivery) aur
 * duplicate delivery dono yahin filter hote hain.
 *
 * Pure logic — koi import nahi.
 */

export interface VersionStamp {
  stateVersion: number;
  queueVersion: number;
}

export type ApplyDecision =
  | 'apply' // naya version — store me merge karo
  | 'ignore_old' // purana/stale version — chhodo
  | 'noop_duplicate'; // same version (redelivery) — idempotent no-op

/**
 * Spec contract:
 *  - last null (first sync) → apply
 *  - incoming.stateVersion > last.stateVersion → apply
 *  - equal → noop_duplicate (duplicate delivery; equal-version SAME content
 *    se koi farak nahi padta — state deterministic hai)
 *  - lower → ignore_old
 */
export function shouldApply(incoming: VersionStamp, last: VersionStamp | null): ApplyDecision {
  if (last === null) return 'apply';
  if (incoming.stateVersion > last.stateVersion) return 'apply';
  if (incoming.stateVersion === last.stateVersion) return 'noop_duplicate';
  return 'ignore_old';
}

/**
 * Realtime event ka payload version-nahi-rakhta ho (postgres_changes pura
 * row deta hai) — row se stamp nikalne ka helper. Missing version fields
 * (schema drift) ko -1 treat karte hain — kabhi apply nahi hoga jab tak
 * last null na ho, fail-closed.
 */
export function stampFromRow(row: {
  state_version?: number | null;
  queue_version?: number | null;
}): VersionStamp {
  return {
    stateVersion: typeof row.state_version === 'number' ? row.state_version : -1,
    queueVersion: typeof row.queue_version === 'number' ? row.queue_version : -1,
  };
}

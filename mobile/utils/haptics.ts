/**
 * Haptics helpers — saare calls fire-and-forget + safe hain (web/unsupported
 * devices pe reject ho sakte hain, isliye errors ignore karte hain).
 */
import * as Haptics from 'expo-haptics';

function safe(run: () => Promise<void>): void {
  try {
    void run().catch(() => {
      /* haptics optional hai — ignore */
    });
  } catch {
    /* haptics optional hai — ignore */
  }
}

/** List row / button tap */
export function tapFeedback(): void {
  safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** Mode toggle (shuffle/repeat), tab switch */
export function selectionFeedback(): void {
  safe(() => Haptics.selectionAsync());
}

/** Action succeed (playlist created, song added) */
export function successFeedback(): void {
  safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** Action fail (duplicate song, invalid code) */
export function warningFeedback(): void {
  safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
}

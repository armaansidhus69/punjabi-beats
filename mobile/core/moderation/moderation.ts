/**
 * Moderation (Phase 9/2 slice) — block + report pure logic.
 *
 * Blocklist client-side AsyncStorage me rehti hai (local-first v1) aur
 * incoming room messages/filtering yahin se hoti hai. Reports pehle local
 * queue me jaate hain; moderationService optional Supabase `reports` table
 * me push karta hai (migration 004) — table na ho to local queue safe rehta
 * hai (offline-first, koi data loss nahi).
 */

export const REPORT_REASONS = ['spam', 'harassment', 'inappropriate', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export type ReportTargetKind = 'message' | 'user' | 'room' | 'song';

export interface ReportRecord {
  id: string;
  kind: ReportTargetKind;
  targetId: string;
  reason: ReportReason;
  detail?: string;
  reporterId: string;
  createdAt: string;
}

export function isReportReason(value: unknown): value is ReportReason {
  return typeof value === 'string' && (REPORT_REASONS as readonly string[]).includes(value);
}

const REPORT_ID_MAX = 120;
const REPORT_DETAIL_MAX = 500;

/** Valid report banao — invalid input → null (caller drop). */
export function createReport(input: {
  kind: ReportTargetKind;
  targetId: string;
  reason: ReportReason;
  reporterId: string;
  detail?: string;
  now?: number;
}): ReportRecord | null {
  const targetId = typeof input.targetId === 'string' ? input.targetId.trim() : '';
  const reporterId = typeof input.reporterId === 'string' ? input.reporterId.trim() : '';
  if (!targetId || targetId.length > REPORT_ID_MAX) return null;
  if (!reporterId) return null;
  if (!isReportReason(input.reason)) return null;
  const detail = typeof input.detail === 'string' ? input.detail.trim().slice(0, REPORT_DETAIL_MAX) : undefined;
  return {
    id: `rpt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    kind: input.kind,
    targetId,
    reason: input.reason,
    ...(detail ? { detail } : {}),
    reporterId,
    createdAt: new Date(input.now ?? Date.now()).toISOString(),
  };
}

export function isUserBlocked(blocked: string[], senderId: string): boolean {
  return blocked.includes(senderId);
}

/** Block toggle — add ya remove, naya array (immutable). */
export function toggleBlockedUser(blocked: string[], senderId: string): string[] {
  if (blocked.includes(senderId)) return blocked.filter(id => id !== senderId);
  return [...blocked, senderId];
}

interface SenderCarrier {
  senderId: string;
}

/** Blocked users ke messages hata do — ChatModal incoming path isi se filter. */
export function filterVisibleMessages<T extends SenderCarrier>(
  messages: T[],
  blocked: string[],
): T[] {
  if (blocked.length === 0) return messages;
  return messages.filter(message => !blocked.includes(message.senderId));
}

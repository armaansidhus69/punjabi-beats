/**
 * Moderation service (Phase 9/2 slice) — blocklist + report queue.
 *
 * Local-first: blocklist AsyncStorage (@pb_blocked_users), reports
 * (@pb_reports). Reports optional Supabase `reports` table me best-effort
 * push hote hain (migration 004) — table/RLS na ho to local queue hi rehta
 * hai, koi data loss nahi. UI: ChatModal long-press actions.
 */

import { create } from 'zustand';
import {
  createReport,
  toggleBlockedUser,
  type ReportRecord,
  type ReportTargetKind,
  type ReportReason,
} from '../core/moderation/moderation';
import { readLocalJson, writeLocalJson } from '../core/database/localStore';
import { getSenderId } from './roomSync';
import { supabase } from '../core/auth/supabaseClient';

const BLOCKED_KEY = '@pb_blocked_users';
const REPORTS_KEY = '@pb_reports';
const REPORT_QUEUE_MAX = 50;

interface ModerationState {
  blocked: string[];
  reports: ReportRecord[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  toggleBlock: (senderId: string) => Promise<boolean>;
  isBlocked: (senderId: string) => boolean;
  submitReport: (input: {
    kind: ReportTargetKind;
    targetId: string;
    reason: ReportReason;
    detail?: string;
  }) => Promise<boolean>;
}

export const useModeration = create<ModerationState>()((set, get) => ({
  blocked: [],
  reports: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const [blocked, reports] = await Promise.all([
        readLocalJson<string[]>(BLOCKED_KEY),
        readLocalJson<ReportRecord[]>(REPORTS_KEY),
      ]);
      set({
        blocked: Array.isArray(blocked) ? blocked : [],
        reports: Array.isArray(reports) ? reports : [],
        hydrated: true,
      });
    } catch (err) {
      console.warn('[moderation] hydrate failed:', err);
      set({ blocked: [], reports: [], hydrated: true });
    }
  },

  toggleBlock: async senderId => {
    const next = toggleBlockedUser(get().blocked, senderId);
    set({ blocked: next });
    await writeLocalJson(BLOCKED_KEY, next).catch(() => undefined);
    return next.includes(senderId); // true = ab block ho gaya
  },

  isBlocked: senderId => get().blocked.includes(senderId),

  submitReport: async input => {
    const record = createReport({ ...input, reporterId: getSenderId() });
    if (!record) return false;
    const reports = [record, ...get().reports].slice(0, REPORT_QUEUE_MAX);
    set({ reports });
    await writeLocalJson(REPORTS_KEY, reports).catch(() => undefined);
    // Server push best-effort — migration 004 deploy ho to centrally dikhega
    try {
      if (supabase) {
        await supabase.from('reports').insert({
          kind: record.kind,
          target_id: record.targetId,
          reason: record.reason,
          detail: record.detail ?? null,
          reporter_id: record.reporterId,
        });
      }
    } catch (err) {
      console.warn('[moderation] server report push skipped:', err);
    }
    return true;
  },
}));

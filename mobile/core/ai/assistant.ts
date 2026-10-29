/**
 * AI assistant client-core (Phase 13c) — pure, headless-testable.
 *
 * Local quick commands OFFLINE solve hote (server roundtrip skip = instant
 * transport + rate-limit bachao); baaki text server intent-protocol jata.
 * Validator server response ka second guard hai (13b sanitize pattern).
 */

import type { AssistantAction, AssistantArgs, AssistantReply, AssistantTurn } from '../../types';

export const ASSISTANT_MESSAGE_MAX_CHARS = 240;
export const ASSISTANT_MAX_TURNS = 6;
export const ASSISTANT_REPLY_MAX_CHARS = 200;

export const ASSISTANT_ACTIONS: readonly AssistantAction[] = [
  'search',
  'play',
  'pause',
  'next',
  'prev',
  'queue_add',
  'create_playlist',
  'chat',
] as const;

/* ------------------------------ local quick commands ------------------------------ */

/**
 * OFFLINE transport commands — plain text match, server ke bina instant.
 * Wordy chat ("agla gaana chalao phir …") server hi jata — sirf short
 * command-ish input locally handle hota (spec Section 4.1).
 */
export function matchLocalQuickCommand(rawText: string): { action: AssistantAction; args: AssistantArgs } | null {
  const text = rawText.trim().toLowerCase().replace(/[.!]+$/, '');
  if (text.length === 0 || text.length > 24) return null;

  const tokens = text.split(/\s+/);
  // single/duo word commands hi local — lambi sentences server ko
  if (tokens.length > 2) return null;

  const pauseWords = new Set(['pause', 'rok', 'roko']);
  const nextWords = new Set(['next', 'agla', 'agla-track', 'aglagana']);
  const prevWords = new Set(['previous', 'prev', 'pichla', 'piche']);

  if (pauseWords.has(tokens[0]) || text === 'music roko') {
    return { action: 'pause', args: {} };
  }
  if (nextWords.has(tokens[0])) return { action: 'next', args: {} };
  if (prevWords.has(tokens[0])) return { action: 'prev', args: {} };
  return null;
}

/* ------------------------------ validator ------------------------------ */

/** server response second guard — client kabhi protocol bahar execute nahi */
export function validateAssistantReply(raw: unknown): AssistantReply | null {
  if (raw === null || typeof raw !== 'object') return null;
  const candidate = raw as Partial<AssistantReply>;
  const action = ASSISTANT_ACTIONS.find(entry => entry === candidate.action);
  if (!action) return null;

  const rawArgs = typeof candidate.args === 'object' && candidate.args !== null ? candidate.args : {};
  const args: AssistantArgs = {};

  if (action === 'search' || action === 'play' || action === 'queue_add' || action === 'create_playlist') {
    const query = typeof rawArgs.query === 'string' ? rawArgs.query.trim().slice(0, 120) : '';
    if (query.length === 0) return null; // catalog actions ke bina query invalid
    args.query = query;
    if (action === 'create_playlist') {
      const name = typeof rawArgs.name === 'string' ? rawArgs.name.trim().slice(0, 60) : '';
      args.name = name.length > 0 ? name : `AI: ${query}`;
      const count = typeof rawArgs.count === 'number' && Number.isFinite(rawArgs.count)
        ? Math.min(10, Math.max(1, Math.round(rawArgs.count)))
        : 5;
      args.count = count;
    }
  }

  const reply = typeof candidate.reply === 'string' ? truncateReply(candidate.reply) : '';
  return { action, args, reply };
}

/** reply trim + cap 200 — lambi replies kaata jata (bubble UI ok) */
export function truncateReply(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return '';
  return trimmed.slice(0, ASSISTANT_REPLY_MAX_CHARS);
}

/** reply default fallback — assistant bubble khali na ho */
export function defaultReplyFor(action: AssistantAction): string {
  switch (action) {
    case 'search':
      return 'Ye teen options dekh lo — jise pasand aaye tap karo.';
    case 'play':
      return 'Chal diya bhai, enjoy!';
    case 'pause':
      return 'Music pause kar diya.';
    case 'next':
      return 'Agla track chal raha hai.';
    case 'prev':
      return 'Pichla track wapas laga diya.';
    case 'queue_add':
      return 'Queue me add ho gaya.';
    case 'create_playlist':
      return 'Playlist ban gayi, Library me dekh lo.';
    default:
      return 'Main yahan hoon — gaana chalao ya dhoondo batao.';
  }
}

/* ------------------------------ context ------------------------------ */

/** last `limit` turns server ko jaate (cap 6, role+text only) */
export function makeTurnWindow(
  history: { role: 'user' | 'assistant'; text: string }[],
  currentMessage: string,
  limit: number = ASSISTANT_MAX_TURNS,
): AssistantTurn[] {
  const trimmedHistory = history
    .filter(entry => entry.text.trim().length > 0)
    .map(entry => ({ role: entry.role, text: entry.text.trim().slice(0, ASSISTANT_MESSAGE_MAX_CHARS) }));
  return trimmedHistory.slice(-limit);
}

/* ------------------------------ labels ------------------------------ */

/** action card header labels — Hinglish, screen bubble ke upar */
export function describeAction(action: AssistantAction): string {
  switch (action) {
    case 'search':
      return 'AI search ke results';
    case 'create_playlist':
      return 'AI playlist ban gayi';
    case 'play':
      return 'AI chala diya';
    case 'queue_add':
      return 'Queue me add ho gaya';
    default:
      return '';
  }
}

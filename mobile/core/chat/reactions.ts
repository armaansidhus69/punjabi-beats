/**
 * Room chat reactions (Phase 9 slice) — wire payload + pure merge.
 *
 * Reactions ephemeral hain (sirf live room session me — store me persist nahi,
 * room leave pe gayab, spec v1). Toggle semantics: same sender+message+emoji
 * dobara bheje to reaction REMOVE hota hai (mergeReaction idempotent hai).
 */

export const SYNC_EVENT_REACTION = 'chat-reaction';

export const REACTION_EMOJIS = ['👍', '❤️', '😂', '🔥', '😮'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export function isReactionEmoji(value: unknown): value is ReactionEmoji {
  return typeof value === 'string' && (REACTION_EMOJIS as readonly string[]).includes(value);
}

/** messageId → emoji → senderIds (ephemeral, room store me rehta hai) */
export type ReactionMap = Record<string, Partial<Record<ReactionEmoji, string[]>>>;

export interface ReactionPayload {
  messageId: string;
  emoji: ReactionEmoji;
  senderId: string;
  sentAt: number;
}

export function buildReactionPayload(
  messageId: string,
  emoji: ReactionEmoji,
  ctx: { senderId: string; sentAt: number },
): ReactionPayload | null {
  const id = typeof messageId === 'string' ? messageId.trim() : '';
  if (!id || !isReactionEmoji(emoji)) return null;
  const senderId = typeof ctx.senderId === 'string' ? ctx.senderId.trim() : '';
  if (!senderId) return null;
  const sentAt = Number.isFinite(ctx.sentAt) && ctx.sentAt > 0 ? ctx.sentAt : Date.now();
  return { messageId: id, emoji, senderId, sentAt };
}

/** Wire se aaya reaction — robust parse (queue-add pattern), bekaar → null. */
export function parseReactionPayload(raw: unknown): ReactionPayload | null {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  const messageId = typeof record.messageId === 'string' ? record.messageId.trim() : '';
  const senderId = typeof record.senderId === 'string' ? record.senderId.trim() : '';
  if (!messageId || !senderId || !isReactionEmoji(record.emoji)) return null;
  const sentAt = Number(record.sentAt);
  return {
    messageId,
    emoji: record.emoji,
    senderId,
    sentAt: Number.isFinite(sentAt) && sentAt > 0 ? sentAt : 0,
  };
}

/**
 * Idempotent toggle-merge — same (messageId, emoji, senderId) dubara aaye to
 * remove (echo-safe). Unknown messageId ke liye bucket khud ban jata hai.
 */
export function mergeReaction(map: ReactionMap, payload: ReactionPayload): ReactionMap {
  const bucket = { ...(map[payload.messageId] ?? {}) };
  const senders = [...(bucket[payload.emoji] ?? [])];
  const existing = senders.indexOf(payload.senderId);
  if (existing >= 0) senders.splice(existing, 1);
  else senders.push(payload.senderId);

  const next: ReactionMap = { ...map };
  if (senders.length === 0) delete bucket[payload.emoji];
  else bucket[payload.emoji] = senders;
  if (Object.keys(bucket).length === 0) delete next[payload.messageId];
  else next[payload.messageId] = bucket;
  return next;
}

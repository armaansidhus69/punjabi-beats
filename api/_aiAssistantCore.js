// api/_aiAssistantCore.js — Phase 13c AI assistant ke PURE helpers.
//
// KYUN alag file:
//   13b `_aiPlaylistCore.js` jaisa hi — handler boilerplate alag, pure logic
//   headless test karta hai (test-ai-assistant.mjs). Rate limiter 13b core
//   se REUSE hota hai (state handler-owned, function hi import).

import {
  rateLimitBucket,
  AI_PROMPT_MAX_CHARS,
} from './_aiPlaylistCore.js';

export { rateLimitBucket };

// Chat lighter per-call hai par free tier generous — spec Section 3 me
// 20/day + 5/hour finalize hua (playlist limiter 10/day + 4/hour).
export const ASSISTANT_DAILY_LIMIT = 20;
export const ASSISTANT_HOURLY_LIMIT = 5;
export const ASSISTANT_MAX_TURNS = 6;
export const ASSISTANT_MESSAGE_MAX_CHARS = 240;
export const ASSISTANT_QUERY_MAX_CHARS = 120;
export const ASSISTANT_NAME_MAX_CHARS = 60;
export const ASSISTANT_REPLY_MAX_CHARS = 200;
export const ASSISTANT_CREATE_MAX_COUNT = 10;

/** Action enum — server aur client dono isi list pe validate karte */
export const ASSISTANT_ACTIONS = new Set([
  'search',
  'play',
  'pause',
  'next',
  'prev',
  'queue_add',
  'create_playlist',
  'chat',
]);

/** ye actions catalog search karte — bina playable ke honest partial */
export const ASSISTANT_SEARCH_ACTIONS = new Set(['search', 'play', 'queue_add', 'create_playlist']);

/**
 * Normalized input — handler validate karke hi prompt builder ko deta.
 * turns = conversation context (max 6, {role, text} shape strict).
 */
export function normalizeAssistantRequest(body) {
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  if (message.length === 0 || message.length > ASSISTANT_MESSAGE_MAX_CHARS) return null;
  const deviceIdRaw = typeof body?.deviceId === 'string' ? body.deviceId.trim() : '';
  if (deviceIdRaw.length === 0 || deviceIdRaw.length > 64) return null;

  let turns = [];
  if (Array.isArray(body?.turns)) {
    turns = body.turns
      .map(turn => {
        const role = turn?.role === 'user' || turn?.role === 'assistant' ? turn.role : null;
        const text = typeof turn?.text === 'string' ? turn.text.trim().slice(0, ASSISTANT_MESSAGE_MAX_CHARS) : '';
        return role && text.length > 0 ? { role, text } : null;
      })
      .filter(Boolean)
      .slice(-ASSISTANT_MAX_TURNS);
  }

  const taste = normalizeTaste(body?.taste);
  return { message, deviceId: deviceIdRaw, turns, taste };
}

/** taste: sirf artist names jaate (spec privacy boundary — ids/queries nahi) */
function normalizeTaste(raw) {
  const taste = raw && typeof raw === 'object' ? raw : {};
  const artists = Array.isArray(taste.topArtists)
    ? taste.topArtists
        .filter(entry => typeof entry === 'string' && entry.trim().length > 0)
        .slice(0, 5)
    : [];
  return { topArtists: artists };
}

/**
 * Gemini prompt — intent protocol. User text + turns sirf quoted slots me
 * (injection isolation, 13b pattern). Response contract: STRICT JSON.
 */
export function buildAssistantPrompt({ message, turns = [], taste }) {
  const safeMessage = message.replace(/\u2014/g, '-');
  const lines = [
    'You are the in-app music assistant of a Punjabi music streaming app.',
    'Read the user message and return ONLY one JSON object shaped as: {"action": "<action>", "args": {"...": "..."}, "reply": "<short friendly reply, max 2 sentences, Hinglish ok>"}.',
    'Actions (pick exactly one):',
    '- "search": user wants to FIND songs. args: {"query": "<search words>"}',
    '- "play": user wants IMMEDIATE playback. args: {"query": "<search words>"}',
    '- "pause" / "next" / "prev": playback transport commands. args: {}',
    '- "queue_add": user wants a song ADDED to the running queue. args: {"query": "<search words>"}',
    '- "create_playlist": user wants a NEW playlist on a theme. args: {"name": "<short name>", "query": "<theme search words>", "count": 1-10}',
    '- "chat": general chit-chat / app question / unclear request. args: {}',
    'Rules: query max 120 chars; never invent URLs or artist-only queries; if the message is ambiguous between find and play, prefer "search".',
  ];
  if (turns.length > 0) {
    const turnLines = turns.map(turn => `${turn.role}: ${turn.text}`).join('\n');
    lines.push(`Conversation so far (reference only, do NOT answer from here unless relevant):\n"""\n${turnLines}\n"""`);
  }
  if (taste?.topArtists?.length > 0) {
    lines.push(`User's favourite artists (for taste-aware replies): ${taste.topArtists.join(', ')}.`);
  }
  lines.push(`User message: "${safeMessage}"`);
  return lines.join('\n');
}

/** generateContent body — same REST shape (assistant prompt bharta hai) */
export function buildAssistantGeminiRequest(model, apiKey, promptText) {
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: promptText }] }],
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: 1024,
          responseMimeType: 'application/json',
        },
      }),
    },
  };
}

/**
 * Model text → validated {action, args, reply}.
 * Garbage / unknown action / bad args → null (caller 502 karta hai).
 */
export function parseAssistantResponse(rawText) {
  if (typeof rawText !== 'string' || rawText.length === 0) return null;
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const action = typeof parsed.action === 'string' && ASSISTANT_ACTIONS.has(parsed.action)
    ? parsed.action
    : null;
  if (action === null) return null;

  const rawArgs = parsed.args && typeof parsed.args === 'object' && !Array.isArray(parsed.args) ? parsed.args : {};
  const args = normalizeArgs(action, rawArgs);
  if (args === null) return null;

  const defaultReply = DEFAULT_REPLIES[action];
  let reply = typeof parsed.reply === 'string' ? parsed.reply.trim() : '';
  if (reply.length === 0) reply = defaultReply;
  reply = reply.slice(0, ASSISTANT_REPLY_MAX_CHARS);

  return { action, args, reply };
}

const DEFAULT_REPLIES = {
  search: 'Ye teen options dekh lo — jise pasand aaye tap karo.',
  play: 'Chala di bhai, enjoy!',
  pause: 'Music pause kar diya.',
  next: 'Agla track chal raha hai.',
  prev: 'Pichla track wapas laga diya.',
  queue_add: 'Queue me add ho gaya.',
  create_playlist: 'Playlist ban gayi, Library me dekh lo.',
  chat: 'Main yahan hoon — gaana chalao ya dhoondo batao.',
};

/** per-action args validate; catalog actions ke query MANDATORY */
function normalizeArgs(action, raw) {
  if (isTransportAction(action) || action === 'chat') {
    return {};
  }
  const query = typeof raw.query === 'string' ? raw.query.trim().slice(0, ASSISTANT_QUERY_MAX_CHARS) : '';
  if (query.length === 0) return null; // search-family ke bina query → invalid

  if (action === 'create_playlist') {
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, ASSISTANT_NAME_MAX_CHARS) : '';
    const countRaw = typeof raw.count === 'number' && Number.isFinite(raw.count) ? Math.round(raw.count) : 5;
    const count = Math.min(ASSISTANT_CREATE_MAX_COUNT, Math.max(1, countRaw));
    return { query, name: name.length > 0 ? name : `AI: ${query}`, count };
  }

  return { query };
}

function isTransportAction(action) {
  return action === 'pause' || action === 'next' || action === 'prev';
}

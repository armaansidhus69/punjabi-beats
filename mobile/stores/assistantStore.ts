/**
 * AI assistant store (Phase 13c) — chat history + send flow (zustand).
 *
 * Logic service me (send/execute), yahan sirf bubbles + persist. Cap 20 —
 * restore purani baatein bhi dikhte, server ko sirf last 6 turns jate
 * (service turn-window). Quota echo 13b pattern.
 */

import { create } from 'zustand';
import Toast from 'react-native-toast-message';
import type { AssistantMessage } from '../types';
import {
  describeAiAssistantError,
  sendMessage as serviceSendMessage,
} from '../services/aiAssistantService';
import { getAiChatHistoryRaw, saveAiChatHistory } from '../services/storage';
import { selectionFeedback, successFeedback, warningFeedback } from '../utils/haptics';

export const ASSISTANT_CHAT_CAP = 20;

function normalizeHistory(raw: unknown): AssistantMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      entry =>
        entry !== null &&
        typeof entry === 'object' &&
        typeof (entry as AssistantMessage).text === 'string' &&
        typeof (entry as AssistantMessage).ts === 'string' &&
        ((entry as AssistantMessage).role === 'user' || (entry as AssistantMessage).role === 'assistant'),
    )
    .map(entry => {
      const record = entry as AssistantMessage;
      const message: AssistantMessage = { role: record.role, text: record.text, ts: record.ts };
      if (Array.isArray(record.results)) {
        message.results = record.results.filter(song => song !== null && typeof song === 'object');
      }
      if (record.failed === true) message.failed = true;
      return message;
    })
    .slice(-ASSISTANT_CHAT_CAP);
}

/** bubble list append + cap 20 oldest-drop (pure helpers store local) */
function appendMessage(history: AssistantMessage[], message: AssistantMessage): AssistantMessage[] {
  return [...history, message].slice(-ASSISTANT_CHAT_CAP);
}

interface AssistantStore {
  messages: AssistantMessage[];
  busy: boolean;
  remaining: number | null;
  historyLoaded: boolean;

  initialize: () => Promise<void>;
  send: (text: string) => Promise<boolean>;
  retryLast: () => Promise<boolean>;
  clearChat: () => void;
}

export const useAssistant = create<AssistantStore>((set, get) => ({
  messages: [],
  busy: false,
  remaining: null,
  historyLoaded: false,

  initialize: async () => {
    if (get().historyLoaded) return;
    const messages = normalizeHistory(await getAiChatHistoryRaw());
    set({ messages, historyLoaded: true });
  },

  send: async text => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return false;
    if (get().busy) return false;

    const userBubble: AssistantMessage = {
      role: 'user',
      text: trimmed,
      ts: new Date().toISOString(),
    };
    set({ messages: appendMessage(get().messages, userBubble), busy: true });
    selectionFeedback();

    try {
      const outcome = await serviceSendMessage(trimmed, get().messages);
      const assistantBubble: AssistantMessage = {
        role: 'assistant',
        text: outcome.reply.reply,
        ts: new Date().toISOString(),
        results: outcome.results.length > 0 ? outcome.results : undefined,
      };
      const messages = appendMessage(get().messages, assistantBubble);
      set({ messages, remaining: outcome.remaining });
      void saveAiChatHistory(messages);
      successFeedback();
      return true;
    } catch (err) {
      warningFeedback();
      const assistantBubble: AssistantMessage = {
        role: 'assistant',
        text: describeAiAssistantError(err),
        ts: new Date().toISOString(),
        failed: true,
      };
      const messages = appendMessage(get().messages, assistantBubble);
      set({ messages });
      // failed attempt persist nahi hota — user retry kar sakta hai
      void saveAiChatHistory(messages.filter(entry => !entry.failed));
      Toast.show({ type: 'error', text1: describeAiAssistantError(err) });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  retryLast: async () => {
    const messages = get().messages;
    const lastIndex = messages.length - 1;
    if (lastIndex < 0) return false;
    if (messages[lastIndex].role !== 'assistant') return false;
    const userMessage = messages[lastIndex - 1];
    if (!userMessage || userMessage.role !== 'user') return false;
    // failed pair hata + retry
    const next = messages.slice(0, Math.max(0, messages.length - 2));
    set({ messages: next });
    return get().send(userMessage.text);
  },

  clearChat: () => {
    selectionFeedback();
    set({ messages: [] });
    void saveAiChatHistory([]);
    Toast.show({ type: 'info', text1: 'Chat clear ho gaya' });
  },
}));

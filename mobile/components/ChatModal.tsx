/**
 * Room chat modal (FR-5.12).
 * Dark overlay: header + auto-scroll list + TextInput + Send.
 * Self right (orange), others left (gray). Max 200, limit 500 chars.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChatMessage } from '../types';
import { useRoom } from '../stores/roomStore';
import { getSenderId, sendChatMessage, sendReaction } from '../services/roomSync';
import { useModeration } from '../services/moderationService';
import { successFeedback, tapFeedback, warningFeedback } from '../utils/haptics';
import { CHAT_TEXT_MAX } from '../utils/syncPayload';
import {
  REACTION_EMOJIS,
  type ReactionEmoji,
} from '../core/chat/reactions';
import {
  REPORT_REASONS,
  filterVisibleMessages,
  type ReportReason,
} from '../core/moderation/moderation';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { spacing } from '../constants/spacing';

interface ChatModalProps {
  visible: boolean;
  onClose: () => void;
  /** modal khula ho to incoming messages yahan register kare (badge suppress) */
  onOpenChange?: (open: boolean) => void;
}

/** timestamp → "9:35 PM" (device locale, hour/minute only) */
export function formatChatTime(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const suffix = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${hours}:${minutes} ${suffix}`;
}

export default function ChatModal({ visible, onClose, onOpenChange }: ChatModalProps) {
  const insets = useSafeAreaInsets();
  const rawMessages = useRoom(s => s.messages);
  const reactions = useRoom(s => s.reactions);
  const setUnreadCount = useRoom(s => s.setUnreadCount);
  const blocked = useModeration(s => s.blocked);
  const hydrateModeration = useModeration(s => s.hydrate);
  // Blocked users ke messages list me nahi dikhte (block still reversible)
  const messages = filterVisibleMessages(rawMessages, blocked);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    onOpenChange?.(visible);
    if (visible) {
      setUnreadCount(0);
      setDraft('');
      void hydrateModeration();
    }
  }, [visible, onOpenChange, setUnreadCount, hydrateModeration]);

  useEffect(() => {
    if (visible && messages.length > 0) {
      scrollRef.current?.scrollToEnd({ animated: true });
    }
  }, [visible, messages.length]);

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    void sendChatMessage(draft).then(result => {
      setSending(false);
      if (result === 'sent') {
        successFeedback();
        setDraft('');
        requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
      } else if (result === 'empty') {
        warningFeedback();
      } else {
        warningFeedback();
        onClose();
      }
    });
  }, [draft, sending, onClose]);

  /** Reaction toggle — local update + broadcast (echo roomSync me skip hota hai) */
  const handleReact = useCallback((messageId: string, emoji: ReactionEmoji) => {
    tapFeedback();
    void sendReaction(messageId, emoji);
  }, []);

  /* Phase 9 moderation slice — long-press action sheet (Android Alert 3-button
   * limit ki wajah se custom sheet; emojis + block + report sab same sheet me) */
  const [actionTarget, setActionTarget] = useState<ChatMessage | null>(null);
  const [sheetMode, setSheetMode] = useState<'actions' | 'report'>('actions');
  const blockedTarget = useModeration(s =>
    actionTarget ? s.blocked.includes(actionTarget.senderId) : false,
  );

  const handleBubbleLongPress = useCallback((message: ChatMessage) => {
    tapFeedback();
    setSheetMode('actions');
    setActionTarget(message);
  }, []);

  const closeSheet = useCallback(() => setActionTarget(null), []);

  const handleBlockToggle = useCallback(() => {
    if (!actionTarget) return;
    const moderation = useModeration.getState();
    void moderation.toggleBlock(actionTarget.senderId).then(nowBlocked => {
      ToastMsg(nowBlocked ? `${actionTarget.sender} block ho gaya` : `${actionTarget.sender} unblock ho gaya`);
      closeSheet();
    });
  }, [actionTarget, closeSheet]);

  const handleReport = useCallback((reason: ReportReason) => {
    if (!actionTarget) return;
    void useModeration
      .getState()
      .submitReport({ kind: 'message', targetId: actionTarget.id, reason })
      .then(ok => {
        ToastMsg(ok ? 'Report queue ho gaya — shukriya 🙏' : 'Report nahi ho paaya');
        closeSheet();
      });
  }, [actionTarget, closeSheet]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}
        >
          <View style={styles.header}>
            <Text style={styles.title}>Room Chat</Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Chat band karo"
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
            >
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView
            ref={scrollRef}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
          >
            {messages.length === 0 ? (
              <Text style={styles.empty}>Koi message nahi — baat shuru karo 💬</Text>
            ) : (
              messages.map(message => (
                <ChatBubble
                  key={message.id}
                  message={message}
                  reactions={reactions[message.id]}
                  onReact={handleReact}
                  onLongPress={handleBubbleLongPress}
                />
              ))
            )}
          </ScrollView>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={text => setDraft(text.slice(0, CHAT_TEXT_MAX))}
              placeholder="Message likho…"
              placeholderTextColor={colors.subtext}
              maxLength={CHAT_TEXT_MAX}
              multiline
              returnKeyType="send"
              onSubmitEditing={handleSend}
              accessibilityLabel="Chat message"
            />
            <Pressable
              onPress={handleSend}
              disabled={!draft.trim() || sending}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Message bhejo"
              style={({ pressed }) => [
                styles.sendButton,
                (!draft.trim() || sending) && styles.sendDisabled,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="send" size={20} color={colors.background} />
            </Pressable>
          </View>
        </KeyboardAvoidingView>

        <MessageActionSheet
          target={actionTarget}
          mode={sheetMode}
          blocked={blockedTarget}
          onModeChange={setSheetMode}
          onReact={handleReact}
          onBlockToggle={handleBlockToggle}
          onReport={handleReport}
          onClose={closeSheet}
        />
      </View>
    </Modal>
  );
}

function ChatBubble({
  message,
  reactions,
  onReact,
  onLongPress,
}: {
  message: ChatMessage;
  reactions?: Partial<Record<ReactionEmoji, string[]>>;
  onReact: (messageId: string, emoji: ReactionEmoji) => void;
  onLongPress: (message: ChatMessage) => void;
}) {
  const reactionEntries = Object.entries(reactions ?? {}) as [ReactionEmoji, string[]][];
  return (
    <View style={[styles.bubbleRow, message.self ? styles.right : styles.left]}>
      <View style={[styles.bubbleColumn, message.self ? styles.right : styles.left]}>
        <Pressable
          onLongPress={() => onLongPress(message)}
          delayLongPress={350}
          accessibilityRole="button"
          accessibilityLabel={`${message.sender}: ${message.text}. Long-press for actions`}
          style={[styles.bubble, message.self ? styles.selfBubble : styles.otherBubble]}
        >
          {!message.self && (
            <Text style={styles.sender} numberOfLines={1}>
              {message.sender}
            </Text>
          )}
          <Text style={[styles.text, message.self ? styles.selfText : styles.otherText]}>
            {message.text}
          </Text>
          <Text style={[styles.time, message.self ? styles.selfTime : styles.otherTime]}>
            {formatChatTime(message.timestamp)}
          </Text>
        </Pressable>
        {reactionEntries.length > 0 ? (
          <View style={[styles.reactionRow, message.self ? styles.right : styles.left]}>
            {reactionEntries.map(([emoji, senders]) => (
              <Pressable
                key={emoji}
                onPress={() => onReact(message.id, emoji)}
                accessibilityRole="button"
                accessibilityLabel={`${emoji} reaction toggle`}
                style={[
                  styles.reactionChip,
                  senders.includes(getSenderId()) && styles.reactionMine,
                ]}
              >
                <Text style={styles.reactionEmoji}>{emoji}</Text>
                {senders.length > 1 ? <Text style={styles.reactionCount}>{senders.length}</Text> : null}
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Long-press action sheet — reactions + block + report (cross-platform; RN
 * Alert Android pe 3 buttons tak limit karta hai isliye custom sheet).
 */
function MessageActionSheet({
  target,
  mode,
  blocked,
  onModeChange,
  onReact,
  onBlockToggle,
  onReport,
  onClose,
}: {
  target: ChatMessage | null;
  mode: 'actions' | 'report';
  blocked: boolean;
  onModeChange: (mode: 'actions' | 'report') => void;
  onReact: (messageId: string, emoji: ReactionEmoji) => void;
  onBlockToggle: () => void;
  onReport: (reason: ReportReason) => void;
  onClose: () => void;
}) {
  const isSelf = target?.self ?? false;
  return (
    <Modal visible={target !== null} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={styles.sheetBackdropTouch} onPress={onClose} accessibilityLabel="Band karo" />
        <View style={styles.actionSheet}>
          {target ? (
            <>
              <Text style={styles.sheetTitle} numberOfLines={1}>
                {mode === 'report' ? 'Report karna hai?' : target.sender}
              </Text>
              {mode === 'report' ? (
                <>
                  {REPORT_REASONS.map(reason => (
                    <Pressable
                      key={reason}
                      onPress={() => onReport(reason)}
                      style={({ pressed }) => [styles.sheetRow, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel={`Report: ${reason}`}
                    >
                      <Ionicons name="flag-outline" size={18} color={colors.text} />
                      <Text style={styles.sheetRowText}>{reportLabel(reason)}</Text>
                    </Pressable>
                  ))}
                  <Pressable
                    onPress={() => onModeChange('actions')}
                    style={({ pressed }) => [styles.sheetRow, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel="Wapas actions pe jao"
                  >
                    <Ionicons name="chevron-back" size={18} color={colors.subtext} />
                    <Text style={[styles.sheetRowText, { color: colors.subtext }]}>Wapas</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  {!isSelf ? (
                    <Text style={styles.sheetPreview} numberOfLines={2}>{target.text}</Text>
                  ) : null}
                  {REACTION_EMOJIS.map(emoji => (
                    <Pressable
                      key={emoji}
                      onPress={() => {
                        onReact(target.id, emoji);
                        onClose();
                      }}
                      style={({ pressed }) => [styles.sheetRow, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel={`React ${emoji}`}
                    >
                      <Text style={styles.reactionEmoji}>{emoji}</Text>
                      <Text style={styles.sheetRowText}>React</Text>
                    </Pressable>
                  ))}
                  {!isSelf ? (
                    <Pressable
                      onPress={onBlockToggle}
                      style={({ pressed }) => [styles.sheetRow, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel={blocked ? 'User unblock karo' : 'User block karo'}
                    >
                      <Ionicons name="ban-outline" size={18} color={colors.danger} />
                      <Text style={[styles.sheetRowText, { color: colors.danger }]}>
                        {blocked ? 'Unblock user' : 'Block user'}
                      </Text>
                    </Pressable>
                  ) : null}
                  {!isSelf ? (
                    <Pressable
                      onPress={() => onModeChange('report')}
                      style={({ pressed }) => [styles.sheetRow, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel="Message report karo"
                    >
                      <Ionicons name="flag-outline" size={18} color={colors.text} />
                      <Text style={styles.sheetRowText}>Report…</Text>
                    </Pressable>
                  ) : null}
                </>
              )}
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [styles.sheetRow, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <Ionicons name="close" size={18} color={colors.subtext} />
                <Text style={[styles.sheetRowText, { color: colors.subtext }]}>Cancel</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function reportLabel(reason: ReportReason): string {
  switch (reason) {
    case 'spam': return 'Spam';
    case 'harassment': return 'Harassment';
    case 'inappropriate': return 'Ganda content';
    case 'other': return 'Hor kujh';
  }
}

/** fire-and-forget toast — moderation feedback */
function ToastMsg(text: string): void {
  Toast.show({ type: 'info', text1: text, visibilityTime: 1800 });
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '85%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { ...typography.h1, fontSize: 18, color: colors.text },
  closeButton: { padding: spacing.xs },
  pressed: { opacity: 0.7 },
  list: { flexGrow: 0, flexShrink: 1, marginVertical: spacing.sm },
  listContent: { paddingVertical: spacing.sm, gap: spacing.sm },
  empty: {
    ...typography.body,
    color: colors.subtext,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
  bubbleRow: { flexDirection: 'row' },
  right: { justifyContent: 'flex-end' },
  left: { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '80%',
    borderRadius: 14,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  selfBubble: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  otherBubble: { backgroundColor: colors.card, borderBottomLeftRadius: 4 },
  sender: { ...typography.caption, color: colors.primary, fontWeight: '700', marginBottom: 2 },
  text: { ...typography.body, fontSize: 14 },
  selfText: { color: colors.background },
  otherText: { color: colors.text },
  time: { ...typography.caption, fontSize: 10, marginTop: 2, textAlign: 'right' },
  selfTime: { color: colors.background, opacity: 0.7 },
  otherTime: { color: colors.subtext },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, paddingTop: spacing.sm },
  input: {
    flex: 1,
    maxHeight: 100,
    ...typography.body,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.4 },
  bubbleColumn: { maxWidth: '80%' },
  reactionRow: { flexDirection: 'row', gap: spacing.xs, marginTop: 4 },
  reactionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reactionMine: { borderColor: colors.primary },
  reactionEmoji: { fontSize: 13 },
  reactionCount: { ...typography.caption, fontSize: 11, color: colors.subtext },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheetBackdropTouch: { flex: 1 },
  actionSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.xs,
  },
  sheetTitle: { ...typography.h1, fontSize: 17, color: colors.text, marginBottom: spacing.xs },
  sheetPreview: { ...typography.caption, color: colors.subtext, marginBottom: spacing.xs },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: 10,
  },
  sheetRowText: { ...typography.body, color: colors.text, flex: 1 },
});

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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChatMessage } from '../types';
import { useRoom } from '../stores/roomStore';
import { sendChatMessage } from '../services/roomSync';
import { successFeedback, warningFeedback } from '../utils/haptics';
import { CHAT_TEXT_MAX } from '../utils/syncPayload';
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
  const messages = useRoom(s => s.messages);
  const setUnreadCount = useRoom(s => s.setUnreadCount);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    onOpenChange?.(visible);
    if (visible) {
      setUnreadCount(0);
      setDraft('');
    }
  }, [visible, onOpenChange, setUnreadCount]);

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
              messages.map(message => <ChatBubble key={message.id} message={message} />)
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
      </View>
    </Modal>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  return (
    <View style={[styles.bubbleRow, message.self ? styles.right : styles.left]}>
      <View style={[styles.bubble, message.self ? styles.selfBubble : styles.otherBubble]}>
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
      </View>
    </View>
  );
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
});

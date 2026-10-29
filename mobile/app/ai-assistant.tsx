/**
 * AI Assistant chat — /ai-assistant (Phase 13c roadmap).
 * Chat bubbles + command action cards. Render-only: logic assistantStore,
 * intent/execution service me. Disclosure strip header (FR-12.4 pattern).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AiAssistantGate from '../components/AiAssistantGate';
import LoadingSpinner from '../components/LoadingSpinner';
import { useAssistant } from '../stores/assistantStore';
import { usePlayer } from '../stores/playerStore';
import { describeAction } from '../core/ai/assistant';
import { useMiniPlayerPadding } from '../hooks/useMiniPlayerPadding';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { spacing } from '../constants/spacing';
import { tapFeedback, successFeedback } from '../utils/haptics';

export default function AiAssistantScreen() {
  const insets = useSafeAreaInsets();
  const contentPadding = useMiniPlayerPadding(spacing.lg);

  const messages = useAssistant(s => s.messages);
  const busy = useAssistant(s => s.busy);
  const remaining = useAssistant(s => s.remaining);
  const initialize = useAssistant(s => s.initialize);
  const send = useAssistant(s => s.send);
  const retryLast = useAssistant(s => s.retryLast);
  const clearChat = useAssistant(s => s.clearChat);

  const [text, setText] = useState('');
  const playingId = usePlayer(s => s.currentSong?.id ?? null);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  const handleSend = useCallback(() => {
    const value = text.trim();
    if (value.length === 0 || busy) return;
    setText('');
    void send(value);
  }, [text, busy, send]);

  const handleConfirmClear = useCallback(() => {
    Alert.alert('Chat clear?', 'Purani baatein delete ho jayengi.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: clearChat },
    ]);
  }, [clearChat]);

  return (
    <AiAssistantGate>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.container, { paddingTop: insets.top }]}>
          <View style={styles.header}>
            <Pressable
              onPress={router.back}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Wapas jao"
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            >
              <Ionicons name="chevron-back" size={24} color={colors.text} />
            </Pressable>
            <View style={styles.headerInfo}>
              <Text style={styles.headerTitle}>AI Assistant</Text>
              {remaining !== null && (
                <Text style={styles.quotaNote}>Aaj {remaining} messages bache</Text>
              )}
            </View>
            <Pressable
              onPress={handleConfirmClear}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Chat clear karo"
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            >
              <Ionicons name="trash-outline" size={20} color={colors.subtext} />
            </Pressable>
          </View>

          {/* disclosure strip — hamesha visible */}
          <View style={styles.disclosure}>
            <Ionicons name="sparkles-outline" size={15} color={colors.primary} />
            <Text style={styles.disclosureText}>
              AI suggestions — commands aapke device pe hi chalte hain.
            </Text>
          </View>

          <ScrollView
            contentContainerStyle={{ paddingBottom: contentPadding }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {messages.length === 0 && !busy && (
              <View style={styles.emptyWrap}>
                <Ionicons name="chatbubbles-outline" size={40} color={colors.primary} />
                <Text style={styles.emptyTitle}>Kya sunna hai aaj?</Text>
                <Text style={styles.emptySubtitle}>
                  Prompt likh do — "club banger chalao", "diljit dhoondo", "pause karo".
                </Text>
              </View>
            )}

            {messages.map(message => (
              <View
                key={message.ts + message.role}
                style={[
                  styles.bubbleRow,
                  message.role === 'user' ? styles.bubbleRight : styles.bubbleLeft,
                ]}
              >
                <View
                  style={[
                    styles.bubble,
                    message.role === 'user' ? styles.userBubble : styles.assistantBubble,
                    message.failed === true && styles.failedBubble,
                  ]}
                >
                  <Text
                    style={
                      message.role === 'user' ? styles.userBubbleText : styles.assistantBubbleText
                    }
                  >
                    {message.text}
                  </Text>
                  {message.failed === true && (
                    <Pressable
                      onPress={() => void retryLast()}
                      accessibilityRole="button"
                      accessibilityLabel="Dobara bhejo"
                      style={({ pressed }) => [styles.retryChip, pressed && styles.pressed]}
                    >
                      <Ionicons name="refresh" size={13} color={colors.subtext} />
                      <Text style={styles.retryText}>Retry</Text>
                    </Pressable>
                  )}
                </View>

                {/* action results — 3 cards, tap → play (assistant picks top) */}
                {message.results !== undefined && message.results.length > 0 && (
                  <View style={styles.resultCardWrap}>
                    <Text style={styles.resultCardLabel}>{describeAction('search')}</Text>
                    {message.results.map(song => (
                      <Pressable
                        key={song.id}
                        onPress={() => {
                          tapFeedback();
                          const player = usePlayer.getState();
                          void player.playSong(song, [song], { startPaused: false });
                          successFeedback();
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`${song.title} chalao`}
                        style={({ pressed }) => [styles.resultCard, pressed && styles.pressed]}
                      >
                        <Image source={{ uri: song.cover }} style={styles.resultArt} />
                        <View style={styles.resultInfo}>
                          <Text style={styles.resultTitle} numberOfLines={1}>
                            {song.title}
                          </Text>
                          <Text style={styles.resultMeta} numberOfLines={1}>
                            {song.artist}
                          </Text>
                        </View>
                        <Ionicons
                          name={playingId === song.id ? 'pause' : 'play'}
                          size={18}
                          color={playingId === song.id ? colors.primary : colors.subtext}
                        />
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            ))}

            {busy && <LoadingSpinner label="Assistant soch raha hai…" />}
          </ScrollView>

          {/* input bar */}
          <View style={[styles.inputRow, { marginBottom: insets.bottom }]}>
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={setText}
              placeholder="Message likho…"
              placeholderTextColor={colors.subtext}
              maxLength={240}
              multiline
              accessibilityLabel="Assistant message"
            />
            <Pressable
              onPress={handleSend}
              disabled={busy || text.trim().length === 0}
              accessibilityRole="button"
              accessibilityLabel="Message bhejo"
              style={({ pressed }) => [
                styles.sendButton,
                pressed && styles.pressed,
                (busy || text.trim().length === 0) && styles.disabled,
              ]}
            >
              <Ionicons name="arrow-up" size={20} color={colors.background} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </AiAssistantGate>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.md,
  },
  headerInfo: { flex: 1 },
  headerTitle: { ...typography.h2, color: colors.text },
  quotaNote: { ...typography.caption, color: colors.subtext },
  iconButton: { padding: spacing.xs },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
  disclosure: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: 10,
    backgroundColor: colors.card,
  },
  disclosureText: { ...typography.caption, color: colors.subtext, flex: 1 },
  emptyWrap: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  emptyTitle: { ...typography.h2, color: colors.text },
  emptySubtitle: { ...typography.caption, color: colors.subtext, textAlign: 'center' },
  bubbleRow: { paddingHorizontal: spacing.lg, marginVertical: spacing.xs },
  bubbleRight: { alignItems: 'flex-end' },
  bubbleLeft: { alignItems: 'flex-start' },
  bubble: {
    maxWidth: '85%',
    padding: spacing.sm,
    borderRadius: 14,
  },
  userBubble: { backgroundColor: colors.primary },
  assistantBubble: { backgroundColor: colors.card },
  failedBubble: { backgroundColor: colors.card, opacity: 0.75 },
  userBubbleText: { ...typography.body, color: colors.background },
  assistantBubbleText: { ...typography.body, color: colors.text },
  retryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing.xs,
    alignSelf: 'flex-start',
  },
  retryText: { ...typography.caption, color: colors.subtext },
  resultCardWrap: {
    marginTop: spacing.sm,
    width: '92%',
    borderRadius: 12,
    backgroundColor: colors.card,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  resultCardLabel: { ...typography.caption, color: colors.subtext },
  resultCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  resultArt: { width: 40, height: 40, borderRadius: 8, backgroundColor: colors.card },
  resultInfo: { flex: 1 },
  resultTitle: { ...typography.body, color: colors.text },
  resultMeta: { ...typography.caption, color: colors.subtext },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  input: {
    flex: 1,
    ...typography.body,
    color: colors.text,
    padding: spacing.sm,
    borderRadius: 22,
    backgroundColor: colors.card,
    minHeight: 44,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

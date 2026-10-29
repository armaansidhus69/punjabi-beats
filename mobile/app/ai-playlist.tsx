/**
 * AI Playlist â€” /ai-playlist (Phase 13b roadmap).
 * Prompt â†’ generate â†’ matchmaking preview â†’ Play All / Save / Refine.
 * Entry point Library tab ka AI Playlist card. Render-only: logic
 * aiPlaylistStore. AI disclosure hamesha upar visible (spec Section 4.3).
 */
import { useCallback, useEffect, useState } from 'react';
import {
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
import AiPlaylistGate from '../components/AiPlaylistGate';
import LoadingSpinner from '../components/LoadingSpinner';
import { useAiPlaylist } from '../stores/aiPlaylistStore';
import { useMiniPlayerPadding } from '../hooks/useMiniPlayerPadding';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { spacing } from '../constants/spacing';
import { tapFeedback } from '../utils/haptics';

export default function AiPlaylistScreen() {
  const insets = useSafeAreaInsets();
  const contentPadding = useMiniPlayerPadding(spacing.lg);

  const planRows = useAiPlaylist(s => s.planRows);
  const remaining = useAiPlaylist(s => s.remaining);
  const busy = useAiPlaylist(s => s.busy);
  const history = useAiPlaylist(s => s.history);
  const initialize = useAiPlaylist(s => s.initialize);
  const generate = useAiPlaylist(s => s.generate);
  const removeRow = useAiPlaylist(s => s.removeRow);
  const playAll = useAiPlaylist(s => s.playAll);
  const saveAsPlaylist = useAiPlaylist(s => s.saveAsPlaylist);

  const [prompt, setPrompt] = useState('');
  const [refineText, setRefineText] = useState('');

  useEffect(() => {
    void initialize();
  }, [initialize]);

  const handleGenerate = useCallback(() => {
    const submit = prompt.trim();
    if (submit.length < 2) return;
    setRefineText('');
    void generate(submit);
  }, [prompt, generate]);

  const handleRefine = useCallback(() => {
    const note = refineText.trim();
    if (note.length < 2) return;
    void generate(prompt.trim(), { refineText: note });
  }, [refineText, prompt, generate]);

  const isPlanEmpty = planRows.length === 0;

  return (
    <AiPlaylistGate>
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
          <Text style={styles.headerTitle}>AI Playlist</Text>
          <View style={styles.iconSpacer} />
        </View>

        <ScrollView
          contentContainerStyle={{ paddingBottom: contentPadding }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* AI disclosure â€” hamesha visible (FR-11.4) */}
          <View style={styles.disclosure}>
            <Ionicons name="sparkles-outline" size={16} color={colors.primary} />
            <Text style={styles.disclosureText}>
              AI ne gaane sujhaye hain â€” match hamesha sahi nahi hota.
            </Text>
          </View>

          <TextInput
            style={styles.promptInput}
            value={prompt}
            onChangeText={setPrompt}
            placeholder="Kaisi playlist chahiye? (club ke liye bangerâ€¦)"
            placeholderTextColor={colors.subtext}
            maxLength={240}
            multiline
            accessibilityLabel="AI playlist prompt"
            onSubmitEditing={handleGenerate}
          />
          <Pressable
            onPress={handleGenerate}
            disabled={busy || prompt.trim().length < 2}
            accessibilityRole="button"
            accessibilityLabel="AI playlist generate karo"
            style={({ pressed }) => [
              styles.generateButton,
              pressed && styles.pressed,
              (busy || prompt.trim().length < 2) && styles.disabled,
            ]}
          >
            <Ionicons name="sparkles" size={18} color={colors.background} />
            <Text style={styles.generateText}>{busy ? 'Generate ho raha haiâ€¦' : 'Generate'}</Text>
          </Pressable>

          {history.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Recent prompts</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {history.map(entry => {
                  const key = `${entry.ts}|${entry.prompt}`;
                  return (
                    <Pressable
                      key={key}
                      onPress={() => {
                        tapFeedback();
                        setPrompt(entry.prompt);
                        if (entry.refineText) setRefineText(entry.refineText);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`${entry.prompt} prompt dobara use karo`}
                      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
                    >
                      <Text style={styles.chipText} numberOfLines={1}>
                        {entry.prompt}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {busy && <LoadingSpinner label="AI playlist generate ho rahi haiâ€¦" />}

          {!isPlanEmpty && !busy && (
            <View style={styles.section}>
              <View style={styles.planHeaderRow}>
                <Text style={styles.sectionTitle}>
                  Preview Â· {planRows.filter(row => row.song !== null).length} matched
                </Text>
                {remaining !== null && (
                  <Text style={styles.remainingNote}>Aaj {remaining} generations bache</Text>
                )}
              </View>
              {planRows.map((row, index) => (
                <View key={`${row.track.title}|${row.track.artist}|${index}`} style={styles.planRow}>
                  <Ionicons
                    name={row.song !== null ? 'checkmark-circle' : 'close-circle'}
                    size={18}
                    color={row.song !== null ? colors.primary : colors.subtext}
                  />
                  <View style={styles.planInfo}>
                    <Text style={styles.planTitle} numberOfLines={1}>
                      {row.track.title}
                    </Text>
                    <Text style={styles.planMeta} numberOfLines={1}>
                      {row.track.artist}
                      {row.song === null ? ' â€” match nahi mila' : ''}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => removeRow(index)}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="Ye track preview se hatao"
                    style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
                  >
                    <Ionicons name="trash-outline" size={18} color={colors.subtext} />
                  </Pressable>
                </View>
              ))}

              {/* refine â€” same plan context + follow-up note (FR-11.2) */}
              <View style={styles.refineRow}>
                <TextInput
                  style={styles.refineInput}
                  value={refineText}
                  onChangeText={setRefineText}
                  placeholder="Refine karo â€” thoda slow gaane loâ€¦"
                  placeholderTextColor={colors.subtext}
                  maxLength={240}
                  accessibilityLabel="Refine note"
                />
                <Pressable
                  onPress={handleRefine}
                  disabled={busy || refineText.trim().length < 2}
                  accessibilityRole="button"
                  accessibilityLabel="Playlist refine karo"
                  style={({ pressed }) => [
                    styles.refineButton,
                    pressed && styles.pressed,
                    (busy || refineText.trim().length < 2) && styles.disabled,
                  ]}
                >
                  <Ionicons name="refresh" size={16} color={colors.text} />
                </Pressable>
              </View>

              <View style={styles.actionRow}>
                <Pressable
                  onPress={() => void playAll()}
                  accessibilityRole="button"
                  accessibilityLabel="Puri plan play karo"
                  style={({ pressed }) => [styles.playAllButton, pressed && styles.pressed]}
                >
                  <Ionicons name="play" size={18} color={colors.background} />
                  <Text style={styles.playAllText}>Play All</Text>
                </Pressable>
                <Pressable
                  onPress={() => void saveAsPlaylist()}
                  accessibilityRole="button"
                  accessibilityLabel="Plan playlist ke roop me save karo"
                  style={({ pressed }) => [styles.saveButton, pressed && styles.pressed]}
                >
                  <Ionicons name="save-outline" size={18} color={colors.text} />
                  <Text style={styles.saveText}>Save</Text>
                </Pressable>
              </View>
            </View>
          )}
        </ScrollView>
      </View>
    </AiPlaylistGate>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  headerTitle: { ...typography.h2, color: colors.text, flex: 1 },
  iconButton: { padding: spacing.xs },
  iconSpacer: { width: 40 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
  disclosure: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.card,
  },
  disclosureText: { ...typography.caption, color: colors.subtext, flex: 1 },
  promptInput: {
    ...typography.body,
    color: colors.text,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.card,
    minHeight: 48,
  },
  generateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  generateText: { ...typography.body, fontWeight: '600' as const, color: colors.background },
  section: { marginTop: spacing.lg, paddingHorizontal: spacing.lg },
  sectionTitle: { ...typography.h2, color: colors.text, marginBottom: spacing.md },
  planHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  remainingNote: { ...typography.caption, color: colors.subtext },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  planInfo: { flex: 1 },
  planTitle: { ...typography.body, color: colors.text },
  planMeta: { ...typography.caption, color: colors.subtext },
  removeButton: { padding: spacing.xs },
  refineRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  refineInput: {
    flex: 1,
    ...typography.body,
    color: colors.text,
    padding: spacing.sm,
    borderRadius: 10,
    backgroundColor: colors.card,
  },
  refineButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: 10,
    backgroundColor: colors.card,
  },
  actionRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  playAllButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  playAllText: { ...typography.body, fontWeight: '600' as const, color: colors.background },
  saveButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.card,
  },
  saveText: { ...typography.body, fontWeight: '600' as const, color: colors.text },
  chip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    backgroundColor: colors.card,
    marginRight: spacing.sm,
    maxWidth: 220,
  },
  chipText: { ...typography.caption, color: colors.text },
});

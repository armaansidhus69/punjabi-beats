/**
 * CreatePlaylistModal — Library screen se nayi playlist banane ka modal (Phase 9).
 * Validation shared helper se aati hai (utils/playlistValidation.ts) aur store +
 * toast ka kaam parent (library screen) karta hai — component dumb rehta hai.
 */
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { spacing } from '../constants/spacing';
import { PLAYLIST_NAME_MAX, validatePlaylistName } from '../utils/playlistValidation';
import { successFeedback, tapFeedback, warningFeedback } from '../utils/haptics';

interface CreatePlaylistModalProps {
  visible: boolean;
  onClose: () => void;
  /** duplicate check ke liye baaki playlists ke naam */
  existingNames: readonly string[];
  /** valid naam milne pe call hota hai */
  onCreate: (name: string) => void;
}

export default function CreatePlaylistModal({
  visible,
  onClose,
  existingNames,
  onCreate,
}: CreatePlaylistModalProps) {
  const [name, setName] = useState('');
  const [showError, setShowError] = useState(false);

  // Modal khulte hi form reset (pichla adhoora naam na dikhe)
  useEffect(() => {
    if (visible) {
      setName('');
      setShowError(false);
    }
  }, [visible]);

  const nameError = validatePlaylistName(name, existingNames);
  // Khaali form pe pehle se error na dikhe — sirf submit ya typing ke baad
  const visibleError = showError || name.trim().length > 0 ? nameError : null;

  const handleCancel = () => {
    tapFeedback();
    onClose();
  };

  const handleCreate = () => {
    if (nameError) {
      setShowError(true);
      warningFeedback();
      return;
    }
    successFeedback();
    onCreate(name.trim());
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleCancel}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={handleCancel} />

        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>New Playlist</Text>
            <Pressable
              onPress={handleCancel}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Modal band karo"
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            >
              <Ionicons name="close" size={22} color={colors.subtext} />
            </Pressable>
          </View>

          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Playlist ka naam"
            placeholderTextColor={colors.subtext}
            style={[styles.input, visibleError ? styles.inputError : null]}
            maxLength={PLAYLIST_NAME_MAX}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleCreate}
            accessibilityLabel="Playlist ka naam"
          />
          {visibleError ? <Text style={styles.errorText}>{visibleError}</Text> : null}

          <View style={styles.buttons}>
            <Pressable
              onPress={handleCancel}
              accessibilityRole="button"
              accessibilityLabel="Cancel karo"
              style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleCreate}
              accessibilityRole="button"
              accessibilityLabel="Playlist banao"
              style={({ pressed }) => [styles.saveButton, pressed && styles.pressed]}
            >
              <Ionicons name="add" size={18} color={colors.background} />
              <Text style={styles.saveText}>Banao</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', padding: spacing.lg },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.65)' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...typography.h2, color: colors.text },
  iconButton: { padding: spacing.xs },
  input: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  inputError: { borderColor: '#ff6b6b' },
  errorText: { ...typography.caption, color: '#ff6b6b' },
  buttons: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs },
  cancelButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelText: { ...typography.body, color: colors.subtext, fontWeight: '600' },
  saveButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  saveText: { ...typography.body, color: colors.background, fontWeight: '700' },
  pressed: { opacity: 0.7 },
});

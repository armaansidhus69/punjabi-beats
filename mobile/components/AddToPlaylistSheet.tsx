/**
 * AddToPlaylistSheet — SongItem ke '+' button se khulne wala global bottom sheet.
 *
 * Root layout me ek hi baar mount hota hai (sabhi screens ke liye) aur khud
 * `playlistStore.activeSongForAdd` dekhta hai:
 *   - playlist list → tap pe song add (duplicate pe warning toast, FR-4.7)
 *   - "New Playlist" → isi sheet me inline create (nested Modal se bachne ke liye)
 * Song add hone pe toast + haptics + sheet auto-close.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import { Playlist } from '../types';
import { usePlaylists } from '../stores/playlistStore';
import { PLAYLIST_NAME_MAX, validatePlaylistName } from '../utils/playlistValidation';
import { successFeedback, tapFeedback, warningFeedback } from '../utils/haptics';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { spacing } from '../constants/spacing';
import LoadingSpinner from './LoadingSpinner';
import PlaylistRow from './PlaylistRow';

export default function AddToPlaylistSheet() {
  const insets = useSafeAreaInsets();

  const song = usePlaylists(s => s.activeSongForAdd);
  const playlists = usePlaylists(s => s.playlists);
  const loaded = usePlaylists(s => s.loaded);
  const load = usePlaylists(s => s.load);
  const createPlaylist = usePlaylists(s => s.createPlaylist);
  const addSongToPlaylist = usePlaylists(s => s.addSongToPlaylist);
  const closeAddSheet = usePlaylists(s => s.closeAddSheet);

  /** 'list' = playlist chuno, 'create' = inline nayi playlist banao */
  const [mode, setMode] = useState<'list' | 'create'>('list');
  const [name, setName] = useState('');
  const [showError, setShowError] = useState(false);

  const visible = song !== null;

  // Sheet khulte hi fresh state + playlists hydrate (cold start pe memory khaali hoti hai)
  useEffect(() => {
    if (!visible) return;
    setMode('list');
    setName('');
    setShowError(false);
    if (!loaded) void load();
  }, [loaded, load, visible]);

  const handleClose = useCallback(() => {
    tapFeedback();
    closeAddSheet();
  }, [closeAddSheet]);

  const handlePickPlaylist = useCallback(
    async (playlist: Playlist) => {
      if (!song) return;
      const added = await addSongToPlaylist(playlist.id, song);
      if (!added) {
        // FR-4.7: duplicate song — sheet khuli rehti hai taaki doosri playlist chun sake
        warningFeedback();
        Toast.show({
          type: 'error',
          text1: 'Ye song pehle se hai',
          text2: `"${playlist.name}" me ye song already add hai`,
        });
        return;
      }
      successFeedback();
      Toast.show({
        type: 'success',
        text1: 'Playlist me add ho gaya',
        text2: `"${song.title}" → ${playlist.name}`,
      });
      closeAddSheet();
    },
    [addSongToPlaylist, closeAddSheet, song],
  );

  const nameError = validatePlaylistName(name, playlists.map(p => p.name));

  const handleCreate = useCallback(async () => {
    if (!song) return;
    if (nameError) {
      setShowError(true);
      warningFeedback();
      return;
    }
    const playlist = createPlaylist(name);
    // Naya playlist banate waqt song bhi turant add karo (flow ka matlab wahi hai)
    const added = await addSongToPlaylist(playlist.id, song);
    successFeedback();
    Toast.show({
      type: 'success',
      text1: 'Playlist ban gayi',
      text2: added ? `"${song.title}" add ho gaya` : playlist.name,
    });
    closeAddSheet();
  }, [addSongToPlaylist, closeAddSheet, createPlaylist, name, nameError, song]);

  // Song na ho to sheet band (root layout me hamesha mounted rehta hai)
  if (!song) return null;

  const visibleError = showError || name.trim().length > 0 ? nameError : null;

  const createForm = (
    <View style={styles.createForm}>
      {mode === 'create' ? (
        <Text style={styles.createHint}>Nayi playlist banao — song turant add ho jayega</Text>
      ) : null}

      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Playlist ka naam"
        placeholderTextColor={colors.subtext}
        style={[styles.input, visibleError ? styles.inputError : null]}
        maxLength={PLAYLIST_NAME_MAX}
        autoFocus={mode === 'create'}
        returnKeyType="done"
        onSubmitEditing={() => {
          void handleCreate();
        }}
        accessibilityLabel="Playlist ka naam"
      />
      {visibleError ? <Text style={styles.errorText}>{visibleError}</Text> : null}

      <View style={styles.createButtons}>
        {mode === 'create' ? (
          <Pressable
            onPress={() => {
              tapFeedback();
              setMode('list');
              setName('');
              setShowError(false);
            }}
            accessibilityRole="button"
            accessibilityLabel="Playlist list pe wapas jao"
            style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        ) : null}

        <Pressable
          onPress={() => {
            void handleCreate();
          }}
          accessibilityRole="button"
          accessibilityLabel="Playlist banao aur song add karo"
          style={({ pressed }) => [styles.saveButton, pressed && styles.pressed]}
        >
          <Ionicons name="add" size={18} color={colors.background} />
          <Text style={styles.saveText}>Banao</Text>
        </Pressable>
      </View>
    </View>
  );

  const playlistList = !loaded ? (
    <LoadingSpinner compact label="Playlists load ho rahi hain…" />
  ) : playlists.length === 0 ? (
    <View style={styles.emptyWrap}>
      <Text style={styles.emptyText}>Abhi koi playlist nahi — ek banao</Text>
      {createForm}
    </View>
  ) : (
    <View style={styles.listWrap}>
      <FlatList
        data={playlists}
        keyExtractor={item => item.id}
        renderItem={({ item }) => {
          const alreadyAdded = item.songs.some(s => s.id === song.id);
          return (
            <PlaylistRow
              playlist={item}
              onPress={handlePickPlaylist}
              disabled={alreadyAdded}
              trailingText={alreadyAdded ? 'Already added' : undefined}
              rightIcon={alreadyAdded ? 'checkmark-circle' : 'add-circle-outline'}
            />
          );
        }}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      />

      <Pressable
        onPress={() => {
          tapFeedback();
          setMode('create');
        }}
        accessibilityRole="button"
        accessibilityLabel="Nayi playlist banao"
        style={({ pressed }) => [styles.newButton, pressed && styles.pressed]}
      >
        <Ionicons name="add" size={18} color={colors.primary} />
        <Text style={styles.newText}>New Playlist</Text>
      </Pressable>
    </View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={handleClose} />

        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.handle} />

          <View style={styles.headerRow}>
            <View style={styles.headerInfo}>
              <Text style={styles.title}>Playlist me add karo</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {song.title}
              </Text>
            </View>
            <Pressable
              onPress={handleClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Sheet band karo"
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            >
              <Ionicons name="close" size={22} color={colors.subtext} />
            </Pressable>
          </View>

          {mode === 'create' ? createForm : playlistList}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingTop: spacing.sm,
    maxHeight: '75%',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  headerInfo: { flex: 1 },
  title: { ...typography.h2, color: colors.text },
  subtitle: { ...typography.caption, color: colors.subtext, marginTop: 2 },
  iconButton: { padding: spacing.xs },
  listWrap: { flexShrink: 1 },
  list: { flexGrow: 0, flexShrink: 1 },
  listContent: { paddingBottom: spacing.md },
  emptyWrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.md },
  emptyText: { ...typography.body, color: colors.subtext, textAlign: 'center' },
  newButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  newText: { ...typography.body, color: colors.text, fontWeight: '600' },
  createForm: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm },
  createHint: { ...typography.caption, color: colors.subtext },
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
  createButtons: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs },
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

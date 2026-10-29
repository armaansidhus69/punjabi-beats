/**
 * Add-songs search modal — Blend [id] + Jam [id] dono ka shared sheet.
 * existing searchSongs multi-source chain use karta hai; preview-only
 * tracks filter (Blend/Jam dono me full-playable add rule hai).
 */

import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, Keyboard, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Song } from '../types';
import { searchSongs } from '../services/musicApi';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { spacing } from '../constants/spacing';

interface Props {
  visible: boolean;
  onClose: () => void;
  onAdd: (song: Song) => Promise<void>;
  emptyHint?: string;
}

export default function AddSongSearchModal({ visible, onClose, onAdd, emptyHint }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Song[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);

  useEffect(() => {
    if (visible) return;
    setQuery('');
    setResults([]);
  }, [visible]);

  // Debounced search (400ms) — searchSongs khud fallback chain chalata hai
  useEffect(() => {
    if (!visible) return;
    const q = query.trim();
    if (q.length === 0) {
      setResults([]);
      setSearching(false);
      return;
    }
    const timer = setTimeout(() => {
      setSearching(true);
      void searchSongs(q, 15)
        .then(found => setResults(found.filter(song => !song.previewOnly)))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 400);
    return () => clearTimeout(timer);
  }, [query, visible]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={{ ...typography.h1, color: colors.text }}>Add songs</Text>
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}>
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
        </View>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Search Punjabi songs…"
          placeholderTextColor={colors.subtext}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={Keyboard.dismiss}
        />
        {searching ? (
          <ActivityIndicator color={colors.primary} style={styles.spinner} />
        ) : (
          <FlatList
            data={results}
            keyExtractor={song => song.id}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Text style={styles.empty}>
                {query.trim().length === 0
                  ? (emptyHint ?? 'Upar search karo — full playable tracks add ho sakte hain.')
                  : 'Koi full-playable result nahi mila.'}
              </Text>
            }
            renderItem={({ item }) => (
              <View style={styles.row}>
                <Text style={styles.rowText} numberOfLines={1}>
                  {item.title} · {item.artist}
                </Text>
                <Pressable
                  onPress={() => {
                    setAddingId(item.id);
                    void onAdd(item).finally(() => setAddingId(null));
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.title} add karo`}
                  style={({ pressed }) => [styles.addButton, pressed && { opacity: 0.7 }]}
                >
                  {addingId === item.id ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Ionicons name="add" size={22} color={colors.primary} />
                  )}
                </Pressable>
              </View>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, paddingTop: spacing.xl },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  input: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.card,
    borderRadius: 10,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  spinner: { marginTop: spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  rowText: { ...typography.body, color: colors.text, flex: 1 },
  addButton: { padding: spacing.xs },
  empty: { ...typography.caption, color: colors.subtext, textAlign: 'center', padding: spacing.xl },
});

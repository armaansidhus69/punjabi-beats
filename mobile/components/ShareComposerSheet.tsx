/** Global signed-share composer (Phase 8c) — Share / Copy / QR. */

import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ShareQrModal from './ShareQrModal';
import { useShareComposer } from '../stores/shareComposerStore';
import type { ShareEntity } from '../core/share/share';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { spacing } from '../constants/spacing';

function entityLabel(entity: ShareEntity | null): string {
  if (!entity) return 'Punjabi Beats link';
  switch (entity.kind) {
    case 'track':
      return `${entity.data.title} — ${entity.data.artist}`;
    case 'playlist':
      return entity.data.name;
    case 'room':
      return entity.data.name ?? `Room ${entity.data.code}`;
    case 'blend':
      return entity.data.name ?? 'Punjabi Beats Blend';
    case 'jam':
      return entity.data.name ?? 'Punjabi Beats Jam';
    case 'lyrics':
      return `Lyrics: ${entity.data.title}`;
  }
}

export default function ShareComposerSheet() {
  const visible = useShareComposer(s => s.visible);
  const entity = useShareComposer(s => s.entity);
  const created = useShareComposer(s => s.created);
  const loading = useShareComposer(s => s.loading);
  const error = useShareComposer(s => s.error);
  const qrVisible = useShareComposer(s => s.qrVisible);
  const qrError = useShareComposer(s => s.qrError);
  const retryLink = useShareComposer(s => s.retryLink);
  const nativeShare = useShareComposer(s => s.nativeShare);
  const copyLink = useShareComposer(s => s.copyLink);
  const showQr = useShareComposer(s => s.showQr);
  const hideQr = useShareComposer(s => s.hideQr);
  const setQrError = useShareComposer(s => s.setQrError);
  const close = useShareComposer(s => s.close);

  const ready = created !== null;
  const label = entityLabel(entity);

  return (
    <>
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={close}
        statusBarTranslucent
      >
        <View style={styles.overlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel="Share options band karo"
          />
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <View style={styles.headerInfo}>
                <Text style={styles.title}>Share Punjabi Beats</Text>
                <Text style={styles.subtitle} numberOfLines={1}>{label}</Text>
              </View>
              <Pressable
                onPress={close}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Share options band karo"
                style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
              >
                <Ionicons name="close" size={22} color={colors.text} />
              </Pressable>
            </View>

            {loading ? (
              <View style={styles.statusRow}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.statusText}>Signed link ban raha hai…</Text>
              </View>
            ) : null}

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
                <Pressable
                  onPress={() => void retryLink()}
                  accessibilityRole="button"
                  accessibilityLabel="Signed link dobara banao"
                  style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
                >
                  <Ionicons name="refresh" size={16} color={colors.primary} />
                  <Text style={styles.retryText}>Retry</Text>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.actions}>
              <ActionButton
                icon="share-outline"
                label="Native Share"
                onPress={() => void nativeShare()}
              />
              <ActionButton
                icon="copy-outline"
                label="Copy Link"
                disabled={!ready}
                onPress={() => void copyLink()}
              />
              <ActionButton
                icon="qr-code-outline"
                label="Show QR"
                disabled={!ready}
                onPress={() => showQr()}
              />
            </View>

            {created ? (
              <Text style={styles.expiry}>
                Link expires {new Date(created.expiresAt).toLocaleDateString('en-IN')}
              </Text>
            ) : null}
            {qrError ? <Text style={styles.qrError}>{qrError}</Text> : null}
          </View>
        </View>
      </Modal>

      <ShareQrModal
        visible={visible && qrVisible}
        url={created?.url ?? ''}
        label={label}
        onClose={hideQr}
        onCopy={() => void copyLink()}
        onError={message => setQrError(message)}
      />
    </>
  );
}

function ActionButton({
  icon,
  label,
  disabled = false,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.actionButton,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <View style={styles.actionIcon}>
        <Ionicons name={icon} size={22} color={colors.primary} />
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.58)' },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  handle: { width: 44, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerInfo: { flex: 1 },
  title: { ...typography.h2, color: colors.text },
  subtitle: { ...typography.caption, color: colors.subtext },
  iconButton: { padding: spacing.xs },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusText: { ...typography.body, color: colors.subtext },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  errorText: { ...typography.caption, color: colors.subtext, flex: 1 },
  retryButton: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: spacing.xs },
  retryText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: spacing.sm },
  actionButton: { flex: 1, alignItems: 'center', gap: spacing.xs, minHeight: 88, justifyContent: 'center' },
  actionIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  actionLabel: { ...typography.caption, color: colors.text, textAlign: 'center' },
  expiry: { ...typography.caption, color: colors.subtext, textAlign: 'center' },
  qrError: { ...typography.caption, color: colors.primary, textAlign: 'center' },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.4 },
});

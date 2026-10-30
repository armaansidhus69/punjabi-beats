/** Phase 8c QR display — render-only, no gallery/filesystem permissions. */

import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { canRenderShareQr } from '../core/share/share';
import { colors } from '../constants/colors';
import { typography } from '../constants/typography';
import { spacing } from '../constants/spacing';

interface ShareQrModalProps {
  visible: boolean;
  url: string;
  label: string;
  onClose: () => void;
  onCopy: () => void;
  onError: (message: string) => void;
}

export default function ShareQrModal({
  visible,
  url,
  label,
  onClose,
  onCopy,
  onError,
}: ShareQrModalProps) {
  const canRender = visible && canRenderShareQr(url);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="QR band karo"
        />
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.headerInfo}>
              <Text style={styles.title}>Scan to open Punjabi Beats</Text>
              <Text style={styles.label} numberOfLines={1}>{label}</Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="QR band karo"
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
            >
              <Ionicons name="close" size={22} color={colors.text} />
            </Pressable>
          </View>

          {canRender ? (
            <View style={styles.qrWrap}>
              <QRCode
                value={url}
                size={220}
                ecl="L"
                quietZone={12}
                color="#0a0a0f"
                backgroundColor="#ffffff"
                onError={(error: unknown) =>
                  onError(error instanceof Error ? error.message : 'QR generate nahi hua')
                }
              />
            </View>
          ) : (
            <View style={styles.errorWrap}>
              <Ionicons name="warning-outline" size={36} color={colors.primary} />
              <Text style={styles.errorText}>Link QR ke liye invalid ya bahut lamba hai.</Text>
            </View>
          )}

          <Pressable
            onPress={onCopy}
            disabled={!canRender}
            accessibilityRole="button"
            accessibilityLabel="QR share link copy karo"
            style={({ pressed }) => [
              styles.copyButton,
              pressed && styles.pressed,
              !canRender && styles.disabled,
            ]}
          >
            <Ionicons name="copy-outline" size={18} color={colors.background} />
            <Text style={styles.copyText}>Copy Link</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.76)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 20,
    backgroundColor: colors.card,
    padding: spacing.lg,
    gap: spacing.lg,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerInfo: { flex: 1 },
  title: { ...typography.h2, color: colors.text },
  label: { ...typography.caption, color: colors.subtext, marginTop: 2 },
  closeButton: { padding: spacing.xs },
  qrWrap: { alignSelf: 'center', padding: spacing.sm, borderRadius: 14, backgroundColor: '#ffffff' },
  errorWrap: { height: 244, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  errorText: { ...typography.body, color: colors.subtext, textAlign: 'center' },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
  },
  copyText: { ...typography.body, color: colors.background, fontWeight: '700' },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.5 },
});

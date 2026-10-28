import type { ReactNode } from 'react'
import { Modal, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'

/** A bottom sheet over the screen: a title, what it asks, and its buttons as `children`. */
export function Sheet({ title, body, visible, onClose, children }: { title: string; body?: string; visible: boolean; onClose: () => void; children: ReactNode }) {
  const { colors, radii } = useTheme()
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: colors.backdrop }]}>
        <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: colors.surface, borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet }]}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
            {title}
          </Text>
          {body ? <Text style={{ color: colors.textStrong }}>{body}</Text> : null}
          {children}
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { gap: 12, padding: 20 },
  title: { fontSize: 18, fontWeight: '700' },
})

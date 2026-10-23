import { Pressable, StyleSheet, Text, View } from 'react-native'
import { t } from '../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from './Button'

type Props = { failed: boolean; label: string; busy: boolean; onDiscard: () => void; onSave: () => void }

// The bar that appears once there is something to save (CatEditor's dirty bar): Discard and Save, or why the last save didn't
// go. Save is off while the phone is offline or the store is view-only (Button `saves`).
export function SaveBar({ failed, label, busy, onDiscard, onSave }: Props) {
  const { colors } = useTheme()
  return (
    <View style={[styles.bar, { backgroundColor: colors.side }]}>
      <View style={styles.message}>
        <View style={[styles.dot, { backgroundColor: failed ? colors.link : colors.brand }]} />
        <Text accessibilityLiveRegion="polite" style={[styles.text, { color: colors.sideText }]}>
          {failed ? t('products.bar.failed') : t('products.bar.unsaved')}
        </Text>
        <Pressable accessibilityRole="button" onPress={onDiscard} disabled={busy} style={styles.discard}>
          <Text style={{ color: colors.sideText, fontSize: 14, fontWeight: '600' }}>{t('products.bar.discard')}</Text>
        </Pressable>
      </View>
      <Button label={label} onPress={onSave} busy={busy} saves />
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { padding: 12, gap: 10 },
  message: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { flex: 1, fontSize: 14, fontWeight: '600' },
  discard: { minHeight: 44, minWidth: 64, alignItems: 'center', justifyContent: 'center' },
})

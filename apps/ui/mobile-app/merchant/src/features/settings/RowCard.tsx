import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'

export type Tone = 'ok' | 'wait' | 'off' | 'plain'

type Props = {
  title: string
  sub?: string | undefined
  /** The value or status on the right, with a second line under it. */
  value?: string | undefined
  status?: string | undefined
  tone?: Tone
  onPress?: (() => void) | null
  accessibilityLabel?: string
}

// A list's stacked card (DESIGN.md §4): the name, a muted second line, and the value or status on the right. Pressable when it opens a menu.
export function RowCard({ title, sub, value, status, tone = 'plain', onPress = null, accessibilityLabel }: Props) {
  const { colors, radii } = useTheme()
  const toneColour = tone === 'ok' ? colors.success : tone === 'wait' ? colors.warning : tone === 'off' ? colors.muted : colors.muted
  const body = (
    <>
      <View style={styles.text}>
        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
        {sub ? <Text style={[styles.sub, { color: colors.muted }]}>{sub}</Text> : null}
      </View>
      <View style={styles.right}>
        {value ? <Text style={[styles.value, { color: colors.text }]}>{value}</Text> : null}
        {status ? <Text style={[styles.status, { color: toneColour }]}>{status}</Text> : null}
      </View>
    </>
  )
  const frame = [styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]
  if (onPress === null) return <View style={frame}>{body}</View>
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title} onPress={onPress} style={({ pressed }) => [...frame, pressed ? { backgroundColor: colors.hover } : null]}>
      {body}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: { minHeight: 64, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 15, fontWeight: '700' },
  sub: { fontSize: 13, lineHeight: 18 },
  right: { alignItems: 'flex-end', gap: 2, maxWidth: '45%' },
  value: { fontSize: 14, fontWeight: '700' },
  status: { fontSize: 12, fontWeight: '700' },
})

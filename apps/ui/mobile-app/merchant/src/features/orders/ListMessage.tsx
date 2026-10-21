import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../theme'

// The list's empty states: a store with no orders yet, and a search or filter that matches none.
export function ListMessage({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  const { colors, radii } = useTheme()
  return (
    <View style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
        {title}
      </Text>
      <Text style={[styles.body, { color: colors.muted }]}>{body}</Text>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, padding: 24, gap: 12 },
  title: { fontSize: 20, fontWeight: '800' },
  body: { fontSize: 14, lineHeight: 21 },
})

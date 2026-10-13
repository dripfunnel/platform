import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../theme'

export function SectionCard({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  const { colors, radii } = useTheme()
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
          {title}
        </Text>
        {sub ? <Text style={[styles.sub, { color: colors.muted }]}>{sub}</Text> : null}
      </View>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, padding: 16, gap: 14 },
  head: { gap: 2 },
  title: { fontSize: 17, fontWeight: '800' },
  sub: { fontSize: 13, lineHeight: 19 },
})

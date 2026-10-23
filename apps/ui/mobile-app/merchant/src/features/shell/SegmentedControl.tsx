import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'

export type Segment<K extends string> = { key: K; label: string }

// Two or three views of one area (DESIGN.md §2): Catalogue's Products | Collections. 36 tall inside a 3-px track.
export function SegmentedControl<K extends string>({ segments, value, onChange }: { segments: readonly Segment<K>[]; value: K; onChange: (key: K) => void }) {
  const { colors } = useTheme()
  return (
    <View accessibilityRole="tablist" style={[styles.track, { backgroundColor: colors.neutralSurface }]}>
      {segments.map((segment) => {
        const selected = segment.key === value
        return (
          <Pressable
            key={segment.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(segment.key)}
            style={[styles.segment, selected && { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }]}
          >
            <Text style={[styles.label, { color: selected ? colors.heading : colors.muted }]}>{segment.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', padding: 3, gap: 3, borderRadius: 12, marginHorizontal: 16, marginTop: 12, marginBottom: 4 },
  segment: { flex: 1, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 9 },
  label: { fontSize: 14, fontWeight: '700' },
})

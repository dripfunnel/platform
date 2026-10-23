import { Pressable, ScrollView, StyleSheet, Text } from 'react-native'
import { t } from '../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'

export const areaTabs = ['collections', 'filters', 'menus', 'sizeCharts'] as const
export type AreaTab = (typeof areaTabs)[number]

// The four parts of CatCollections as its tab bar draws them at phone width: an underline under the one open, scrolling if the
// labels don't fit.
export function AreaTabs({ value, onChange }: { value: AreaTab; onChange: (tab: AreaTab) => void }) {
  const { colors } = useTheme()
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist" accessibilityLabel={t('collections.tabs.label')} style={[styles.bar, { backgroundColor: colors.surface, borderColor: colors.border }]} contentContainerStyle={styles.content}>
      {areaTabs.map((tab) => {
        const selected = tab === value
        return (
          <Pressable key={tab} accessibilityRole="tab" accessibilityState={{ selected }} onPress={() => onChange(tab)} style={[styles.tab, { borderBottomColor: selected ? colors.brand : 'transparent' }]}>
            <Text style={[styles.label, { color: selected ? colors.text : colors.muted, fontWeight: selected ? '700' : '500' }]}>{t(`collections.tabs.${tab}`)}</Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  bar: { flexGrow: 0, borderBottomWidth: 1, marginTop: 8 },
  content: { paddingHorizontal: 16, gap: 22 },
  tab: { height: 48, justifyContent: 'center', borderBottomWidth: 3 },
  label: { fontSize: 14 },
})

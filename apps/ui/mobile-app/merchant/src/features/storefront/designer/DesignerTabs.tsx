import { Pressable, ScrollView, StyleSheet, Text } from 'react-native'
import { t } from '../../../messages'
import { useTheme } from '../../../theme'

export const designerTabs = ['design', 'pages', 'journal', 'settings'] as const
export type DesignerTab = (typeof designerTabs)[number]

// PortalStorefront's tab bar at phone width: an underline under the open one, scrolling if the labels don't fit.
export function DesignerTabs({ value, onChange }: { value: DesignerTab; onChange: (tab: DesignerTab) => void }) {
  const { colors } = useTheme()
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist" accessibilityLabel={t('storefront.tabs.label')} style={[styles.bar, { backgroundColor: colors.surface, borderColor: colors.border }]} contentContainerStyle={styles.content}>
      {designerTabs.map((tab) => {
        const selected = tab === value
        return (
          <Pressable key={tab} accessibilityRole="tab" accessibilityState={{ selected }} onPress={() => onChange(tab)} style={[styles.tab, { borderBottomColor: selected ? colors.brand : 'transparent' }]}>
            <Text style={[styles.label, { color: selected ? colors.text : colors.muted, fontWeight: selected ? '700' : '500' }]}>{t(`storefront.tabs.${tab}`)}</Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  bar: { flexGrow: 0, borderBottomWidth: 1 },
  content: { paddingHorizontal: 16, gap: 22 },
  tab: { height: 48, justifyContent: 'center', borderBottomWidth: 3 },
  label: { fontSize: 14 },
})

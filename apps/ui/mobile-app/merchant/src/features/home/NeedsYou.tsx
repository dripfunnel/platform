import { Pressable, StyleSheet, Text, View } from 'react-native'
import { formatNumber } from '../../format'
import { locale, t } from '../../messages'
import { useTheme } from '../../theme'
import { Eyebrow } from '../common/Eyebrow'
import { Icon } from '../shell/Icon'
import type { Need } from './homeView'

// "Needs you": what waits, each with its count, opening the list that holds it (DESIGN.md §3). The caller says what to draw when nothing waits.
export function NeedsYou({ needs, onOpen }: { needs: readonly Need[]; onOpen: (href: string) => void }) {
  const { colors, radii } = useTheme()
  return (
    <View style={styles.group}>
      <Eyebrow text={t('home.needsYou')} />
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
        {needs.map((need, index) => (
          <Pressable
            key={need.key}
            accessibilityRole="button"
            accessibilityLabel={t('home.need.open', { label: need.label, count: formatNumber(need.count, locale) })}
            onPress={() => onOpen(need.href)}
            style={[styles.row, index > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
          >
            <View style={[styles.count, { backgroundColor: colors.warningSurface }]}>
              <Text style={[styles.countText, { color: colors.warning }]}>{formatNumber(need.count, locale)}</Text>
            </View>
            <View style={styles.text}>
              <Text style={[styles.label, { color: colors.text }]}>{need.label}</Text>
              {need.sub ? (
                <Text numberOfLines={1} style={[styles.sub, { color: colors.muted }]}>
                  {need.sub}
                </Text>
              ) : null}
            </View>
            <Icon name="chevron" size={16} color={colors.muted} />
          </Pressable>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  card: { borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingHorizontal: 14, paddingVertical: 10 },
  count: { minWidth: 36, height: 36, paddingHorizontal: 8, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  countText: { fontSize: 16, fontWeight: '800' },
  text: { flex: 1, gap: 2 },
  label: { fontSize: 15, fontWeight: '700' },
  sub: { fontSize: 12 },
})

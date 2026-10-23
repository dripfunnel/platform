import { Pressable, StyleSheet, Text, View } from 'react-native'
import { formatNumber } from '@dripfunnel/mobile-shared/format'
import { locale, t } from '../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { setupCount, type SetupItem } from './homeView'

type Props = { items: readonly SetupItem[]; onOpen: (href: string) => void }

// "Get your shop ready for its first order" (PortalHome's checklist): each line opens where it is done, and the list goes with the first order.
export function SetupChecklist({ items, onOpen }: Props) {
  const { colors, radii } = useTheme()
  const { done, total } = setupCount(items)
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
          {t('home.setup.title')}
        </Text>
        <Text style={[styles.progress, { color: colors.muted }]}>{t('home.setup.progress', { done: formatNumber(done, locale), total: formatNumber(total, locale) })}</Text>
      </View>
      <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: done }} style={[styles.track, { backgroundColor: colors.neutralSurface }]}>
        <View style={[styles.fill, { backgroundColor: colors.brand, width: `${total > 0 ? (done / total) * 100 : 0}%` }]} />
      </View>
      {items.map((item) => {
        const label = t(`home.setup.${item.key}.label`)
        const cta = item.done && item.key !== 'locale' ? t('home.setup.done') : t(`home.setup.${item.key}.cta`)
        return (
          <Pressable key={item.key} accessibilityRole="button" accessibilityLabel={t('home.setup.open', { label, state: cta })} onPress={() => onOpen(item.href)} style={[styles.row, { borderTopColor: colors.border }]}>
            <View style={[styles.mark, { borderColor: item.done ? colors.success : colors.fieldBorder, backgroundColor: item.done ? colors.success : colors.surface }]}>
              {item.done ? <Text style={[styles.tick, { color: colors.surface }]}>✓</Text> : null}
            </View>
            <View style={styles.text}>
              <Text style={[styles.label, { color: colors.text }, item.done && styles.struck]}>{label}</Text>
              {item.note ? <Text style={[styles.note, { color: colors.muted }]}>{item.note}</Text> : null}
            </View>
            <Text style={[styles.cta, { color: colors.link }]}>{cta}</Text>
          </Pressable>
        )
      })}
      <Text style={[styles.note, { color: colors.muted }]}>{t('home.setup.footer')}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, padding: 16, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  title: { flex: 1, fontSize: 17, fontWeight: '800' },
  progress: { fontSize: 12, fontFamily: 'monospace' },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 8, borderTopWidth: 1 },
  mark: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  tick: { fontSize: 12, fontWeight: '800' },
  text: { flex: 1, gap: 2 },
  label: { fontSize: 14 },
  struck: { textDecorationLine: 'line-through' },
  note: { fontSize: 12 },
  cta: { fontSize: 13, fontWeight: '700' },
})

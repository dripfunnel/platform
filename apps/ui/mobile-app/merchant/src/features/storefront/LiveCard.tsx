import { Pressable, StyleSheet, Text, View } from 'react-native'
import { t } from '../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'

type Props = { host: string | null; live: boolean; lastChange: string | null; onView: () => void }

// The live shop as `sfApp` draws it: its address, a Live pill, the last change and View, which opens the address in the browser.
export function LiveCard({ host, live, lastChange, onView }: Props) {
  const { colors, radii } = useTheme()
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
      <View style={styles.text}>
        <View style={styles.name}>
          <Text style={[styles.host, { color: colors.heading }]}>{host ?? t('storefront.yourShop')}</Text>
          {live ? (
            <View style={[styles.pill, { backgroundColor: colors.successSurface }]}>
              <Text style={[styles.pillText, { color: colors.success }]}>{t('storefront.live')}</Text>
            </View>
          ) : null}
        </View>
        <Text numberOfLines={1} style={[styles.sub, { color: colors.muted }]}>
          {live ? lastChange : t('storefront.notPublished')}
        </Text>
      </View>
      {live && host ? (
        <Pressable accessibilityRole="button" onPress={onView} style={[styles.view, { borderColor: colors.fieldBorder, borderRadius: radii.button }]}>
          <Text style={[styles.viewText, { color: colors.text }]}>{t('storefront.view')}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  name: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  host: { fontSize: 15, fontWeight: '700' },
  pill: { height: 22, paddingHorizontal: 9, borderRadius: 11, justifyContent: 'center' },
  pillText: { fontSize: 12, fontWeight: '600' },
  sub: { fontSize: 12 },
  view: { minHeight: 44, minWidth: 64, paddingHorizontal: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  viewText: { fontSize: 14, fontWeight: '600' },
})

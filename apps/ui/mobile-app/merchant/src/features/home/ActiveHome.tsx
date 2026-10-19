import { StyleSheet, Text, View } from 'react-native'
import type { StoreHome } from '../../api/home'
import { t } from '../../messages'
import { useTheme } from '../../theme'
import { Button } from '../common/Button'
import { headlineOf, needsOf } from './homeView'
import { LatestOrders } from './LatestOrders'
import { NeedsYou } from './NeedsYou'

type Props = { home: StoreHome; canAdd: boolean; onOpen: (href: string) => void; onAddProduct: () => void; onOpenOrder: (id: string) => void; onSeeOrders: () => void }

// Home for a store with activity (`homeApp`, DESIGN.md §3): the big number, Needs you, Add a product, and the newest orders.
export function ActiveHome({ home, canAdd, onOpen, onAddProduct, onOpenOrder, onSeeOrders }: Props) {
  const { colors, radii } = useTheme()
  const headline = headlineOf(home)
  const needs = needsOf(home)
  return (
    <View style={styles.screen}>
      <View accessibilityLabel={`${headline.label}: ${headline.figures.join(', ')}. ${headline.sub}`} accessible style={styles.headline}>
        <Text style={[styles.label, { color: colors.muted }]}>{headline.label}</Text>
        {headline.figures.map((figure) => (
          <Text key={figure} style={[styles.big, { color: colors.heading }]}>
            {figure}
          </Text>
        ))}
        <Text style={[styles.label, { color: colors.muted }]}>{headline.sub}</Text>
      </View>

      {needs.length > 0 ? (
        <NeedsYou needs={needs} onOpen={onOpen} />
      ) : (
        <View accessibilityRole="summary" style={[styles.clear, { backgroundColor: colors.successSurface, borderRadius: radii.card }]}>
          <Text style={[styles.clearText, { color: colors.success }]}>
            <Text style={styles.strong}>{t('home.allClear.title')}</Text> {t('home.allClear.body')}
          </Text>
        </View>
      )}

      {canAdd ? <Button label={t('home.addProduct')} onPress={onAddProduct} /> : null}

      {home.latestOrders.length > 0 ? <LatestOrders orders={home.latestOrders} onOpen={onOpenOrder} onSeeAll={onSeeOrders} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { padding: 16, paddingBottom: 28, gap: 22 },
  headline: { gap: 2 },
  label: { fontSize: 13 },
  big: { fontSize: 38, fontWeight: '800', letterSpacing: -1.1, lineHeight: 42 },
  clear: { padding: 16 },
  clearText: { fontSize: 14, lineHeight: 21 },
  strong: { fontWeight: '800' },
})

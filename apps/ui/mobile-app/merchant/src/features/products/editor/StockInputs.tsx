import { StyleSheet, Text, View } from 'react-native'
import { t } from '../../../messages'
import { tCount } from '../../../messages/plural'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { LinkButton } from '../../common/LinkButton'
import { CompactField } from './CompactField'
import { quantityOf, versionKey, type Draft, type DraftVersion } from './draft'
import { levelsOf, otherLevels, type StockContext } from './stock'

type Props = {
  draft: Draft
  update: (change: (draft: Draft) => Draft) => void
  version: DraftVersion
  stock: StockContext
  onAdjust: (version: DraftVersion) => void
}

// One version's counts at each of the seat's locations (CATALOG-DESIGN.md G1–G3): a typed number is saved with the product;
// "Change with a reason" is applied at once and shows in the history. What is reserved for orders is the API's figure.
export function StockInputs({ draft, update, version, stock, onAdjust }: Props) {
  const { colors } = useTheme()
  const key = versionKey(version.choices)
  const levels = levelsOf(stock, version.id)
  const reserved = levels.reduce((sum, level) => sum + level.reserved, 0)
  if (version.carry.trackStock === false) return <Text style={[styles.note, { color: colors.muted }]}>{t('products.stock.untracked')}</Text>
  if (stock.warehouses.length === 0) return <Text style={[styles.note, { color: colors.muted }]}>{t('products.stock.noWarehouse')}</Text>
  const several = stock.warehouses.length > 1
  return (
    <View style={styles.block}>
      {stock.warehouses.map((warehouse) => {
        const value = draft.stock[key]?.[warehouse.id] ?? ''
        const name = version.choices.length > 0 ? version.choices.join(' / ') : t('products.stock.thisProduct')
        return (
          <View key={warehouse.id} style={styles.row}>
            <Text style={[styles.where, { color: colors.text }]}>{several ? warehouse.name : t('products.stock.title')}</Text>
            <View style={styles.input}>
              <CompactField
                label={t('products.stock.label', { warehouse: warehouse.name, name })}
                value={value}
                keyboardType="number-pad"
                editable={stock.canStock}
                invalid={quantityOf(value) === 'invalid'}
                placeholder={t('products.stock.countPlaceholder')}
                onChangeText={(text) => update((d) => ({ ...d, stock: { ...d.stock, [key]: { ...d.stock[key], [warehouse.id]: text.replace(/[^0-9]/g, '') } } }))}
              />
            </View>
          </View>
        )
      })}
      {otherLevels(stock, version.id).map((level) => (
        <Text key={level.warehouseId} style={[styles.note, { color: colors.muted }]}>
          {t('products.stock.elsewhere', { warehouse: level.warehouseName, count: level.onHand })}
        </Text>
      ))}
      {reserved > 0 ? <Text style={[styles.reserved, { color: colors.info, backgroundColor: colors.infoSurface }]}>{tCount('products.stock.reserved', reserved)}</Text> : null}
      {stock.canStock && version.id ? <LinkButton label={t('products.stock.adjust')} onPress={() => onAdjust(version)} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  block: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  where: { flex: 1, fontSize: 14 },
  input: { width: 120 },
  note: { fontSize: 13, lineHeight: 19 },
  reserved: { fontSize: 13, lineHeight: 19, padding: 8, borderRadius: 8, overflow: 'hidden' },
})

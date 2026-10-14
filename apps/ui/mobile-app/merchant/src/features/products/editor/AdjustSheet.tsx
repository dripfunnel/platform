import { useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { adjustReasons, type AdjustReason, type Warehouse } from '../../../api/inventory'
import { t } from '../../../messages'
import { errorMessage } from '../../../messages/errorMessage'
import { useTheme } from '../../../theme'
import { Button } from '../../common/Button'
import { SheetFrame } from '../../shell/BottomSheet'
import { ChoiceRow } from './ChoiceRow'

type Props = {
  /** What is being counted, such as "Sand / M". */
  name: string
  warehouses: readonly Warehouse[]
  onApply: (change: { warehouse: Warehouse; delta: number; reason: AdjustReason }) => Promise<void>
  onClose: () => void
}

/** "+20", "−2" or "-2" as a whole number of units; zero and anything else are not a change. */
export const deltaOf = (text: string): number | null => {
  const match = /^([+\-−]?)\s*(\d{1,7})$/.exec(text.trim())
  if (!match) return null
  const amount = Number(match[2])
  return amount === 0 ? null : match[1] === '' || match[1] === '+' ? amount : -amount
}

// "Change stock with a reason" (CATALOG-DESIGN.md G4): a number, a reason and, with several locations, which one. It is applied
// at once, apart from the rest of the product, and then shown in the stock history.
export function AdjustSheet({ name, warehouses, onApply, onClose }: Props) {
  const { colors, radii } = useTheme()
  const [reason, setReason] = useState<AdjustReason>('counted')
  const [warehouseId, setWarehouseId] = useState(warehouses.find((warehouse) => warehouse.isDefault)?.id ?? warehouses[0]?.id ?? '')
  const [text, setText] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const apply = async () => {
    const delta = deltaOf(text)
    const warehouse = warehouses.find((candidate) => candidate.id === warehouseId)
    if (delta === null || !warehouse) {
      setProblem(t('products.stock.adjustCountError'))
      return
    }
    setBusy(true)
    try {
      await onApply({ warehouse, delta, reason })
      onClose()
    } catch (error) {
      setProblem(errorMessage(error, 'products'))
      setBusy(false)
    }
  }

  return (
    <SheetFrame onClose={onClose}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
        {t('products.stock.adjustTitle')}
      </Text>
      <Text style={[styles.body, { color: colors.textStrong }]}>{t('products.stock.adjustBody', { name })}</Text>
      {warehouses.length > 1 ? (
        <View style={styles.group}>
          <Text style={[styles.label, { color: colors.text }]}>{t('products.stock.adjustWhere')}</Text>
          {warehouses.map((warehouse) => (
            <ChoiceRow key={warehouse.id} label={warehouse.name} selected={warehouse.id === warehouseId} onPress={() => setWarehouseId(warehouse.id)} />
          ))}
        </View>
      ) : null}
      <View style={styles.group}>
        <Text style={[styles.label, { color: colors.text }]}>{t('products.stock.adjustReason')}</Text>
        {adjustReasons.map((key) => (
          <ChoiceRow key={key} label={t(`products.stock.reasons.${key}`)} selected={key === reason} onPress={() => setReason(key)} />
        ))}
      </View>
      <View style={styles.group}>
        <Text style={[styles.label, { color: colors.text }]}>{t('products.stock.adjustCount')}</Text>
        <TextInput
          accessibilityLabel={t('products.stock.adjustCount')}
          value={text}
          onChangeText={(value) => {
            setText(value)
            setProblem(null)
          }}
          keyboardType="numbers-and-punctuation"
          placeholder={t('products.stock.adjustPlaceholder')}
          placeholderTextColor={colors.muted}
          autoCorrect={false}
          style={[styles.input, { color: colors.text, borderColor: problem ? colors.danger : colors.fieldBorder, borderRadius: radii.button }]}
        />
        {problem ? (
          <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 13 }}>
            {problem}
          </Text>
        ) : null}
      </View>
      <View style={styles.buttons}>
        <Button label={t('products.stock.adjustApply')} onPress={() => void apply()} busy={busy} saves />
        <Button kind="secondary" label={t('common.cancel')} onPress={onClose} />
      </View>
    </SheetFrame>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 19, fontWeight: '800', lineHeight: 25 },
  body: { fontSize: 14, lineHeight: 22 },
  group: { gap: 8 },
  label: { fontSize: 14, fontWeight: '700' },
  input: { minHeight: 50, borderWidth: 1.5, paddingHorizontal: 14, fontSize: 16 },
  buttons: { gap: 8, paddingTop: 4 },
})

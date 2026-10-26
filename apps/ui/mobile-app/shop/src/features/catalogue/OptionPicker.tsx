import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import type { Product } from '../../api/catalogue'
import { t } from '../../messages'
import { valueState, type Selection } from './options'

/** Each option as a row of values. A value no version has with the other choices is disabled; a sold-out one stays choosable, struck through. */
export function OptionPicker({ product, selection, onChoose }: { product: Pick<Product, 'options' | 'versions'>; selection: Selection; onChoose: (optionId: string, valueId: string) => void }) {
  const { colors, radii } = useTheme()
  return (
    <>
      {product.options.map((option) => {
        const chosen = option.values.find((value) => value.id === selection[option.id])
        return (
          <View key={option.id} accessibilityRole="radiogroup" accessibilityLabel={option.name} style={styles.group}>
            <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>
              {option.name}: <Text style={{ fontWeight: '500', color: colors.textStrong }}>{chosen?.name ?? t('product.choose')}</Text>
            </Text>
            <View style={styles.values}>
              {option.values.map((value) => {
                const state = valueState(product, selection, option.id, value.id)
                const on = selection[option.id] === value.id
                const disabled = state === 'disabled'
                const soldOut = state === 'soldOut'
                return (
                  <Pressable
                    key={value.id}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on, disabled }}
                    accessibilityLabel={soldOut ? t('product.valueSoldOut', { value: value.name }) : disabled ? t('product.valueUnavailable', { value: value.name }) : value.name}
                    disabled={disabled}
                    onPress={() => onChoose(option.id, value.id)}
                    style={[
                      styles.value,
                      {
                        borderRadius: radii.button,
                        borderStyle: soldOut && !on ? 'dashed' : 'solid',
                        borderColor: on ? colors.brand : disabled ? colors.border : colors.fieldBorder,
                        backgroundColor: on ? colors.brand : colors.surface,
                      },
                    ]}
                  >
                    <Text style={{ color: on ? colors.brandContrast : disabled ? colors.muted : colors.text, fontWeight: '700', fontSize: 15, textDecorationLine: soldOut || disabled ? 'line-through' : 'none' }}>
                      {value.name}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          </View>
        )
      })}
    </>
  )
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  values: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  value: { minWidth: 54, minHeight: 44, paddingHorizontal: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
})

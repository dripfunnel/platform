import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { OfferIdNames } from '../../../api/offers'
import { t } from '../../../messages'
import { useTheme } from '../../../theme'
import type { Amounts, Field, OfferDraft, StoreFacts } from '../offerDraft'
import { convertedText } from '../offerDraft'
import type { RegionWords } from '../offerView'
import { TextField } from '../../common/TextField'

/** What every section of the form is given: the draft and how to change it, what is wrong with it, and what the store is. */
export type SectionProps = {
  draft: OfferDraft
  set: (patch: Partial<OfferDraft>) => void
  errors: Partial<Record<Field, string>>
  facts: StoreFacts
  region: RegionWords
  disabled: boolean
}

export function Wrap({ children }: { children: ReactNode }) {
  return <View style={styles.wrap}>{children}</View>
}

/** What is wrong with a field, said under it, and announced to a screen reader as it appears. */
export function Problem({ text }: { text: string | undefined }) {
  const { colors } = useTheme()
  return text ? (
    <Text accessibilityRole="alert" style={[styles.problem, { color: colors.danger }]}>
      {text}
    </Text>
  ) : null
}

export function Hint({ text }: { text: string }) {
  const { colors } = useTheme()
  return <Text style={[styles.hint, { color: colors.muted }]}>{text}</Text>
}

export function Label({ text }: { text: string }) {
  const { colors } = useTheme()
  return <Text style={[styles.label, { color: colors.text }]}>{text}</Text>
}

const digits = (text: string) => text.replace(/\D/g, '')
const decimal = (text: string) => text.replace(/[^\d.,]/g, '')

/** A whole number typed in a box: digits only. */
export function WholeField({ label, value, onChange, invalid, disabled, help, maxLength }: { label: string; value: string; onChange: (value: string) => void; invalid?: boolean; disabled: boolean; help?: string; maxLength?: number }) {
  return <TextField label={label} value={value} onChangeText={(text) => onChange(digits(text))} keyboardType="number-pad" editable={!disabled} invalid={invalid === true} help={help} {...(maxLength ? { maxLength } : {})} />
}

/** An amount typed in major units of one currency. */
export function MoneyField({ label, value, onChange, invalid, disabled, placeholder, help }: { label: string; value: string; onChange: (value: string) => void; invalid?: boolean; disabled: boolean; placeholder?: string; help?: string }) {
  return <TextField label={label} value={value} onChangeText={(text) => onChange(decimal(text))} keyboardType="decimal-pad" editable={!disabled} invalid={invalid === true} help={help} {...(placeholder ? { placeholder } : {})} />
}

/** One money box per currency the store sells in: the main one typed, the others pre-filled by conversion and editable. */
export function AmountFields({ label, value, onChange, facts, invalid, disabled }: { label: string; value: Amounts; onChange: (value: Amounts) => void; facts: StoreFacts; invalid: boolean; disabled: boolean }) {
  return (
    <>
      <MoneyField label={`${label} (${facts.main})`} value={value[facts.main] ?? ''} onChange={(text) => onChange({ ...value, [facts.main]: text })} invalid={invalid} disabled={disabled} />
      {facts.others.length > 0 ? (
        <View style={styles.others}>
          <Label text={t('offers.editor.otherCurrencies')} />
          {facts.others.map((currency) => (
            <MoneyField
              key={currency}
              label={t('offers.editor.amountIn', { currency })}
              value={value[currency] ?? ''}
              onChange={(text) => onChange({ ...value, [currency]: text })}
              disabled={disabled}
              placeholder={convertedText(value[facts.main] ?? '', facts, currency) ?? ''}
            />
          ))}
          <Hint text={t('offers.editor.otherCurrenciesHelp')} />
        </View>
      ) : null}
    </>
  )
}

type ChipsProps = { ids: readonly string[]; names: OfferIdNames; onRemove: (id: string) => void; disabled: boolean }

/** What an offer names, by name, each removable; one that's no longer in the shop says so and must be removed before a save. */
export function IdChips({ ids, names, onRemove, disabled }: ChipsProps) {
  const { colors } = useTheme()
  return (
    <Wrap>
      {ids.map((id) => {
        const gone = !names.has(id)
        const name = gone ? t('offers.editor.gone') : (names.get(id) ?? t('offers.editor.unnamed'))
        return (
          <Pressable
            key={id}
            accessibilityRole="button"
            accessibilityLabel={t('offers.editor.remove', { name })}
            disabled={disabled}
            onPress={() => onRemove(id)}
            style={[styles.chip, { borderColor: gone ? colors.dangerBorder : colors.fieldBorder, backgroundColor: gone ? colors.dangerSurface : colors.surface }]}
          >
            <Text style={[styles.chipText, { color: gone ? colors.danger : colors.text }]}>{name}</Text>
            {disabled ? null : <Text style={[styles.chipText, { color: colors.muted }]}>{t('offers.editor.removeGlyph')}</Text>}
          </Pressable>
        )
      })}
    </Wrap>
  )
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  problem: { fontSize: 13, lineHeight: 18 },
  hint: { fontSize: 13, lineHeight: 19 },
  label: { fontSize: 14, fontWeight: '700' },
  others: { gap: 10 },
  chip: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, borderWidth: 1, borderRadius: 22 },
  chipText: { fontSize: 14, fontWeight: '600' },
})

import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { t } from '../../../messages'
import { ChoiceRow } from '../../common/ChoiceRow'
import { LinkButton } from '../../common/LinkButton'
import { Switch } from '../../common/Switch'
import { TextField } from '../../common/TextField'
import { newPrice, type PriceDraft, type PriceMode, type QuestionKind } from './questions'

type Props = {
  price: PriceDraft | null
  onChange: (price: PriceDraft | null) => void
  /** Per character is for a text question only. */
  kind: QuestionKind
  /** What the price is for, in the links' accessibility names ("Add a price to Olives"). */
  name: string
  currency: string
  versions: readonly { key: string; label: string }[]
  invalid: boolean
  disabled: boolean
}

// A price only when asked (CATALOG-DESIGN U7): Free and "Add a price", then the amount, per item or once, and a version's own amount.
export function QuestionPrice({ price, onChange, kind, name, currency, versions, invalid, disabled }: Props) {
  const { colors } = useTheme()
  const [byVersion, setByVersion] = useState(() => Object.keys(price?.byVersion ?? {}).length > 0)
  if (!price) {
    return (
      <View style={styles.free}>
        <Text style={[styles.note, { color: colors.muted }]}>{t('products.questions.price.free')}</Text>
        {disabled ? null : <LinkButton label={t('products.questions.price.add')} accessibilityLabel={t('products.questions.price.addTo', { name })} onPress={() => onChange(newPrice())} />}
      </View>
    )
  }
  const set = (change: Partial<PriceDraft>) => onChange({ ...price, ...change })
  const modes: PriceMode[] = kind === 'TEXT' ? ['FIXED', 'PERCENT', 'PER_CHARACTER'] : ['FIXED', 'PERCENT']
  return (
    <View style={[styles.box, { borderColor: invalid ? colors.danger : colors.border }]}>
      <Text style={[styles.heading, { color: colors.text }]}>{t('products.questions.price.title', { name })}</Text>
      {modes.map((mode) => (
        <ChoiceRow key={mode} label={t(`products.questions.price.modes.${mode}`)} selected={price.mode === mode} disabled={disabled} onPress={() => set({ mode })} />
      ))}
      {price.mode === 'PERCENT' ? (
        <TextField label={t('products.questions.price.percent')} value={price.percent} onChangeText={(percent) => set({ percent })} keyboardType="decimal-pad" invalid={invalid} editable={!disabled} />
      ) : (
        <TextField
          label={t(price.mode === 'PER_CHARACTER' ? 'products.questions.price.perCharacter' : 'products.questions.price.amount', { currency })}
          help={price.mode === 'PER_CHARACTER' ? t('products.questions.price.perCharacterHelp') : undefined}
          value={price.amount}
          onChangeText={(amount) => set({ amount })}
          keyboardType="decimal-pad"
          invalid={invalid}
          editable={!disabled}
        />
      )}
      {invalid ? (
        <Text accessibilityRole="alert" style={[styles.note, { color: colors.danger }]}>
          {price.mode === 'PERCENT' ? t('products.questions.problem.percent') : t('products.questions.problem.price', { currency })}
        </Text>
      ) : null}
      <Text style={[styles.heading, { color: colors.text }]}>{t('products.questions.price.when')}</Text>
      <ChoiceRow label={t('products.questions.price.perItem')} selected={price.per === 'ITEM'} disabled={disabled} onPress={() => set({ per: 'ITEM' })} />
      <ChoiceRow label={t('products.questions.price.perLine')} selected={price.per === 'LINE'} disabled={disabled} onPress={() => set({ per: 'LINE' })} />
      {price.mode === 'FIXED' && versions.length > 1 ? (
        <>
          <Switch
            label={t('products.questions.price.byVersion')}
            value={byVersion}
            disabled={disabled}
            onChange={(on) => {
              setByVersion(on)
              if (!on) set({ byVersion: {} })
            }}
          />
          {byVersion
            ? versions.map((v) => (
                <TextField
                  key={v.key}
                  label={t('products.questions.price.versionAmount', { version: v.label, currency })}
                  value={price.byVersion[v.key] ?? ''}
                  placeholder={price.amount}
                  onChangeText={(typed) => set({ byVersion: { ...price.byVersion, [v.key]: typed } })}
                  keyboardType="decimal-pad"
                  editable={!disabled}
                />
              ))
            : null}
        </>
      ) : null}
      {price.manual.length > 0 ? <Text style={[styles.note, { color: colors.muted }]}>{t('products.questions.price.manual')}</Text> : null}
      {disabled ? null : <LinkButton label={t('products.questions.price.remove')} accessibilityLabel={t('products.questions.price.removeFrom', { name })} onPress={() => onChange(null)} />}
    </View>
  )
}

const styles = StyleSheet.create({
  free: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  box: { gap: 8, borderWidth: 1, borderRadius: 10, padding: 12 },
  heading: { fontSize: 14, fontWeight: '700' },
  note: { fontSize: 13, lineHeight: 18 },
})

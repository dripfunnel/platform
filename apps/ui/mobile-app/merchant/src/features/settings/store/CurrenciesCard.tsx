import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { saveCurrencies, type Rounding, type StoreCurrency, type StoreLocale } from '../../../api/settingsStore'
import type { ApiClient } from '../../../graphql'
import { formatDay } from '../../../format'
import { locale, t } from '../../../messages'
import { useTheme } from '../../../theme'
import { Button } from '../../common/Button'
import { Notice } from '../../common/Notice'
import { SectionCard } from '../../common/SectionCard'
import { Switch } from '../../common/Switch'
import { useFeedback } from '../../shell/Feedback'
import { AddFromList } from '../AddFromList'
import { PickerField } from '../PickerField'
import { useWrite } from '../useWrite'
import { addableCurrencies, exampleOf, sameCurrencies } from './storeDraft'

type Props = { loc: StoreLocale; client: ApiClient; canEdit: boolean }

const roundingOptions = (): { value: Rounding; label: string }[] => [
  { value: 'none', label: t('settings.store.roundNone') },
  { value: 'nearest', label: t('settings.store.roundNearest') },
  { value: 'ends-99', label: t('settings.store.round99') },
]

// SetStore's currencies card: the main one fixed, each other converting at the reference rate or typed by hand on each product. The API works
// out every example; the app only shows it.
export function CurrenciesCard({ loc, client, canEdit }: Props) {
  const { colors, radii } = useTheme()
  const feedback = useFeedback()
  const write = useWrite('settingsStore')
  const [saved, setSaved] = useState<StoreCurrency[]>(() => loc.currencies.filter((c) => c.status === 'active'))
  const [list, setList] = useState<StoreCurrency[]>(saved)
  const main = loc.pricingCurrency ?? ''
  const dirty = !sameCurrencies(list, saved)
  const change = (code: string, patch: Partial<StoreCurrency>) => setList((current) => current.map((c) => (c.code === code ? { ...c, ...patch } : c)))

  const stopConverting = (code: string) =>
    feedback.sheet({
      title: t('settings.store.stopTitle', { code }),
      body: t('settings.store.stopBody', { code }),
      confirm: t('settings.store.stopConfirm'),
      onConfirm: () => change(code, { mode: 'manual' }),
    })

  const remove = (code: string) =>
    feedback.sheet({
      title: t('settings.store.removeCurrencyTitle', { code }),
      body: t('settings.store.removeCurrencyBody', { code }),
      confirm: t('settings.common.remove'),
      danger: true,
      onConfirm: () => setList((current) => current.filter((c) => c.code !== code)),
    })

  const save = async () => {
    if (await write.run(async () => (await saveCurrencies(client, list.map(({ code, mode, rounding }) => ({ code, mode, rounding }))), t('settings.store.savedCurrencies')))) setSaved(list)
  }

  return (
    <SectionCard title={t('settings.store.currencies')} sub={t('settings.store.currenciesSub')}>
      {write.failure ? <Notice kind="error" text={write.failure} /> : null}
      <View style={[styles.main, { backgroundColor: colors.page, borderColor: colors.border, borderRadius: radii.button }]}>
        <Text style={[styles.mainText, { color: colors.text }]}>{t('settings.store.mainCurrency', { code: main })}</Text>
      </View>
      {list.map((currency) => {
        const example = currency.mode === 'convert' ? exampleOf(currency.code, currency.rounding, loc.examples) : null
        return (
          <View key={currency.code} style={[styles.item, { borderColor: colors.border, borderRadius: radii.button }]}>
            <Text style={[styles.code, { color: colors.heading }]}>{currency.code}</Text>
            <Text style={[styles.help, { color: colors.muted }]}>{currency.mode === 'convert' ? t('settings.store.converted', { code: main }) : t('settings.store.typed')}</Text>
            {canEdit ? (
              <Switch label={t('settings.store.convert')} value={currency.mode === 'convert'} onChange={(on) => (on ? change(currency.code, { mode: 'convert', rounding: 'ends-99' }) : stopConverting(currency.code))} />
            ) : null}
            {currency.mode === 'convert' ? (
              <>
                <PickerField label={t('settings.store.round')} value={currency.rounding} options={roundingOptions()} disabled={!canEdit} onChange={(value) => change(currency.code, { rounding: value as Rounding })} />
                <Text style={[styles.help, { color: colors.muted }]}>
                  {example === null
                    ? t('settings.store.noRate')
                    : example.date
                      ? t('settings.store.rates', { example: example.text, date: formatDay(example.date, locale) })
                      : t('settings.store.ratesUndated', { example: example.text })}
                </Text>
              </>
            ) : (
              <Text style={[styles.help, { color: colors.muted }]}>{t('settings.store.typedNote', { code: currency.code })}</Text>
            )}
            {canEdit ? <Button kind="secondary" label={t('settings.store.removeCurrency', { code: currency.code })} onPress={() => remove(currency.code)} /> : null}
          </View>
        )
      })}
      {canEdit ? <AddFromList label={t('settings.store.addCurrency')} options={addableCurrencies(loc, list).map((code) => ({ value: code, label: code }))} onPick={(code) => setList((current) => [...current, { code, mode: 'convert', rounding: 'ends-99', status: 'active' }])} /> : null}
      <Text style={[styles.help, { color: colors.muted }]}>{t('settings.store.mainFixed', { code: main })}</Text>
      {canEdit ? <Button saves busy={write.busy} disabled={!dirty} label={t('settings.store.saveCurrencies')} onPress={() => void save()} /> : null}
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  main: { borderWidth: 1, padding: 12 },
  mainText: { fontSize: 14, fontWeight: '700' },
  item: { borderWidth: 1, padding: 12, gap: 8 },
  code: { fontSize: 16, fontWeight: '800' },
  help: { fontSize: 13, lineHeight: 18 },
})

import { Pressable, StyleSheet, Text, View } from 'react-native'
import { giftCardMonths } from '../../../api/productKinds'
import { minorOf } from '../../../format'
import { t, tryT } from '../../../messages'
import { useTheme } from '../../../theme'
import { Chip } from '../../common/Chip'
import { SectionCard } from '../../common/SectionCard'
import { useFeedback } from '../../shell/Feedback'
import { amountLabel } from './amountLabel'
import { amountsOf, withAmounts, withDetails, type Draft, type DraftProblem } from './draft'
import { exampleOf } from './PriceCard'

type Props = { draft: Draft; update: (change: (draft: Draft) => Draft) => void; disabled: boolean; currency: string; problems: readonly DraftProblem[] }

const periodOf = (months: number): string => tryT(`products.kinds.giftCard.months.m${months}`) ?? t('products.kinds.giftCard.monthsOther', { count: months })

// A gift card (CatEditor "Gift card amounts"): its amounts, which are its versions, and when its cards expire. The shortest expiry
// is the API's and arrives once the product is saved as a gift card; the API refuses a shorter one.
export function GiftCardCard({ draft, update, disabled, currency, problems }: Props) {
  const { colors } = useTheme()
  const feedback = useFeedback()
  const amounts = amountsOf(draft, currency)
  const { expiryMonths, shortestMonths } = draft.details.giftCard
  const offered = giftCardMonths.filter((months) => shortestMonths === null || months >= shortestMonths)
  const label = (amount: string) => amountLabel(amount, currency)
  const setAmounts = (next: string[]) => update((d) => withAmounts(d, next, currency, t('products.kinds.giftCard.option'), label))
  const remove = (amount: string) => (amounts.length <= 1 ? feedback.toast({ message: t('products.kinds.giftCard.keepOne') }) : setAmounts(amounts.filter((other) => other !== amount)))
  const example = exampleOf(currency)

  const add = () =>
    feedback.sheet({
      title: t('products.kinds.giftCard.addTitle'),
      input: {
        label: t('products.kinds.giftCard.addLabel', { currency }),
        placeholder: example,
        single: true,
        error: t('products.kinds.giftCard.addInvalid', { example }),
        validate: (text) => {
          const minor = minorOf(text, currency)
          if (typeof minor !== 'string' || minor === '0') return t('products.kinds.giftCard.addInvalid', { example })
          return amounts.includes(minor) ? t('products.kinds.giftCard.addTaken') : null
        },
      },
      confirm: t('products.kinds.giftCard.addConfirm'),
      onConfirm: ({ text }) => {
        const minor = minorOf(text, currency)
        if (typeof minor === 'string') setAmounts([...amounts, minor])
      },
    })

  const setExpiry = (months: number | null) => update((d) => withDetails(d, 'giftCard', { expiryMonths: months }))

  return (
    <SectionCard title={t('products.kinds.giftCard.title')} sub={currency}>
      <View style={{ gap: 14 }}>
        <View style={styles.chips}>
          {amounts.map((amount) => (
            <View key={amount} style={[styles.pill, { borderColor: colors.fieldBorder, backgroundColor: colors.surface }]}>
              <Text style={[styles.pillText, { color: colors.textStrong }]}>{label(amount)}</Text>
              {!disabled ? (
                <Pressable accessibilityRole="button" accessibilityLabel={t('products.kinds.giftCard.remove', { amount: label(amount) })} onPress={() => remove(amount)} style={styles.remove}>
                  <Text style={{ color: colors.muted, fontSize: 16 }}>✕</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
          {!disabled ? <Chip dashed label={t('products.kinds.giftCard.add')} onPress={add} /> : null}
        </View>
        {problems.includes('price') && amounts.length === 0 ? <Text style={{ color: colors.danger, fontSize: 13 }}>{t('products.kinds.giftCard.missing')}</Text> : null}
        <View style={{ gap: 6 }}>
          <Text style={[styles.label, { color: colors.text }]}>{t('products.kinds.giftCard.expiry')}</Text>
          <View style={styles.chips}>
            {offered.map((months) => (
              <Chip key={months} label={periodOf(months)} hint={months === shortestMonths ? t('products.kinds.giftCard.shortest') : undefined} selected={expiryMonths === months} disabled={disabled} onPress={() => setExpiry(months)} />
            ))}
            {expiryMonths !== null && !offered.some((months) => months === expiryMonths) ? <Chip label={periodOf(expiryMonths)} selected disabled={disabled} onPress={() => setExpiry(expiryMonths)} /> : null}
            <Chip label={t('products.kinds.giftCard.never')} selected={expiryMonths === null} disabled={disabled} onPress={() => setExpiry(null)} />
          </View>
          <Text style={[styles.hint, { color: colors.muted }]}>
            {shortestMonths === null ? t('products.kinds.giftCard.ruleUnknown') : t('products.kinds.giftCard.rule', { period: periodOf(shortestMonths) })}
          </Text>
        </View>
        <Text style={[styles.hint, { color: colors.muted }]}>{t('products.kinds.giftCard.tax')}</Text>
      </View>
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { minHeight: 44, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 22, paddingLeft: 14 },
  pillText: { fontSize: 14, fontWeight: '600' },
  remove: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 14, fontWeight: '700' },
  hint: { fontSize: 12, lineHeight: 18 },
})

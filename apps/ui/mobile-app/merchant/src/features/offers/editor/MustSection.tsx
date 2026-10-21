import { formatList } from '../../../format'
import { locale, t } from '../../../messages'
import { ChoiceRow } from '../../common/ChoiceRow'
import { SectionCard } from '../../common/SectionCard'
import type { Minimum } from '../offerDraft'
import { AmountFields, Hint, Problem, WholeField, type SectionProps } from './parts'
import { andParts } from './summary'

// "What must they buy?" (OFFERS-DESIGN J): no minimum, an order total, a number of these products, or a number of items. Every
// condition must be met, which the line under it says.
export function MustSection({ draft: d, set, errors: e, facts, disabled, marketName }: SectionProps & { marketName: string | null }) {
  const options: Minimum[] = ['none', 'amount', ...(d.type === 'products' ? (['these'] as const) : []), 'items']
  const parts = andParts(d, facts, marketName)
  return (
    <SectionCard title={t('offers.editor.sections.must')}>
      {options.map((minimum) => (
        <ChoiceRow key={minimum} label={t(`offers.editor.minimum.${minimum}.title`)} sub={t(`offers.editor.minimum.${minimum}.sub`)} selected={d.minimum === minimum} disabled={disabled} onPress={() => set({ minimum })} />
      ))}
      {d.minimum === 'amount' ? <AmountFields label={t('offers.editor.minimum.amount.title')} value={d.minAmounts} onChange={(minAmounts) => set({ minAmounts })} facts={facts} invalid={Boolean(e.minimum)} disabled={disabled} /> : null}
      {d.minimum === 'items' || d.minimum === 'these' ? (
        <WholeField label={`${t(`offers.editor.minimum.${d.minimum}.title`)} (${t('offers.editor.items')})`} value={d.minQuantity} onChange={(minQuantity) => set({ minQuantity })} invalid={Boolean(e.minimum)} disabled={disabled} maxLength={3} />
      ) : null}
      <Problem text={e.minimum} />
      {parts.length > 1 ? <Hint text={t('offers.editor.andLine', { parts: formatList(parts, locale) })} /> : null}
    </SectionCard>
  )
}

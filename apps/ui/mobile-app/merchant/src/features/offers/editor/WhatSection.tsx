import { StyleSheet, View } from 'react-native'
import type { CollectionSummary } from '../../../api/collections'
import type { Filter } from '../../../api/filters'
import type { OfferIdNames } from '../../../api/offers'
import { formatNumber } from '../../../format'
import { locale, t } from '../../../messages'
import { Button } from '../../common/Button'
import { Chip } from '../../common/Chip'
import { ChoiceRow } from '../../common/ChoiceRow'
import { SectionCard } from '../../common/SectionCard'
import { Switch } from '../../common/Switch'
import { PickerField } from '../../settings/PickerField'
import type { Target } from '../offerDraft'
import { AmountFields, Hint, IdChips, Label, MoneyField, Problem, WholeField, Wrap, type SectionProps } from './parts'

type Props = SectionProps & {
  filters: Filter[]
  collections: CollectionSummary[]
  productNames: OfferIdNames
  onPick: (field: 'productIds' | 'buyIds' | 'getIds') => void
}

const targets: Target[] = ['products', 'filter', 'collection']

// "What does the shopper get?" (OFFERS-DESIGN D–G): a discount per kind of offer. Only what the API can save is drawn.
export function WhatSection({ draft: d, set, errors: e, facts, region, disabled, filters, collections, productNames, onPick }: Props) {
  const ship = region.ship
  const filter = filters.find((f) => f.values.some((v) => d.filterValueIds.includes(v.id))) ?? filters[0]
  const kindChips = (
    <Wrap>
      {(['percent', 'fixed'] as const).map((k) => (
        <Chip key={k} label={k === 'percent' ? t('offers.editor.percentage') : t('offers.editor.fixed')} selected={d.kind === k} disabled={disabled} onPress={() => set({ kind: k })} />
      ))}
    </Wrap>
  )

  return (
    <SectionCard title={t('offers.editor.sections.what')}>
      {d.type === 'products' || d.type === 'order' ? (
        <>
          <Label text={t('offers.editor.kindLabel')} />
          {kindChips}
          {!d.tiers.length && d.kind === 'percent' ? <WholeField label={`${t('offers.editor.percentLabel')} (%)`} value={d.percent} onChange={(percent) => set({ percent })} invalid={Boolean(e.value)} disabled={disabled} maxLength={3} /> : null}
          {!d.tiers.length && d.kind === 'fixed' ? <AmountFields label={t('offers.editor.amountLabel')} value={d.amounts} onChange={(amounts) => set({ amounts })} facts={facts} invalid={Boolean(e.value)} disabled={disabled} /> : null}
          <Problem text={e.value} />
          {d.type === 'products' && d.kind === 'fixed' ? <Hint text={t('offers.editor.perItemNote')} /> : null}
          {d.type === 'order' && d.kind === 'fixed' && !d.tiers.length ? <Hint text={t('offers.editor.orderFixedNote')} /> : null}
          {d.kind === 'percent' && facts.others.length > 0 ? <Hint text={t('offers.editor.multiPercentNote')} /> : null}
        </>
      ) : null}

      {d.type === 'products' ? (
        <>
          <Label text={t('offers.editor.appliesTo')} />
          {targets.map((target) => (
            <ChoiceRow key={target} label={t(`offers.editor.targets.${target}.title`)} sub={t(`offers.editor.targets.${target}.sub`)} selected={d.target === target} disabled={disabled} onPress={() => set({ target })} />
          ))}
          {d.target === 'products' ? (
            <>
              <IdChips ids={d.productIds} names={productNames} disabled={disabled} onRemove={(id) => set({ productIds: d.productIds.filter((x) => x !== id) })} />
              {disabled ? null : <Button kind="secondary" label={t('offers.editor.chooseProducts')} onPress={() => onPick('productIds')} />}
              {d.productIds.length > 0 ? <Hint text={t('offers.editor.versionsNote')} /> : null}
            </>
          ) : null}
          {d.target === 'filter' ? (
            filter ? (
              <View style={styles.stack}>
                <PickerField
                  label={t('offers.editor.filter')}
                  value={filter.id}
                  options={filters.map((f) => ({ value: f.id, label: f.name }))}
                  disabled={disabled}
                  onChange={(id) => set({ filterValueIds: filters.find((f) => f.id === id)?.values.slice(0, 1).map((v) => v.id) ?? [] })}
                />
                <PickerField
                  label={t('offers.editor.tagged')}
                  value={d.filterValueIds[0] ?? ''}
                  options={filter.values.map((v) => ({ value: v.id, label: v.name }))}
                  placeholder={t('offers.editor.chooseValue')}
                  disabled={disabled}
                  onChange={(id) => set({ filterValueIds: [id] })}
                />
                {d.filterValueIds.length > 0 ? <Hint text={t('offers.editor.filterNote', { value: filter.values.find((v) => v.id === d.filterValueIds[0])?.name ?? '' })} /> : null}
              </View>
            ) : (
              <Hint text={`${t('offers.editor.noFilters')} ${t('offers.editor.goFilters')}`} />
            )
          ) : null}
          {d.target === 'collection' ? (
            <>
              <PickerField
                label={t('offers.editor.collection')}
                value={d.collectionIds[0] ?? ''}
                options={collections.map((c) => ({ value: c.id, label: t('offers.editor.collectionOption', { name: c.name, count: formatNumber(c.products, locale) }) }))}
                placeholder={t('offers.editor.chooseCollection')}
                disabled={disabled}
                onChange={(id) => set({ collectionIds: [id] })}
              />
              <Hint text={t('offers.editor.collectionNote')} />
            </>
          ) : null}
          <Problem text={e.targets} />
          <Label text={t('offers.editor.leaveOut')} />
          <Switch label={t('offers.editor.giftCards')} value={d.excludeGiftCards} disabled={disabled} onChange={(excludeGiftCards) => set({ excludeGiftCards })} />
          <Switch label={t('offers.editor.onSale')} value={d.excludeOnSale} disabled={disabled} onChange={(excludeOnSale) => set({ excludeOnSale })} />
        </>
      ) : null}

      {d.type === 'order' ? (
        <>
          <Switch
            label={t('offers.editor.tiers')}
            value={d.tiers.length > 0}
            disabled={disabled}
            onChange={() => set({ tiers: d.tiers.length ? [] : [{ off: d.kind === 'percent' ? '10' : '', minimum: '' }, { off: d.kind === 'percent' ? '15' : '', minimum: '' }], capOn: false })}
          />
          {d.tiers.length > 0 ? (
            <View style={styles.stack}>
              {d.tiers.map((tier, i) => (
                <View key={i} style={styles.stack}>
                  <MoneyField label={t('offers.editor.tierOff', { n: String(i + 1), unit: d.kind === 'percent' ? '%' : facts.main })} value={tier.off} onChange={(off) => set({ tiers: d.tiers.map((x, j) => (j === i ? { ...x, off } : x)) })} disabled={disabled} />
                  <MoneyField label={t('offers.editor.tierMinimum', { n: String(i + 1), unit: facts.main })} value={tier.minimum} onChange={(minimum) => set({ tiers: d.tiers.map((x, j) => (j === i ? { ...x, minimum } : x)) })} disabled={disabled} />
                  {!disabled && d.tiers.length > 2 ? <Button kind="secondary" label={t('offers.editor.removeTier', { n: String(i + 1) })} onPress={() => set({ tiers: d.tiers.filter((_, j) => j !== i) })} /> : null}
                </View>
              ))}
              {!disabled && d.tiers.length < 5 ? <Button kind="secondary" label={t('offers.editor.addTier')} onPress={() => set({ tiers: [...d.tiers, { off: '', minimum: '' }] })} /> : null}
              <Hint text={t('offers.editor.tiersNote')} />
              <Problem text={e.tiers} />
            </View>
          ) : null}
        </>
      ) : null}

      {(d.type === 'order' || d.type === 'products') && d.kind === 'percent' && !d.tiers.length ? (
        <>
          <Switch label={t('offers.editor.cap')} value={d.capOn} disabled={disabled} onChange={(capOn) => set({ capOn })} />
          {d.capOn ? <MoneyField label={`${t('offers.editor.capLabel')} (${facts.main})`} value={d.cap} onChange={(cap) => set({ cap })} invalid={Boolean(e.cap)} disabled={disabled} /> : null}
          <Problem text={e.cap} />
        </>
      ) : null}

      {d.type === 'bxgy' ? (
        <View style={styles.stack}>
          <Label text={t('offers.editor.buys')} />
          <WholeField label={t('offers.editor.buysHow')} value={d.buyQuantity} onChange={(buyQuantity) => set({ buyQuantity })} disabled={disabled} maxLength={2} />
          <IdChips ids={d.buyIds} names={productNames} disabled={disabled} onRemove={(id) => set({ buyIds: d.buyIds.filter((x) => x !== id) })} />
          {disabled ? null : <Button kind="secondary" label={d.buyIds.length ? t('offers.editor.change') : t('offers.editor.chooseProducts')} onPress={() => onPick('buyIds')} />}
          <Problem text={e.buy} />
          <Label text={t('offers.editor.gets')} />
          <WholeField label={t('offers.editor.getsHow')} value={d.getQuantity} onChange={(getQuantity) => set({ getQuantity })} disabled={disabled} maxLength={2} />
          <Wrap>
            <Chip label={t('offers.editor.same')} selected={d.getSame} disabled={disabled} onPress={() => set({ getSame: true, getIds: [] })} />
            <Chip label={t('offers.editor.other')} selected={!d.getSame} disabled={disabled} onPress={() => set({ getSame: false, getIds: [] })} />
          </Wrap>
          {!d.getSame ? (
            <>
              <IdChips ids={d.getIds} names={productNames} disabled={disabled} onRemove={(id) => set({ getIds: d.getIds.filter((x) => x !== id) })} />
              {disabled ? null : <Button kind="secondary" label={t('offers.editor.chooseProducts')} onPress={() => onPick('getIds')} />}
            </>
          ) : null}
          <Problem text={e.get} />
          <Label text={t('offers.editor.atLabel')} />
          <Wrap>
            <Chip label={t('offers.editor.free')} selected={d.getPercent === '100'} disabled={disabled} onPress={() => set({ getPercent: '100' })} />
            <Chip label={t('offers.editor.half')} selected={d.getPercent === '50'} disabled={disabled} onPress={() => set({ getPercent: '50' })} />
            <Chip label={t('offers.editor.percentOff')} selected={d.getPercent !== '100' && d.getPercent !== '50'} disabled={disabled} onPress={() => set({ getPercent: '30' })} />
          </Wrap>
          {d.getPercent !== '100' && d.getPercent !== '50' ? <WholeField label={`${t('offers.editor.getPercentLabel')} (%)`} value={d.getPercent} onChange={(getPercent) => set({ getPercent })} disabled={disabled} maxLength={3} /> : null}
          <Problem text={e.value} />
          <Hint text={t('offers.editor.bxgyNote')} />
          <Switch
            label={t('offers.editor.oncePerOrder', { twice: String(((Number(d.buyQuantity) || 1) + (d.getSame ? Number(d.getQuantity) || 1 : 0)) * 2), twiceFree: String((Number(d.getQuantity) || 1) * 2) })}
            value={d.oncePerOrder}
            disabled={disabled}
            onChange={(oncePerOrder) => set({ oncePerOrder })}
          />
        </View>
      ) : null}

      {d.type === 'shipping' ? (
        <>
          <Label text={t('offers.editor.shipModes')} />
          <Wrap>
            {(['free', 'off'] as const).map((k) => (
              <Chip key={k} label={t(k === 'free' ? 'offers.editor.shipFree' : 'offers.editor.shipOff', { ship })} selected={d.shipMode === k} disabled={disabled} onPress={() => set({ shipMode: k })} />
            ))}
          </Wrap>
          {d.shipMode === 'off' ? <AmountFields label={t('offers.editor.shipOffLabel', { ship })} value={d.amounts} onChange={(amounts) => set({ amounts })} facts={facts} invalid={Boolean(e.value)} disabled={disabled} /> : null}
          <Problem text={e.value} />
          <Hint text={t('offers.editor.shipNote', { ship })} />
        </>
      ) : null}
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
})

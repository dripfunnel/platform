import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { loadCustomers, type CustomerGroup } from '../../../api/customers'
import type { OfferIdNames } from '../../../api/offers'
import { formatNumber } from '@dripfunnel/mobile-shared/format'
import type { Market } from '../../../api/settingsMarkets'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { locale, t } from '../../../messages'
import { Chip } from '../../common/Chip'
import { ChoiceRow } from '../../common/ChoiceRow'
import { SectionCard } from '../../common/SectionCard'
import { TextField } from '../../common/TextField'
import { PickerField } from '../../settings/PickerField'
import { offerLimits, type Who } from '../offerDraft'
import { Hint, IdChips, Problem, Wrap, type SectionProps } from './parts'

type Props = SectionProps & {
  client: ApiClient
  groups: CustomerGroup[]
  markets: Market[]
  customerNames: OfferIdNames
  onCustomerName: (id: string, name: string) => void
}

const who: Who[] = ['all', 'groups', 'first', 'customers', 'market']
const searchPauseMs = 300

type Found = { kind: 'idle' } | { kind: 'failed' } | { kind: 'ready'; rows: { id: string; name: string }[] }

// "Specific customers" (OFFERS-DESIGN I3): search the store's customers by name or email, and pick.
function CustomerSearch({ client, chosen, onPick, disabled }: { client: ApiClient; chosen: readonly string[]; onPick: (id: string, name: string) => void; disabled: boolean }) {
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<Found>({ kind: 'idle' })
  useEffect(() => {
    const typed = query.trim()
    if (typed.length < 2) return setFound({ kind: 'idle' })
    let live = true
    const timer = setTimeout(
      () =>
        void loadCustomers(client, { groupId: null, search: typed }).then(
          (page) => live && setFound({ kind: 'ready', rows: page.rows.map((r) => ({ id: r.id, name: r.name ?? r.email ?? t('offers.editor.unnamed') })) }),
          () => live && setFound({ kind: 'failed' }),
        ),
      searchPauseMs,
    )
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [client, query])
  const rows = found.kind === 'ready' ? found.rows.filter((r) => !chosen.includes(r.id)).slice(0, 8) : []
  return (
    <View style={styles.stack}>
      <TextField label={t('offers.editor.findCustomer')} value={query} onChangeText={setQuery} placeholder={t('offers.editor.findCustomer')} editable={!disabled} returnKeyType="search" />
      {found.kind === 'failed' ? <Problem text={t('offers.editor.searchFailed')} /> : null}
      {found.kind === 'ready' && rows.length === 0 ? <Hint text={t('offers.editor.customersNone', { query: query.trim() })} /> : null}
      <Wrap>
        {rows.map((row) => (
          <Chip key={row.id} label={t('offers.editor.addName', { name: row.name })} onPress={() => onPick(row.id, row.name)} />
        ))}
      </Wrap>
    </View>
  )
}

// "Who is it for?" (OFFERS-DESIGN I): everyone, groups, first order, specific customers, or one market. Groups are the store's; making a
// new one is Customers' (the card's scope is the editor, not group management).
export function WhoSection({ draft: d, set, errors: e, disabled, client, groups, markets, customerNames, onCustomerName }: Props) {
  const sellable = markets.filter((m) => m.active && m.countries.length > 0)
  const market = sellable.find((m) => m.countries.length === d.countries.length && m.countries.every((c) => d.countries.includes(c)))
  return (
    <SectionCard title={t('offers.editor.sections.who')}>
      {who.map((key) => (
        <ChoiceRow
          key={key}
          label={t(`offers.editor.who.${key}.title`)}
          sub={t(`offers.editor.who.${key}.sub`)}
          selected={d.who === key}
          disabled={disabled}
          onPress={() => set({ who: key, countries: key === 'market' && !d.countries.length ? (sellable[0]?.countries ?? []) : d.countries })}
        />
      ))}
      {d.who === 'groups' ? (
        <>
          {groups.length === 0 ? <Hint text={t('offers.editor.noGroups')} /> : null}
          <Wrap>
            {groups.map((g) => (
              <Chip
                key={g.id}
                label={t('offers.editor.groupChip', { name: g.name, count: formatNumber(g.members, locale) })}
                selected={d.groupIds.includes(g.id)}
                disabled={disabled}
                onPress={() => set({ groupIds: d.groupIds.includes(g.id) ? d.groupIds.filter((x) => x !== g.id) : [...d.groupIds, g.id] })}
              />
            ))}
          </Wrap>
          {d.groupIds.length > 1 ? <Hint text={t('offers.editor.anyGroup')} /> : null}
          <Hint text={t('offers.editor.goCustomers')} />
        </>
      ) : null}
      {d.who === 'customers' ? (
        <>
          <IdChips ids={d.customerIds} names={customerNames} disabled={disabled} onRemove={(id) => set({ customerIds: d.customerIds.filter((x) => x !== id) })} />
          {!disabled && d.customerIds.length < offerLimits.ids ? (
            <CustomerSearch
              client={client}
              chosen={d.customerIds}
              disabled={disabled}
              onPick={(id, name) => {
                onCustomerName(id, name)
                set({ customerIds: [...d.customerIds, id] })
              }}
            />
          ) : null}
        </>
      ) : null}
      {d.who === 'market' ? (
        <PickerField
          label={t('offers.editor.market')}
          value={market?.id ?? ''}
          options={sellable.map((m) => ({ value: m.id, label: m.name }))}
          placeholder={t('offers.editor.chooseMarket')}
          disabled={disabled}
          onChange={(id) => set({ countries: sellable.find((m) => m.id === id)?.countries ?? [] })}
        />
      ) : null}
      <Problem text={e.who} />
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  stack: { gap: 10 },
})

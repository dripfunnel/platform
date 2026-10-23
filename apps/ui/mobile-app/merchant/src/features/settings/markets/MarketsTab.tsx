import { useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { loadMarkets, setEverywhereElse, type Market } from '../../../api/settingsMarkets'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { formatList, regionName } from '@dripfunnel/mobile-shared/format'
import { locale, t } from '../../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../../common/Button'
import { SectionCard } from '../../common/SectionCard'
import { useReloadOnFocus } from '../../collections/useReloadOnFocus'
import { useFeedback } from '../../shell/Feedback'
import { FormSheet } from '../FormSheet'
import { PickerField } from '../PickerField'
import { RowCard } from '../RowCard'
import { marketHref, newMarketHref } from '../routes'
import { TabFrame } from '../TabFrame'
import { nested } from './marketDraft'

// Settings › Markets (SetMarkets; FIRST-RELEASE (store) §15): the list with each market's countries, currency and state, "everywhere else", and a
// market's editor on its own screen on top. A market's own web domain is never offered (decided on #337); its address is the main one or a path on it.
export function MarketsTab() {
  return (
    <TabFrame label={t('settings.tabs.markets')} load={loadMarkets}>
      {({ data, client, canEdit, refresh }) => <MarketList markets={data} client={client} canEdit={canEdit} refresh={refresh} />}
    </TabFrame>
  )
}

type Props = { markets: readonly Market[]; client: ApiClient; canEdit: boolean; refresh: () => Promise<void> }

function MarketList({ markets, client, canEdit, refresh }: Props) {
  const { colors } = useTheme()
  const router = useRouter()
  const feedback = useFeedback()
  const [elseTo, setElseTo] = useState<{ id: string | null } | null>(null)
  useReloadOnFocus(refresh)
  const tops = markets.filter((market) => market.parentId === null)
  const fallback = markets.find((market) => market.everywhereElse)?.id ?? ''
  const target = elseTo?.id ? markets.find((market) => market.id === elseTo.id) : null

  const create = () =>
    feedback.sheet({
      title: t('settings.markets.newTitle'),
      body: t('settings.markets.newBody'),
      input: { label: t('settings.markets.name'), placeholder: t('settings.markets.namePlaceholder'), error: t('settings.markets.problems.name'), single: true },
      confirm: t('settings.markets.create'),
      onConfirm: ({ text }) => router.push(newMarketHref(text) as never),
    })

  return (
    <>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
          {t('settings.markets.title')}
        </Text>
        <Text style={[styles.sub, { color: colors.muted }]}>{t('settings.markets.sub')}</Text>
        {canEdit ? <Button saves label={t('settings.markets.add')} onPress={create} /> : null}
      </View>
      {markets.length === 0 ? <Text style={[styles.sub, { color: colors.muted }]}>{t('settings.markets.none')}</Text> : null}
      {nested(markets).map((market) => (
        <RowCard
          key={market.id}
          title={market.name}
          sub={t('settings.markets.rowSub', { countries: formatList(market.countries.map((country) => regionName(country, locale)), locale), currency: market.currency })}
          status={market.primary ? t('settings.markets.primary') : !market.active ? t('settings.markets.off') : market.parentId ? t('settings.markets.subMarket') : t('settings.markets.active')}
          tone={market.primary || market.active ? 'ok' : 'off'}
          onPress={() => router.push(marketHref(market.id) as never)}
          accessibilityLabel={t('settings.markets.open', { name: market.name })}
        />
      ))}
      <SectionCard title={t('settings.markets.elseTitle')} sub={t('settings.markets.elseSub')}>
        <PickerField
          label={t('settings.markets.elseTitle')}
          value={fallback}
          disabled={!canEdit}
          options={[{ value: '', label: t('settings.markets.nobody') }, ...tops.map((market) => ({ value: market.id, label: market.name }))]}
          onChange={(value) => value !== fallback && setElseTo({ id: value || null })}
        />
      </SectionCard>

      {elseTo ? (
        <FormSheet
          title={t('settings.markets.elseChange')}
          body={target ? t('settings.markets.elseBody', { name: target.name }) : t('settings.markets.elseBodyNobody')}
          confirm={t('settings.markets.elseConfirm')}
          context="settingsMarkets"
          onClose={() => setElseTo(null)}
          onSubmit={async () => {
            await setEverywhereElse(client, elseTo.id)
            await refresh()
            return t('settings.markets.elseSaved')
          }}
        />
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  head: { gap: 8 },
  title: { fontSize: 17, fontWeight: '800' },
  sub: { fontSize: 13, lineHeight: 19 },
})

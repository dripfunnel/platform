import { useRouter } from 'expo-router'
import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { offerKinds, type Offer } from '../../api/offers'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../common/Button'
import { Notice } from '../common/Notice'
import { stateOfError } from '../common/useLoad'
import { useReloadOnFocus } from '../collections/useReloadOnFocus'
import { useFeedback } from '../shell/Feedback'
import { ShellScreen } from '../states/ShellScreen'
import { Skeleton } from '../states/StateView'
import type { OffersAccess } from './access'
import { actLabel, actsFor, useOfferActions, type OfferAct } from './offerActions'
import { OfferCard } from './OfferCard'
import { OfferFilters } from './OfferFilters'
import { regionWords, zoneName } from './offerView'
import { editOfferHref, newOfferHref, offerHref } from './routes'
import { shareCode } from './shareCode'
import { useOfferList } from './useOfferList'

// Offers (Offers.dc.html at phone width; FIRST-RELEASE (store) §8): the four tabs with search and filters, each offer as a card with its
// actions behind "⋯", and a floating Create for a seat that can change offers. Staff read; the API decides every write again.
export function OffersHome({ access, client }: { access: OffersAccess; client: ApiClient }) {
  const { colors, radii } = useTheme()
  const router = useRouter()
  const feedback = useFeedback()
  const list = useOfferList(client)
  const [failure, setFailure] = useState<string | null>(null)
  useReloadOnFocus(list.reload)

  const region = regionWords(list.place?.country ?? null)
  const timeZone = list.place?.timeZone ?? 'UTC'
  const now = new Date()
  const total = list.counts ? list.counts.live + list.counts.scheduled + list.counts.off + list.counts.ended : null
  const firstTime = total === 0 && !list.filtered
  const open = (id: string) => router.push(offerHref(id) as never)

  const actions = useOfferActions({
    client,
    timeZone,
    onFail: setFailure,
    onDone: (message, done) => {
      feedback.toast({ message })
      if (done.kind === 'duplicated') return open(done.id)
      list.reload()
    },
  })

  const more = (offer: Offer) => {
    const acts: OfferAct[] = access.canEdit ? actsFor(offer, new Date()) : []
    feedback.menu({
      title: offer.name,
      items: [
        ...(access.canEdit ? [{ key: 'edit', label: t('offers.menu.edit'), onPress: () => router.push(editOfferHref(offer.id) as never) }] : []),
        { key: 'view', label: access.canEdit ? t('offers.menu.manage') : t('offers.menu.view'), onPress: () => open(offer.id) },
        ...(offer.code ? [{ key: 'share', label: t('offers.menu.share'), onPress: () => void shareCode(offer.code ?? '', () => feedback.toast({ message: t('offers.shareFailed') })) }] : []),
        ...acts.map((act) => ({
          key: act,
          label: actLabel(act),
          danger: act === 'delete' || act === 'end',
          onPress: () => {
            setFailure(null)
            actions.start(offer, act)
          },
        })),
      ],
    })
  }

  const empty = list.filtered ? null : t(`offers.empty.${list.tab}.title`)

  return (
    <View style={styles.root}>
      <ShellScreen label={t('offers.screen')} onRetry={list.reload} {...(list.status === 'error' ? { state: stateOfError(list.error) } : {})}>
        <View style={styles.content}>
          <View style={styles.head}>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
              {t('offers.title')}
            </Text>
            <Text style={[styles.sub, { color: colors.muted }]}>{t('offers.lede', { ship: region.ship })}</Text>
          </View>
          {access.readOnly ? <Notice text={`${t('offers.notes.readOnlyTitle')} ${t('offers.notes.readOnly')}`} /> : null}
          {access.viewOnly ? <Notice text={`${t('offers.notes.staffTitle')} ${t('offers.notes.staff')}`} /> : null}
          {failure ? <Notice kind="error" text={failure} /> : null}
          {list.countsFailed ? <Notice text={t('offers.countsFailed')} /> : null}
          {list.status === 'loading' && list.counts === null ? <Skeleton /> : null}
          {firstTime ? (
            <View style={[styles.first, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
              <Text accessibilityRole="header" style={[styles.firstTitle, { color: colors.heading }]}>
                {t('offers.firstTime.title')}
              </Text>
              <Text style={[styles.sub, { color: colors.muted }]}>{t('offers.firstTime.body', { ship: region.ship })}</Text>
              {access.canEdit
                ? offerKinds.map((kind) => (
                    <Button key={kind} kind="secondary" label={t(`offers.kinds.${kind}`, { ship: region.ship })} onPress={() => router.push(`${newOfferHref}?type=${kind}` as never)} />
                  ))
                : null}
            </View>
          ) : (
            <>
              <OfferFilters
                tab={list.tab}
                onTab={list.setTab}
                counts={list.counts}
                search={list.search}
                onSearch={list.setSearch}
                kind={list.kind}
                onKind={list.setKind}
                trigger={list.trigger}
                onTrigger={list.setTrigger}
                region={region}
              />
              {list.place ? <Text style={[styles.zone, { color: colors.muted }]}>{t('offers.timesIn', { zone: zoneName(list.place.timeZone) })}</Text> : null}
              {list.status === 'loading' ? <Skeleton /> : null}
              {list.status === 'ready' && list.rows.length === 0 ? (
                <View style={[styles.first, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
                  <Text accessibilityRole="header" style={[styles.firstTitle, { color: colors.heading }]}>
                    {empty ?? t('offers.noMatch.title')}
                  </Text>
                  <Text style={[styles.sub, { color: colors.muted }]}>{empty ? t(`offers.empty.${list.tab}.body`) : t('offers.noMatch.body')}</Text>
                  {!empty ? <Button kind="secondary" label={t('offers.noMatch.clear')} onPress={list.clearFilters} /> : null}
                </View>
              ) : null}
              {list.status === 'ready'
                ? list.rows.map((offer) => (
                    <OfferCard key={offer.id} offer={offer} now={now} timeZone={timeZone} country={list.place?.country ?? null} names={list.names} onOpen={() => open(offer.id)} onMore={() => more(offer)} />
                  ))
                : null}
              {list.hasMore && list.status === 'ready' ? list.loadingMore ? <ActivityIndicator color={colors.muted} /> : <Button kind="secondary" label={t('offers.showMore')} onPress={list.showMore} /> : null}
            </>
          )}
        </View>
      </ShellScreen>
      {access.canEdit ? (
        <Pressable accessibilityRole="button" onPress={() => router.push(newOfferHref as never)} style={[styles.fab, { backgroundColor: colors.brand, borderRadius: radii.button }]}>
          <Text style={[styles.fabText, { color: colors.brandContrast }]}>{t('offers.createPlus')}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 14, gap: 14, paddingBottom: 96 },
  head: { gap: 4 },
  title: { fontSize: 22, fontWeight: '800' },
  sub: { fontSize: 13, lineHeight: 19 },
  zone: { fontSize: 12 },
  first: { borderWidth: 1, padding: 24, gap: 12 },
  firstTitle: { fontSize: 20, fontWeight: '800' },
  fab: { position: 'absolute', right: 16, bottom: 16, minHeight: 50, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', elevation: 4 },
  fabText: { fontSize: 15, fontWeight: '800' },
})

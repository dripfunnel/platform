import { useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { loadOffer, loadOfferNames, loadOfferPlace, type Offer } from '../../api/offers'
import { ApiError, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../common/Button'
import { Notice } from '../common/Notice'
import { SectionCard } from '../common/SectionCard'
import { stateOfError, useLoad } from '../common/useLoad'
import { useReloadOnFocus } from '../collections/useReloadOnFocus'
import { useFeedback } from '../shell/Feedback'
import { ShellScreen } from '../states/ShellScreen'
import { Skeleton } from '../states/StateView'
import { StatusChip } from '../products/StatusChip'
import type { OffersAccess } from './access'
import { CodeBatches } from './CodeBatches'
import { actLabel, actsFor, useOfferActions } from './offerActions'
import { offerFacts } from './offerFacts'
import { OffersGate } from './OffersGate'
import { noNames, regionWords, sentence, statusKeyOf, statusTone, timeLine, zoneName } from './offerView'
import { editOfferHref, offersHref } from './routes'
import { shareCode } from './shareCode'

const loadPage = async (client: ApiClient, id: string) => {
  const [offer, place, names] = await Promise.all([loadOffer(client, id), loadOfferPlace(client), loadOfferNames(client).catch(() => noNames)])
  if (offer === null) throw new ApiError('NOT_FOUND', 'This offer is not here.')
  return { offer, place, names }
}

function OfferPage({ access, client, id }: { access: OffersAccess; client: ApiClient; id: string }) {
  const { colors, radii } = useTheme()
  const router = useRouter()
  const feedback = useFeedback()
  const { state, reload } = useLoad(() => loadPage(client, id), [client, id])
  const [failure, setFailure] = useState<string | null>(null)
  useReloadOnFocus(reload)
  const timeZone = state.status === 'ready' ? state.data.place.timeZone : 'UTC'

  const actions = useOfferActions({
    client,
    timeZone,
    onFail: setFailure,
    onDone: (message, done) => {
      feedback.toast({ message })
      if (done.kind === 'deleted') return router.replace(offersHref as never)
      if (done.kind === 'duplicated') return router.replace(`/offers/${done.id}` as never)
      reload()
    },
  })

  if (state.status !== 'ready') {
    return (
      <ShellScreen label={t('offers.page.offer')} onRetry={reload} {...(state.status === 'error' ? { state: stateOfError(state.error) } : {})}>
        <Skeleton />
      </ShellScreen>
    )
  }

  const { offer, place, names } = state.data
  const now = new Date()
  const region = regionWords(place.country)
  const key = statusKeyOf(offer, now)
  const acts = access.canEdit ? actsFor(offer, now) : []
  // A code offer without a shared code hands out single-use codes instead (OFFERS-DESIGN H4).
  const singleUse = offer.trigger === 'code' && !offer.code

  const openMenu = (current: Offer) =>
    feedback.menu({
      title: current.name,
      items: acts.map((act) => ({
        key: act,
        label: actLabel(act),
        danger: act === 'delete' || act === 'end',
        onPress: () => {
          setFailure(null)
          actions.start(current, act)
        },
      })),
    })

  return (
    <ShellScreen label={t('offers.page.offer')} onRetry={reload}>
      <View style={styles.content}>
        <View style={styles.head}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
            {offer.name}
          </Text>
          <View style={styles.status}>
            <StatusChip label={t(`offers.status.${key}`)} tone={statusTone[key]} />
            <Text style={[styles.sub, styles.line, { color: colors.muted }]}>{`${timeLine(offer, now, place.timeZone)}${t('offers.joiner')}${zoneName(place.timeZone)}`}</Text>
          </View>
          <Text style={[styles.sentence, { color: colors.textStrong }]}>{sentence(offer, region, names, now, place.timeZone)}</Text>
        </View>
        {access.readOnly ? <Notice text={`${t('offers.notes.readOnlyTitle')} ${t('offers.notes.readOnly')}`} /> : null}
        {access.viewOnly ? <Notice text={`${t('offers.notes.staffTitle')} ${t('offers.notes.staff')}`} /> : null}
        {failure ? <Notice kind="error" text={failure} /> : null}
        {access.canEdit ? (
          <View style={styles.actions}>
            <View style={styles.action}>
              <Button label={t('offers.menu.edit')} onPress={() => router.push(editOfferHref(offer.id) as never)} />
            </View>
            <View style={styles.action}>
              <Button saves kind="secondary" label={t('offers.page.actions')} onPress={() => openMenu(offer)} />
            </View>
          </View>
        ) : null}
        {offer.code ? (
          <SectionCard title={t('offers.page.share')}>
            <Text selectable style={[styles.bigCode, { color: colors.heading, backgroundColor: colors.neutralSurface, borderRadius: radii.button }]}>
              {offer.code}
            </Text>
            <Button kind="secondary" label={t('offers.menu.share')} onPress={() => void shareCode(offer.code ?? '', () => feedback.toast({ message: t('offers.shareFailed') }))} />
          </SectionCard>
        ) : null}
        {singleUse ? <CodeBatches client={client} offerId={offer.id} canEdit={access.canEdit} canExport={access.canExport} /> : null}
        <SectionCard title={t('offers.page.detailsTitle')}>
          {offerFacts(offer, region, names, place.timeZone).map(([label, value]) => (
            <View key={label} style={styles.fact}>
              <Text style={[styles.factLabel, { color: colors.muted }]}>{label}</Text>
              <Text style={[styles.factValue, { color: colors.text }]}>{value}</Text>
            </View>
          ))}
        </SectionCard>
      </View>
    </ShellScreen>
  )
}

// One offer (Offers › offer view): its sentence, its code or single-use runs, its details, and the seat's actions. A seat without
// `offers.read` and an offer that isn't here both meet the shell's denied and not-found views, never a hint that it exists.
export function OfferScreen({ id }: { id: string }) {
  return <OffersGate label={t('offers.page.offer')}>{(access, client) => <OfferPage access={access} client={client} id={id} />}</OffersGate>
}

const styles = StyleSheet.create({
  content: { padding: 14, gap: 14, paddingBottom: 32 },
  head: { gap: 8 },
  title: { fontSize: 22, fontWeight: '800' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  line: { flex: 1 },
  sub: { fontSize: 13, lineHeight: 18 },
  sentence: { fontSize: 15, lineHeight: 23 },
  actions: { flexDirection: 'row', gap: 8 },
  action: { flex: 1 },
  bigCode: { fontFamily: 'monospace', fontSize: 22, fontWeight: '800', letterSpacing: 2, textAlign: 'center', paddingVertical: 16 },
  fact: { gap: 2 },
  factLabel: { fontSize: 12, fontWeight: '700' },
  factValue: { fontSize: 14, lineHeight: 20 },
})

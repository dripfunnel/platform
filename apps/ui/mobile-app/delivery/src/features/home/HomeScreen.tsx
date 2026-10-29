import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Linking, Modal, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useBrand } from '@dripfunnel/mobile-shared/brand'
import { isApiError } from '@dripfunnel/mobile-shared/graphql'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { acceptOffer, declineOffer, fetchCurrentDelivery, fetchOffers, type CurrentDelivery, type Offer } from '../../api/dispatch'
import { retime } from '../../location/tracking'
import { errorText, t } from '../../messages'
import { usePending } from '../../pending/PendingContext'
import { usePush } from '../../push/PushContext'
import { pushPermission } from '../../push/push'
import { useSession } from '../../session/SessionContext'
import { Button, Loading, Refusal, StateMessage, TextButton } from '../common/ui'
import { useAction } from '../common/useAction'
import { useLoad } from '../common/useLoad'
import { LocationDisclosure } from './LocationDisclosure'
import { OfferCard } from './OfferCard'
import { OnlineCard } from './OnlineCard'
import { useNow } from './useNow'
import { useOnline } from './useOnline'

/** How long an offer another rider took stays on the list, saying so, before it goes. */
export const takenStaysMs = 3000

function CurrentCard({ delivery, onOpen }: { delivery: CurrentDelivery; onOpen: () => void }) {
  const { colors, radii } = useTheme()
  const pickedUp = delivery.state === 'picked_up'
  const where = pickedUp
    ? t('home.current.deliverTo', { area: delivery.area ?? '' })
    : delivery.area
      ? t('home.current.pickUpFrom', { warehouse: delivery.warehouse?.name ?? '', area: delivery.area })
      : t('home.current.pickUpFromWarehouse', { warehouse: delivery.warehouse?.name ?? '' })
  return (
    <View style={styles.group}>
      <Text accessibilityRole="header" style={[styles.heading, { color: colors.muted }]}>
        {t('home.yourDelivery')}
      </Text>
      <View style={[styles.current, { backgroundColor: colors.surface, borderColor: colors.link, borderRadius: radii.tile }]}>
        <Text style={{ color: colors.textStrong, fontSize: 14 }}>{where}</Text>
        <Text style={{ color: colors.link, fontWeight: '700', fontSize: 13 }}>{pickedUp ? t('home.current.onTheWay') : t('home.current.goToPickup')}</Text>
        <Button label={t('home.current.open')} onPress={onOpen} />
      </View>
      <Text style={{ color: colors.muted, fontSize: 13 }}>{t('home.current.paused')}</Text>
    </View>
  )
}

// Online or offline, the delivery the rider is on, and the offers near them (docs/mobile-app/delivery/FIRST-RELEASE.md §2).
export function HomeScreen() {
  const router = useRouter()
  const { colors, radii } = useTheme()
  const { client } = useSession()
  const { refresh, ended, dismissEnded } = usePush()
  const { steps, notices, hidden, sentCount, dismissNotice } = usePending()
  const now = useNow()
  const { state, reload } = useLoad(async () => {
    const [current, page] = await Promise.all([fetchCurrentDelivery(client, hidden), fetchOffers(client)])
    return { current, page }
  })
  const current = state.status === 'ready' ? state.data.current : null
  const pickedUp = current?.state === 'picked_up'
  const online = useOnline(pickedUp)
  const { brand } = useBrand()
  const answer = useAction()
  const [more, setMore] = useState<{ offers: Offer[]; cursor: string | null; hasMore: boolean } | null>(null)
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set())
  const [taken, setTaken] = useState<ReadonlySet<string>>(new Set())
  const [refused, setRefused] = useState<{ id: string; code: string } | null>(null)
  const [working, setWorking] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const [afterDelivery, setAfterDelivery] = useState(false)
  const [notificationsOff, setNotificationsOff] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreFailed, setMoreFailed] = useState(false)
  const lastPickedUp = useRef(pickedUp)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useFocusEffect(
    useCallback(() => {
      reload()
      void online.recheck()
      pushPermission().then((permission) => setNotificationsOff(permission === 'denied'), () => undefined)
    }, [reload, online.recheck]),
  )
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  useEffect(() => {
    if (refresh > 0) reload()
  }, [refresh, reload])
  const loadedFor = useRef({ hidden, sentCount })
  useEffect(() => {
    if (loadedFor.current.hidden === hidden && loadedFor.current.sentCount === sentCount) return
    loadedFor.current = { hidden, sentCount }
    reload()
  }, [hidden, sentCount, reload])
  useEffect(() => {
    if (state.status === 'ready') setMore(null)
  }, [state])
  // The task sends every 60 s while online and every 15 s once a parcel is picked up.
  useEffect(() => {
    if (lastPickedUp.current === pickedUp) return
    lastPickedUp.current = pickedUp
    if (online.online) retime(pickedUp).catch(() => undefined)
  }, [pickedUp, online.online])

  const toggle = () => {
    setAfterDelivery(false)
    if (online.online && current?.state === 'assigned') return setAsking(true)
    if (online.online && pickedUp) return setAfterDelivery(true)
    void (online.online ? online.turnOff() : online.turnOn()).then(reload)
  }

  const accept = async (offer: Offer) => {
    setRefused(null)
    setWorking(offer.id)
    const done = await answer.run(() => acceptOffer(client, offer.id).catch(onRefused(offer)))
    setWorking(null)
    if (done) router.push({ pathname: '/delivery/[id]', params: { id: offer.deliveryId } })
  }

  // Taken says so and goes; any other refusal stays on its card in words.
  const onRefused = (offer: Offer) => (error: unknown) => {
    const code = isApiError(error) ? error.code : 'UNKNOWN'
    if (code === 'TAKEN') {
      setTaken((now) => new Set(now).add(offer.id))
      timers.current.push(setTimeout(() => setGone((now) => new Set(now).add(offer.id)), takenStaysMs))
    } else setRefused({ id: offer.id, code })
    throw error
  }

  const decline = async (offer: Offer) => {
    setRefused(null)
    const done = await answer.run(() => declineOffer(client, offer.id).catch(onRefused(offer)))
    if (done) setGone((now) => new Set(now).add(offer.id))
  }

  const showMore = async () => {
    const cursor = more ? more.cursor : state.status === 'ready' ? state.data.page.endCursor : null
    setMoreFailed(false)
    setLoadingMore(true)
    try {
      const page = await fetchOffers(client, cursor)
      setMore({ offers: [...(more?.offers ?? []), ...page.offers], cursor: page.endCursor, hasMore: page.hasNextPage })
    } catch {
      setMoreFailed(true)
    } finally {
      setLoadingMore(false)
    }
  }

  const body = () => {
    if (state.status === 'loading') return <Loading />
    if (state.status === 'offline') return <StateMessage title={t('states.offline.title')} body={t('home.offlineBody')} actionLabel={t('common.retry')} onAction={reload} />
    if (state.status === 'error') return <StateMessage title={t('home.errorTitle')} body={t('home.errorBody')} actionLabel={t('common.retry')} onAction={reload} />
    // A delivery the API holds for this rider shows whether or not the task runs: a phone restarted mid-delivery is still on one.
    if (current) return <CurrentCard delivery={current} onOpen={() => router.push({ pathname: '/delivery/[id]', params: { id: current.id } })} />
    if (!online.online) {
      return (
        <View style={styles.group}>
          <Text style={{ color: colors.textStrong, fontSize: 15 }}>{t('online.offlineBody')}</Text>
          <Text style={{ color: colors.muted, fontSize: 14 }}>{t('online.offlineNote')}</Text>
        </View>
      )
    }
    const offers = [...state.data.page.offers, ...(more?.offers ?? [])].filter((offer) => !gone.has(offer.id))
    const hasMore = more ? more.hasMore : state.data.page.hasNextPage
    if (offers.length === 0) return <StateMessage title={t('home.emptyTitle')} body={t('home.emptyBody')} />
    return (
      <View style={styles.group}>
        <Text accessibilityRole="header" style={[styles.heading, { color: colors.muted }]}>
          {t('home.offers')}
        </Text>
        {offers.map((offer) => (
          <OfferCard
            key={offer.id}
            offer={offer}
            now={now}
            taken={taken.has(offer.id)}
            busy={working === offer.id}
            refusal={refused?.id === offer.id ? errorText(refused.code, 'offer') : null}
            onAccept={() => void accept(offer)}
            onDecline={() => void decline(offer)}
          />
        ))}
        <Refusal message={moreFailed ? t('home.showMoreFailed') : null} />
        {hasMore ? <Button kind="secondary" label={t('home.showMore')} busy={loadingMore} onPress={() => void showMore()} /> : null}
      </View>
    )
  }

  // Whether the position task runs is asked of the phone first; until it answers there is nothing true to show (an online rider reopening the app is not offline).
  if (online.online === null) return <View style={[styles.checking, { backgroundColor: colors.page }]}><Loading /></View>

  return (
    <ScrollView style={{ backgroundColor: colors.page }} contentContainerStyle={styles.body}>
      {notificationsOff ? (
        <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: colors.warningSurface, borderColor: colors.warningBorder, borderRadius: radii.button }]}>
          <Text style={{ flex: 1, color: colors.warning, fontSize: 13 }}>{t('online.notificationsOff.body')}</Text>
          <TextButton label={t('online.notificationsOff.turnOn')} onPress={() => void Linking.openSettings()} />
        </View>
      ) : null}
      {ended ? (
        <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: colors.infoSurface, borderColor: colors.infoBorder, borderRadius: radii.button }]}>
          <Text style={{ flex: 1, color: colors.info, fontSize: 14 }}>{ended.kind === 'cancelled' ? t('home.ended.cancelled') : t('home.ended.recalled')}</Text>
          <TextButton label={t('home.ended.dismiss')} onPress={dismissEnded} />
        </View>
      ) : null}

      {steps.length > 0 ? (
        <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: colors.warningSurface, borderColor: colors.warningBorder, borderRadius: radii.button }]}>
          <Text style={{ flex: 1, color: colors.warning, fontSize: 14 }}>{t('home.pending.saved', { count: steps.length })}</Text>
        </View>
      ) : null}
      {notices.filter((notice) => !notice.dismissed).map((notice) => (
        <View key={notice.deliveryId} accessibilityRole="alert" style={[styles.banner, { backgroundColor: colors.infoSurface, borderColor: colors.infoBorder, borderRadius: radii.button }]}>
          <Text style={{ flex: 1, color: colors.info, fontSize: 14 }}>{notice.code === 'CODE_UNCONFIRMED' ? t('delivery.unconfirmed.title') : t('home.pending.refused')}</Text>
          <TextButton label={t('home.pending.dismiss')} onPress={() => dismissNotice(notice.deliveryId)} />
        </View>
      ))}

      <OnlineCard online={online.online === true} paused={current !== null} locationOff={online.denied} busy={online.busy} onToggle={toggle} />

      {online.denied ? (
        <View accessibilityRole="alert" style={[styles.refused, { backgroundColor: colors.dangerSurface, borderColor: colors.dangerBorder, borderRadius: radii.button }]}>
          <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 15 }}>{t('online.locationOff.title')}</Text>
          <Text style={{ color: colors.text, fontSize: 14 }}>{t('online.locationOff.body')}</Text>
          <Button kind="secondary" label={t('online.locationOff.openSettings')} onPress={() => void Linking.openSettings()} />
        </View>
      ) : null}
      <Refusal message={online.error ? errorText(online.error, 'online') : afterDelivery ? t('online.afterDelivery') : null} />

      {body()}

      <LocationDisclosure visible={online.disclosing} storeName={brand?.name ?? null} busy={online.busy} onContinue={() => void online.continueDisclosure().then(reload)} onNotNow={online.declineDisclosure} />

      <Modal transparent animationType="fade" visible={asking} onRequestClose={() => setAsking(false)}>
        <View style={[styles.backdrop, { backgroundColor: colors.backdrop }]}>
          <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: colors.surface, borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet }]}>
            <Text accessibilityRole="header" style={[styles.sheetTitle, { color: colors.heading }]}>
              {t('online.handBack.title')}
            </Text>
            <Text style={{ color: colors.textStrong }}>{t('online.handBack.body')}</Text>
            <Button
              kind="danger"
              label={t('online.handBack.confirm')}
              onPress={() => {
                setAsking(false)
                void online.turnOff().then(reload)
              }}
            />
            <Button kind="secondary" label={t('online.handBack.stay')} onPress={() => setAsking(false)} />
          </View>
        </View>
      </Modal>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  body: { gap: 16, padding: 16, paddingTop: 56 },
  checking: { flex: 1, justifyContent: 'center' },
  group: { gap: 10 },
  heading: { fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', paddingLeft: 4 },
  current: { borderWidth: 2, padding: 16, gap: 8 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, paddingLeft: 14, paddingRight: 6 },
  refused: { borderWidth: 1, padding: 16, gap: 8 },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { gap: 14, padding: 20, paddingBottom: 32 },
  sheetTitle: { fontSize: 18, fontWeight: '800' },
})

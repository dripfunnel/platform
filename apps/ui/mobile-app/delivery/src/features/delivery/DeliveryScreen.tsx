import { useRouter } from 'expo-router'
import { useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useOnline as useConnection } from '@dripfunnel/mobile-shared/connection'
import { formatDateTime } from '@dripfunnel/mobile-shared/format'
import { isApiError } from '@dripfunnel/mobile-shared/graphql'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { fetchDelivery, handBack, markDelivered, markFailed, markPickedUp, type NotDeliveredReason, type RiderDelivery } from '../../api/delivery'
import { errorText, locale, t } from '../../messages'
import { usePending } from '../../pending/PendingContext'
import type { PendingStep } from '../../pending/store'
import { useSession } from '../../session/SessionContext'
import { Button, Refusal, Resource, ScreenHeader, StateMessage, TextButton } from '../common/ui'
import { useAction } from '../common/useAction'
import { useLoad } from '../common/useLoad'
import { CodeEntry, CodeLocked } from './CodeEntry'
import { cashOf, CustomerDetails, PickupDetails } from './Details'
import { ResultCard, ReturnCard } from './Results'
import { Sheet } from './Sheet'
import { newStep } from './steps'

const reasons: NotDeliveredReason[] = ['no_one_home', 'refused', 'wrong_address']

/** `savedAt` is when the step was taken while the phone had no signal; null when the API already has it. */
type Outcome = { kind: 'delivered'; cash: string | null; savedAt: string | null } | { kind: 'failed'; reason: NotDeliveredReason; savedAt: string | null } | { kind: 'unconfirmed' }
type Sheets = 'handBack' | 'cash' | 'reason' | null

const timeOf = (at: string): string => formatDateTime(at, locale, Intl.DateTimeFormat().resolvedOptions().timeZone)

/** One delivery from pickup to the door (docs/mobile-app/delivery/FIRST-RELEASE.md §2). The API decides every step; this screen shows what it answers. */
export function DeliveryScreen({ id }: { id: string }) {
  const { client } = useSession()
  const router = useRouter()
  const { colors } = useTheme()
  const connected = useConnection()
  const { steps, notices, keep, notify } = usePending()
  const { state, reload } = useLoad(() => fetchDelivery(client, id))
  const step = useAction()
  const [sheet, setSheet] = useState<Sheets>(null)
  const [entering, setEntering] = useState(false)
  const [code, setCode] = useState('')
  const [locked, setLocked] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [reason, setReason] = useState<NotDeliveredReason | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const cashCollected = useRef(false)

  const home = () => router.navigate('/home')

  // What the phone already holds for this delivery shows it as done, so reopening it never offers the same step twice.
  const kept = steps.find((saved) => saved.deliveryId === id)
  const unconfirmed = notices.some((notice) => notice.deliveryId === id && notice.code === 'CODE_UNCONFIRMED')
  const shown: Outcome | null = outcome ?? (kept ? (kept.kind === 'delivered' ? { kind: 'delivered', cash: null, savedAt: kept.at } : { kind: 'failed', reason: kept.reason, savedAt: kept.at }) : unconfirmed ? { kind: 'unconfirmed' } : null)

  const pickUp = () => void step.run(() => markPickedUp(client, id)).then((done) => done && reload())
  const giveBack = () => {
    setSheet(null)
    void step.run(() => handBack(client, id)).then((done) => done && home())
  }

  const deliver = (delivery: RiderDelivery) => (cashOf(delivery) ? setSheet('cash') : setEntering(true))

  // With no signal the step is kept on the phone at once (the code gets this one try, checked when it is sent), and so is one the API did not answer.
  const send = async (taken: PendingStep, call: () => Promise<void>, done: Outcome) => {
    if (!connected) {
      keep(taken)
      return setOutcome(done)
    }
    setSending(true)
    setRefusal(null)
    try {
      await call()
      setOutcome({ ...done, savedAt: null } as Outcome)
    } catch (error) {
      if (isApiError(error, 'NO_RESPONSE')) {
        keep(taken)
        return setOutcome(done)
      }
      const failure = isApiError(error) ? error.code : 'UNKNOWN'
      if (failure === 'CODE_UNCONFIRMED') {
        notify({ deliveryId: id, code: failure })
        return setOutcome({ kind: 'unconfirmed' })
      }
      if (failure === 'WRONG_CODE') setCode('')
      if (failure === 'CODE_LOCKED') setLocked(true)
      setRefusal(failure)
    } finally {
      setSending(false)
    }
  }

  const confirmCode = (delivery: RiderDelivery) => {
    const cash = cashOf(delivery)
    const cashDone = cash ? cashCollected.current : null
    const taken = { kind: 'delivered' as const, deliveryId: id, code, cashCollected: cashDone, ...newStep() }
    return send(taken, () => markDelivered(client, id, { code, cashCollected: cashDone, at: taken.at, key: taken.key }), { kind: 'delivered', cash, savedAt: taken.at })
  }

  const notDelivered = () => {
    if (!reason) return
    setSheet(null)
    const taken = { kind: 'failed' as const, deliveryId: id, reason, ...newStep() }
    return send(taken, () => markFailed(client, id, { reason, at: taken.at, key: taken.key }), { kind: 'failed', reason, savedAt: taken.at })
  }

  const finished = (title: string, body: string) => <StateMessage title={title} body={body} actionLabel={t('delivery.result.back')} onAction={home} />

  const footer = (delivery: RiderDelivery) => {
    if (shown || delivery.state === 'cancelled' || delivery.state === 'delivered' || delivery.state === 'failed') return null
    if (delivery.state === 'assigned') {
      return (
        <>
          <Button label={t('delivery.pickedUp')} busy={step.busy} onPress={pickUp} />
          <TextButton label={t('delivery.handBack')} tone="danger" onPress={() => setSheet('handBack')} />
        </>
      )
    }
    if (delivery.state !== 'picked_up') return null
    if (entering) {
      return locked ? (
        <TextButton label={t('delivery.notDelivered')} onPress={() => setSheet('reason')} />
      ) : (
        <>
          <Button label={t('delivery.code.confirm')} busy={sending} disabled={code.length < 4} onPress={() => void confirmCode(delivery)} />
          <TextButton label={t('delivery.notDelivered')} onPress={() => setSheet('reason')} />
        </>
      )
    }
    return (
      <>
        <Button label={t('delivery.delivered')} onPress={() => deliver(delivery)} />
        <Button kind="secondary" label={t('delivery.notDelivered')} onPress={() => setSheet('reason')} />
      </>
    )
  }

  const body = (delivery: RiderDelivery | null) => {
    if (!delivery) return <StateMessage title={t('delivery.title')} body={errorText('NOT_FOUND')} actionLabel={t('delivery.result.back')} onAction={home} />
    const where = delivery.warehouse?.name ?? t('home.warehouse')
    if (shown?.kind === 'delivered') {
      return shown.savedAt ? (
        <ResultCard tone="warning" title={t('delivery.saved.title')} body={t('delivery.saved.delivered', { time: timeOf(shown.savedAt) })} onBack={home} />
      ) : (
        <ResultCard tone="success" title={t('delivery.result.title')} body={shown.cash ? t('delivery.result.cash', { amount: shown.cash }) : ''} onBack={home} />
      )
    }
    if (shown?.kind === 'failed') {
      const note = t('delivery.returnParcel.notDelivered', { reason: t(`delivery.failedSheet.reason.${shown.reason}`).toLowerCase() })
      return <ReturnCard note={note} saved={shown.savedAt ? t('delivery.saved.notDelivered', { time: timeOf(shown.savedAt) }) : null} title={t('delivery.returnParcel.titleReturn', { warehouse: where })} delivery={delivery} onBack={home} />
    }
    if (shown?.kind === 'unconfirmed') return <ResultCard tone="warning" title={t('delivery.unconfirmed.title')} body={t('delivery.unconfirmed.body')} onBack={home} />
    if (delivery.state === 'cancelled') return finished(t('delivery.cancelled.title'), t('delivery.cancelled.body'))
    if (delivery.state === 'failed' && delivery.failedReason === 'recalled') return <ReturnCard note={t('delivery.returnParcel.recalled')} saved={null} title={t('delivery.returnParcel.titleBring', { warehouse: where })} delivery={delivery} onBack={home} />
    if (delivery.state === 'assigned') return <PickupDetails delivery={delivery} />
    if (delivery.state === 'picked_up') {
      if (!entering) return <CustomerDetails delivery={delivery} />
      return locked ? <CodeLocked /> : <CodeEntry code={code} onChange={setCode} offline={!connected} refusal={refusal === 'WRONG_CODE' ? errorText('WRONG_CODE') : null} />
    }
    return finished(t('delivery.finished.title'), t('delivery.finished.body'))
  }

  const delivery = state.status === 'ready' ? state.data : null
  const stepError = step.error ?? (refusal && refusal !== 'WRONG_CODE' && refusal !== 'CODE_LOCKED' ? refusal : null)

  return (
    <View style={[styles.screen, { backgroundColor: colors.page }]}>
      <ScreenHeader title={t('delivery.title')} onBack={home} />
      <ScrollView contentContainerStyle={styles.body}>
        <Resource state={state} onRetry={reload}>
          {(loaded) => body(loaded)}
        </Resource>
      </ScrollView>
      {delivery ? (
        <View style={[styles.footer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Refusal message={stepError ? errorText(stepError, 'delivery') : null} />
          {footer(delivery)}
        </View>
      ) : null}

      <Sheet title={t('delivery.handBackSheet.title')} body={t('delivery.handBackSheet.body', { warehouse: delivery?.warehouse?.name ?? t('home.warehouse') })} visible={sheet === 'handBack'} onClose={() => setSheet(null)}>
        <Button kind="danger" label={t('delivery.handBackSheet.confirm')} onPress={giveBack} />
        <Button kind="secondary" label={t('delivery.handBackSheet.keep')} onPress={() => setSheet(null)} />
      </Sheet>

      <Sheet title={t('delivery.cashSheet.title', { amount: delivery ? (cashOf(delivery) ?? '') : '' })} body={t('delivery.cashSheet.body')} visible={sheet === 'cash'} onClose={() => setSheet(null)}>
        <Button
          label={t('delivery.cashSheet.confirm', { amount: delivery ? (cashOf(delivery) ?? '') : '' })}
          onPress={() => {
            cashCollected.current = true
            setSheet(null)
            setEntering(true)
          }}
        />
        <Button kind="secondary" label={t('delivery.cashSheet.notYet')} onPress={() => setSheet(null)} />
      </Sheet>

      <Sheet title={t('delivery.failedSheet.title')} visible={sheet === 'reason'} onClose={() => setSheet(null)}>
        {reasons.map((key) => (
          <Pressable
            key={key}
            accessibilityRole="radio"
            accessibilityLabel={t(`delivery.failedSheet.reason.${key}`)}
            accessibilityState={{ selected: reason === key }}
            onPress={() => setReason(key)}
            style={[styles.reason, { borderColor: reason === key ? colors.brand : colors.fieldBorder, borderWidth: reason === key ? 2 : 1 }]}
          >
            <Text style={{ color: colors.text, fontSize: 16 }}>{t(`delivery.failedSheet.reason.${key}`)}</Text>
          </Pressable>
        ))}
        <Button label={t('delivery.failedSheet.confirm')} disabled={!reason} busy={sending} onPress={() => void notDelivered()} />
        <Button kind="secondary" label={t('delivery.failedSheet.cancel')} onPress={() => setSheet(null)} />
      </Sheet>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { gap: 12, padding: 16 },
  footer: { gap: 10, padding: 16, borderTopWidth: 1 },
  reason: { minHeight: 52, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 10 },
})

import { useRouter } from 'expo-router'
import { useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { isApiError } from '@dripfunnel/mobile-shared/graphql'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { fetchDelivery, handBack, markDelivered, markFailed, markPickedUp, type NotDeliveredReason, type RiderDelivery, type Step } from '../../api/delivery'
import { errorText, t } from '../../messages'
import { useSession } from '../../session/SessionContext'
import { Button, Refusal, Resource, ScreenHeader, StateMessage, TextButton } from '../common/ui'
import { useAction } from '../common/useAction'
import { useLoad } from '../common/useLoad'
import { CodeEntry, CodeLocked } from './CodeEntry'
import { cashOf, CustomerDetails, PickupDetails } from './Details'
import { navigateTo } from './navigate'
import { Sheet } from './Sheet'
import { newStep } from './steps'

const reasons: NotDeliveredReason[] = ['no_one_home', 'refused', 'wrong_address']

type Outcome = { kind: 'delivered'; cash: string | null } | { kind: 'failed'; reason: NotDeliveredReason }
type Sheets = 'handBack' | 'cash' | 'reason' | null

/** One delivery from pickup to the door (docs/mobile-app/delivery/FIRST-RELEASE.md §2). The API decides every step; this screen shows what it answers. */
export function DeliveryScreen({ id }: { id: string }) {
  const { client } = useSession()
  const router = useRouter()
  const { colors } = useTheme()
  const { state, reload } = useLoad(() => fetchDelivery(client, id))
  const step = useAction()
  const [sheet, setSheet] = useState<Sheets>(null)
  const [entering, setEntering] = useState(false)
  const [code, setCode] = useState('')
  const [wrong, setWrong] = useState(0)
  const [locked, setLocked] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [codeBusy, setCodeBusy] = useState(false)
  const [reason, setReason] = useState<NotDeliveredReason | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const cashCollected = useRef(false)
  const pending = useRef<Step | null>(null)

  const home = () => router.navigate('/home')

  // A resend after no answer keeps its step (same time and key), so the API does it once; any answer, even a refusal, ends it.
  const stepFor = (): Step => (pending.current ??= newStep())
  const answered = (error: unknown) => {
    if (!isApiError(error, 'NO_RESPONSE')) pending.current = null
  }

  const pickUp = () => void step.run(() => markPickedUp(client, id)).then((done) => done && reload())
  const giveBack = () => {
    setSheet(null)
    void step.run(() => handBack(client, id)).then((done) => done && home())
  }

  const deliver = (delivery: RiderDelivery) => (cashOf(delivery) ? setSheet('cash') : setEntering(true))

  const confirmCode = async (delivery: RiderDelivery) => {
    setCodeBusy(true)
    setRefusal(null)
    try {
      await markDelivered(client, id, { code, cashCollected: cashOf(delivery) ? cashCollected.current : null, ...stepFor() })
      pending.current = null
      setOutcome({ kind: 'delivered', cash: cashOf(delivery) })
    } catch (error) {
      answered(error)
      const failure = isApiError(error) ? error.code : 'UNKNOWN'
      if (failure === 'WRONG_CODE') {
        setWrong((now) => now + 1)
        setCode('')
      }
      if (failure === 'CODE_LOCKED') setLocked(true)
      setRefusal(failure)
    } finally {
      setCodeBusy(false)
    }
  }

  const notDelivered = () => {
    if (!reason) return
    setSheet(null)
    const send = async () => {
      try {
        await markFailed(client, id, { reason, ...stepFor() })
        pending.current = null
      } catch (error) {
        answered(error)
        throw error
      }
    }
    void step.run(send).then((done) => done && setOutcome({ kind: 'failed', reason }))
  }

  const finished = (title: string, body: string) => <StateMessage title={title} body={body} actionLabel={t('delivery.result.back')} onAction={home} />

  const footer = (delivery: RiderDelivery) => {
    if (outcome || delivery.state === 'cancelled' || delivery.state === 'delivered' || delivery.state === 'failed') return null
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
          <Button label={t('delivery.code.confirm')} busy={codeBusy} disabled={code.length < 4} onPress={() => void confirmCode(delivery)} />
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
    if (outcome?.kind === 'delivered') return <ResultCard title={t('delivery.result.title')} body={outcome.cash ? t('delivery.result.cash', { amount: outcome.cash }) : ''} onBack={home} />
    if (outcome?.kind === 'failed') return <ReturnCard note={t('delivery.returnParcel.notDelivered', { reason: t(`delivery.failedSheet.reason.${outcome.reason}`).toLowerCase() })} title={t('delivery.returnParcel.titleReturn', { warehouse: where })} delivery={delivery} onBack={home} />
    if (delivery.state === 'cancelled') return finished(t('delivery.cancelled.title'), t('delivery.cancelled.body'))
    if (delivery.state === 'failed' && delivery.failedReason === 'recalled') return <ReturnCard note={t('delivery.returnParcel.recalled')} title={t('delivery.returnParcel.titleBring', { warehouse: where })} delivery={delivery} onBack={home} />
    if (delivery.state === 'assigned') return <PickupDetails delivery={delivery} />
    if (delivery.state === 'picked_up') {
      if (!entering) return <CustomerDetails delivery={delivery} />
      return locked ? <CodeLocked /> : <CodeEntry code={code} onChange={setCode} wrong={wrong} refusal={refusal === 'WRONG_CODE' ? errorText('WRONG_CODE') : null} />
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
        <Button label={t('delivery.failedSheet.confirm')} disabled={!reason} busy={step.busy} onPress={notDelivered} />
        <Button kind="secondary" label={t('delivery.failedSheet.cancel')} onPress={() => setSheet(null)} />
      </Sheet>
    </View>
  )
}

function ResultCard({ title, body, onBack }: { title: string; body: string; onBack: () => void }) {
  const { colors, radii } = useTheme()
  return (
    <View accessibilityRole="alert" style={[styles.result, { backgroundColor: colors.successSurface, borderColor: colors.successBorder, borderRadius: radii.card }]}>
      <Text accessibilityRole="header" style={{ color: colors.success, fontSize: 22, fontWeight: '700' }}>
        {title}
      </Text>
      {body ? <Text style={{ color: colors.success, fontSize: 15 }}>{body}</Text> : null}
      <Button label={t('delivery.result.back')} onPress={onBack} />
    </View>
  )
}

function ReturnCard({ note, title, delivery, onBack }: { note: string; title: string; delivery: RiderDelivery; onBack: () => void }) {
  const { colors, radii } = useTheme()
  const pin = delivery.warehouse && delivery.warehouse.latitude !== null && delivery.warehouse.longitude !== null ? { latitude: delivery.warehouse.latitude, longitude: delivery.warehouse.longitude } : null
  return (
    <View style={[styles.result, { backgroundColor: colors.infoSurface, borderColor: colors.infoBorder, borderRadius: radii.card }]}>
      <Text style={{ color: colors.info, fontSize: 14 }}>{note}</Text>
      <Text accessibilityRole="header" style={{ color: colors.info, fontSize: 20, fontWeight: '700' }}>
        {title}
      </Text>
      <Text style={{ color: colors.text }}>{t('delivery.returnParcel.body')}</Text>
      {pin ? <Button label={t('delivery.navigate')} onPress={() => void navigateTo(pin, delivery.warehouse?.name ?? '')} /> : null}
      <Button kind="secondary" label={t('delivery.returnParcel.backHome')} onPress={onBack} />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { gap: 12, padding: 16 },
  footer: { gap: 10, padding: 16, borderTopWidth: 1 },
  reason: { minHeight: 52, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 10 },
  result: { borderWidth: 1, padding: 20, gap: 12 },
})

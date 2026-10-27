import { useState } from 'react'
import { Linking, StyleSheet, Text, View } from 'react-native'
import { assignDelivery, cancelDelivery, markDeliveryDelivered, markReadyForPickup, offerDeliveryAgain, type Order, type OrderDelivery as Delivery } from '../../api/order'
import { loadRiders, type Rider } from '../../api/settingsRiders'
import { formatDateTime } from '@dripfunnel/mobile-shared/format'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { locale, t } from '../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../common/Button'
import { Notice } from '../common/Notice'
import { SectionCard } from '../common/SectionCard'
import { TextArea } from '../common/TextArea'
import { StatusChip } from '../products/StatusChip'
import { toneColours, type Tone } from '../products/productView'
import { ChoiceRows } from '../settings/ChoiceRows'
import { FormSheet } from '../settings/FormSheet'
import { initialsOf } from '../shell/ShellHeader'
import { actionsOf, isCashPending, primaryActions, reasonText, riderOpen, stepsOf, telUrl, viewOf, withRider, type DeliveryAction, type DeliveryView } from './deliveryView'
import { moneyText } from './orderView'

const tones: Record<DeliveryView, Tone> = {
  packing: 'neutral',
  searching: 'neutral',
  unassigned: 'warning',
  assigned: 'neutral',
  picked_up: 'success',
  code_locked: 'danger',
  code_unconfirmed: 'warning',
  delivered: 'success',
  failed: 'neutral',
  recalled: 'neutral',
  cancelled: 'neutral',
}

type Props = {
  order: Order
  delivery: Delivery
  timeZone: string
  /** `orders.fulfil` on a store that can change things; anyone else reads the panel. */
  canAct: boolean
  /** Only the Owner reads the riders (`riders.manage`), so only they pick one by hand. */
  canPick: boolean
  canMarkPaid: boolean
  client: ApiClient
  onDone: () => Promise<void>
}

type Sheet = { kind: Exclude<DeliveryAction, 'assign'> } | { kind: 'assign'; riders: Rider[] }

const T = 'orders.detail.delivery' as const

/** An own-delivery order with no delivery yet: it starts once the order is paid (DELIVERY.md §3). */
export function DeliveryWaiting() {
  const { colors } = useTheme()
  return (
    <SectionCard title={t(`${T}.title`)} sub={t(`${T}.sub`)}>
      <Text style={[styles.strong, { color: colors.text }]}>{t(`${T}.waiting.title`)}</Text>
      <Text style={[styles.body, { color: colors.muted }]}>{t(`${T}.waiting.body`)}</Text>
    </SectionCard>
  )
}

// The Delivery panel (OrderDelivery at phone width; docs/api/DELIVERY.md §3, §8): the delivery's state, its rider, what this seat can do now, and the steps.
// The API decides every move again; the actions here are only the ones the state allows.
export function OrderDelivery({ order, delivery, timeZone, canAct, canPick, canMarkPaid, client, onDone }: Props) {
  const { colors, radii } = useTheme()
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [reading, setReading] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const view = viewOf(delivery)
  const tone = toneColours(colors, tones[view])
  const name = delivery.rider?.name ?? t(`${T}.someone`)
  const cash = isCashPending(order)
  const actions = canAct ? actionsOf[view].filter((action) => action !== 'assign' || canPick) : []
  const vehicle = [delivery.rider?.vehicleType, delivery.rider?.vehicleNumber].filter(Boolean).join(' · ')
  const phone = riderOpen(view) ? delivery.rider?.phone : null
  const claim = cash && delivery.cashCollectedAt ? t(`${T}.claimCash`, { amount: order.total ? moneyText(order.total) : '', time: formatDateTime(delivery.cashCollectedAt, locale, timeZone) }) : cash && view === 'code_locked' ? t(`${T}.claimNone`) : null
  const note = view === 'picked_up' ? t(`${T}.note.picked_up`) : riderOpen(view) ? t(`${T}.note.code`) : null
  const close = () => setSheet(null)

  const pickRider = async () => {
    setProblem(null)
    setReading(true)
    try {
      const active = (await loadRiders(client)).filter((rider) => rider.status === 'active')
      if (active.length === 0) setProblem(t(`${T}.assign.none`))
      else setSheet({ kind: 'assign', riders: [...active].sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name)) })
    } catch {
      setProblem(t(`${T}.assign.loadFailed`))
    } finally {
      setReading(false)
    }
  }

  const press = (action: DeliveryAction) => (action === 'assign' ? void pickRider() : setSheet({ kind: action }))

  return (
    <>
      <SectionCard title={t(`${T}.title`)} sub={t(`${T}.sub`)}>
        <StatusChip label={t(`${T}.state.${view}.pill`)} tone={tones[view]} />
        <View {...(tones[view] === 'warning' || tones[view] === 'danger' ? { accessibilityRole: 'alert' as const } : {})} style={[styles.banner, { backgroundColor: tone.bg, borderColor: tone.border, borderRadius: radii.card }]}>
          <Text style={[styles.strong, { color: tone.fg }]}>{t(`${T}.state.${view}.title`, { name, reason: reasonText(delivery.failedReason) })}</Text>
          <Text style={[styles.body, { color: colors.text }]}>{t(`${T}.state.${view}.body`, { name })}</Text>
        </View>

        {withRider(view) && delivery.rider ? (
          <View style={styles.rider}>
            <View style={[styles.mark, { backgroundColor: colors.neutralSurface }]}>
              <Text accessibilityElementsHidden style={[styles.markText, { color: colors.neutral }]}>
                {initialsOf(delivery.rider.name, '?')}
              </Text>
            </View>
            <View style={styles.person}>
              <Text style={[styles.strong, { color: colors.text }]}>{name}</Text>
              <Text style={[styles.body, { color: colors.muted }]}>{vehicle || t(`${T}.noVehicle`)}</Text>
            </View>
          </View>
        ) : null}
        {phone ? <Button kind="secondary" label={t(`${T}.call`, { name })} onPress={() => void Linking.openURL(telUrl(phone))} /> : null}

        {claim ? (
          <View style={styles.claim}>
            <Text style={[styles.strong, { color: colors.text }]}>{t(`${T}.claimTitle`)}</Text>
            <Text style={[styles.body, { color: colors.muted }]}>{claim}</Text>
          </View>
        ) : null}

        {problem ? <Notice kind="error" text={problem} /> : null}
        {actions.map((action) => (
          <Button key={action} saves kind={primaryActions.includes(action) ? 'primary' : 'secondary'} busy={action === 'assign' && reading} disabled={reading} label={t(`${T}.actions.${action}`)} onPress={() => press(action)} />
        ))}
        {!canAct ? <Text style={[styles.body, { color: colors.muted }]}>{t(`${T}.note.readOnly`)}</Text> : null}
        {canAct && !canPick && view === 'unassigned' ? <Text style={[styles.body, { color: colors.muted }]}>{t(`${T}.note.assignOwner`)}</Text> : null}
        {note ? <Text style={[styles.body, { color: colors.muted }]}>{note}</Text> : null}

        <Text accessibilityRole="header" style={[styles.strong, { color: colors.heading }]}>
          {t(`${T}.stepsTitle`)}
        </Text>
        {stepsOf(order, delivery).map((step, index) => (
          <View key={`${step.at}-${index}`} style={styles.step}>
            <Text style={[styles.time, { color: colors.muted }]}>{formatDateTime(step.at, locale, timeZone)}</Text>
            <Text style={[styles.body, { color: colors.text }]}>{step.text}</Text>
          </View>
        ))}
      </SectionCard>

      {sheet ? <DeliverySheet sheet={sheet} view={view} name={name} order={order} delivery={delivery} cash={cash} canMarkPaid={canMarkPaid} client={client} onClose={close} onDone={onDone} /> : null}
    </>
  )
}

type SheetProps = { sheet: Sheet; view: DeliveryView; name: string; order: Order; delivery: Delivery; cash: boolean; canMarkPaid: boolean; client: ApiClient; onClose: () => void; onDone: () => Promise<void> }

function DeliverySheet({ sheet, view, name, order, delivery, cash, canMarkPaid, client, onClose, onDone }: SheetProps) {
  const [reason, setReason] = useState('')
  const [cashIn, setCashIn] = useState<'yes' | 'no'>(canMarkPaid ? 'yes' : 'no')
  const [rider, setRider] = useState(sheet.kind === 'assign' ? (sheet.riders[0]?.id ?? '') : '')

  const common = { context: 'delivery' as const, onClose }
  // A write, then the order read again, then what the toast says.
  const go = (work: () => Promise<void>, done: string) => async (): Promise<string> => {
    await work()
    await onDone()
    return done
  }

  if (sheet.kind === 'assign') {
    const picked = sheet.riders.find((candidate) => candidate.id === rider)
    return (
      <FormSheet
        {...common}
        title={t(`${T}.assign.title`)}
        body={t(`${T}.assign.body`)}
        confirm={t(`${T}.assign.confirm`)}
        check={() => (picked ? null : t(`${T}.assign.missing`))}
        onSubmit={go(async () => {
          if (picked) await assignDelivery(client, delivery.id, picked.id)
        }, t(`${T}.assign.done`, { name: picked?.name ?? '' }))}
      >
        <ChoiceRows
          label={t(`${T}.assign.label`)}
          value={rider}
          onChange={setRider}
          options={sheet.riders.map((candidate) => ({ value: candidate.id, label: t(candidate.online ? `${T}.assign.online` : `${T}.assign.offline`, { name: candidate.name }) }))}
        />
      </FormSheet>
    )
  }

  switch (sheet.kind) {
    case 'ready':
      return <FormSheet {...common} title={t(`${T}.ready.title`)} body={t(`${T}.ready.body`)} confirm={t(`${T}.ready.confirm`)} onSubmit={go(() => markReadyForPickup(client, order.id), t(`${T}.ready.done`))} />
    case 'again':
      return (
        <FormSheet
          {...common}
          title={t(`${T}.again.title`)}
          body={t(view === 'failed' || view === 'recalled' || view === 'cancelled' ? `${T}.again.bodyNew` : `${T}.again.body`)}
          confirm={t(`${T}.again.confirm`)}
          onSubmit={go(() => offerDeliveryAgain(client, delivery.id), t(`${T}.again.done`))}
        />
      )
    case 'cancel':
      return (
        <FormSheet
          {...common}
          danger
          title={t(`${T}.cancel.title`)}
          body={view === 'assigned' ? t(`${T}.cancel.bodyAssigned`, { name }) : t(`${T}.cancel.body`)}
          confirm={t(`${T}.cancel.confirm`)}
          cancel={t(`${T}.cancel.keep`)}
          onSubmit={go(() => cancelDelivery(client, delivery.id), t(`${T}.cancel.done`))}
        />
      )
    case 'recall':
      return (
        <FormSheet
          {...common}
          danger
          title={t(`${T}.recall.title`)}
          body={t(`${T}.recall.body`, { name })}
          confirm={t(`${T}.recall.confirm`)}
          cancel={t(`${T}.recall.keep`)}
          onSubmit={go(() => cancelDelivery(client, delivery.id), t(`${T}.recall.done`, { name }))}
        />
      )
    case 'notDelivered':
      return (
        <FormSheet
          {...common}
          danger
          title={t(`${T}.notDelivered.title`)}
          body={t(`${T}.notDelivered.body`, { name })}
          confirm={t(`${T}.notDelivered.confirm`)}
          onSubmit={go(() => cancelDelivery(client, delivery.id), t(`${T}.notDelivered.done`, { name }))}
        />
      )
    case 'delivered':
      return (
        <FormSheet
          {...common}
          title={t(`${T}.delivered.title`)}
          body={cash ? `${t(`${T}.delivered.body`)} ${t(`${T}.delivered.cashBody`)}` : t(`${T}.delivered.body`)}
          confirm={t(`${T}.delivered.confirm`)}
          check={() => (reason.trim() === '' ? t(`${T}.delivered.reasonMissing`) : cash && cashIn === 'yes' && !canMarkPaid ? t(`${T}.delivered.cashNeedsRole`) : null)}
          onSubmit={go(() => markDeliveryDelivered(client, delivery.id, reason.trim(), cash ? cashIn === 'yes' : null), t(`${T}.delivered.done`, { number: order.number }))}
        >
          <TextArea label={t(`${T}.delivered.reason`)} value={reason} onChangeText={setReason} placeholder={t(`${T}.delivered.placeholder`)} lines={3} />
          {cash ? (
            <ChoiceRows
              label={t(`${T}.delivered.cash`)}
              value={cashIn}
              onChange={setCashIn}
              options={[
                { value: 'yes', label: t(`${T}.delivered.cashYes`) },
                { value: 'no', label: t(`${T}.delivered.cashNo`) },
              ]}
            />
          ) : null}
        </FormSheet>
      )
  }
}

const styles = StyleSheet.create({
  banner: { borderWidth: 1, padding: 12, gap: 4 },
  strong: { fontSize: 15, fontWeight: '700', lineHeight: 21 },
  body: { fontSize: 14, lineHeight: 20 },
  rider: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  mark: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  markText: { fontSize: 14, fontWeight: '800' },
  person: { flex: 1, gap: 2 },
  claim: { gap: 2 },
  step: { gap: 2 },
  time: { fontSize: 12 },
})

import { ConfirmDialog, StatusPill, type ConfirmDialogProps, type StatusTone } from '@dripfunnel/shared/ui'
import { useId, useState } from 'react'
import { allPages } from '../../api/allPages'
import { assignDelivery, cancelDelivery, markDeliveryDelivered, markReadyForPickup, offerDeliveryAgain, type Order, type OrderDelivery as Delivery } from '../../api/order'
import { loadRiders, type Rider } from '../../api/riders'
import { fill, messages } from '../../messages'
import { refusalIn } from '../common/refusal'
import { actionsOf, isCashPending, reasonText, riderOpen, stepsOf, viewOf, withRider, type DeliveryAction, type DeliveryView } from './deliveryView'
import { moneyText, timeText, zoneName } from './orderView'

const words = messages.orders.detail.delivery
const refusalOf = refusalIn(words.refused)

const looks: Record<DeliveryView, { tone: StatusTone; icon: Parameters<typeof StatusPill>[0]['icon']; alert: boolean }> = {
  packing: { tone: 'neutral', icon: 'hour', alert: false },
  searching: { tone: 'info', icon: 'clock', alert: false },
  unassigned: { tone: 'warning', icon: 'alert', alert: true },
  assigned: { tone: 'info', icon: 'clock', alert: false },
  picked_up: { tone: 'success', icon: 'ok', alert: false },
  code_locked: { tone: 'danger', icon: 'alert', alert: true },
  code_unconfirmed: { tone: 'warning', icon: 'alert', alert: true },
  delivered: { tone: 'success', icon: 'ok', alert: false },
  failed: { tone: 'neutral', icon: 'cross', alert: false },
  recalled: { tone: 'neutral', icon: 'ban', alert: false },
  cancelled: { tone: 'neutral', icon: 'ban', alert: false },
}

type Ask = Omit<ConfirmDialogProps, 'open' | 'onCancel' | 'cancelLabel' | 'target'> & { cancelLabel?: string }

export interface OrderDeliveryProps {
  order: Order
  delivery: Delivery
  timeZone: string
  /** `orders.fulfil` on a store that can change things; anyone else reads the panel. */
  canAct: boolean
  /** Only the owner reads the riders (`riders.manage`), so only they pick one by hand. */
  canPick: boolean
  canMarkPaid: boolean
  /** Reads the order again after a change; the page's toast says what was done. */
  onChanged: (toast: string) => void
}

/** An own-delivery order with no delivery yet: it starts once the order is paid (DELIVERY §3). */
export const DeliveryWaiting = () => (
  <section className="df-order-card df-dlv" aria-label={words.title}>
    <div className="df-dlv-body">
      <div className="df-dlv-banner df-dlv-banner--neutral" role="status">
        <strong>{words.waiting.title}</strong>
        <span>{words.waiting.body}</span>
      </div>
    </div>
  </section>
)

/** The Delivery panel (OrderDelivery, docs/api/DELIVERY.md §3, §8): the delivery's state, its rider, what the merchant can do now, and the steps. */
export const OrderDelivery = ({ order, delivery, timeZone, canAct, canPick, canMarkPaid, onChanged }: OrderDeliveryProps) => {
  const id = useId()
  const [ask, setAsk] = useState<Ask | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const view = viewOf(delivery)
  const copy = words.state[view]
  const look = looks[view]
  const name = delivery.rider?.name ?? words.someone
  const open = riderOpen(view)
  const cash = isCashPending(order)
  const actions = canAct ? actionsOf[view].filter((a) => a !== 'assign' || canPick) : []
  const steps = stepsOf(order, delivery)
  const vehicle = [delivery.rider?.vehicleType, delivery.rider?.vehicleNumber].filter(Boolean).join(' · ')
  const claim = cash && delivery.cashCollectedAt ? fill(words.claimCash, { amount: order.total ? moneyText(order.total) : '', time: timeText(delivery.cashCollectedAt, timeZone) }) : cash && view === 'code_locked' ? words.claimNone : null
  const note = view === 'picked_up' ? words.note.picked_up : open ? words.note.code : null

  const run = async (work: () => Promise<void>, done: string) => {
    setBusy(true)
    setError(null)
    setFailure(null)
    try {
      await work()
      setAsk(null)
      onChanged(done)
    } catch (caught) {
      setError(refusalOf(caught))
    } finally {
      setBusy(false)
    }
  }

  const close = () => {
    setError(null)
    setAsk(null)
  }

  const pickRider = async () => {
    setFailure(null)
    setBusy(true)
    try {
      const riders = (await allPages((after) => loadRiders(after))).filter((r) => r.status === 'active')
      if (riders.length === 0) return setFailure(words.assign.none)
      const sorted = [...riders].sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name))
      setAsk(assignAsk(sorted))
    } catch {
      setFailure(words.assign.loadFailed)
    } finally {
      setBusy(false)
    }
  }

  const assignAsk = (riders: Rider[]): Ask => ({
    title: words.assign.title,
    consequence: words.assign.body,
    confirmLabel: words.assign.confirm,
    choices: [
      {
        key: 'rider',
        label: words.assign.label,
        options: riders.map((r) => ({ value: r.id, label: fill(r.online ? words.assign.online : words.assign.offline, { name: r.name }) })),
        initial: riders[0]?.id ?? '',
        error: (picked) => (riders.some((r) => r.id === picked) ? null : words.assign.missing),
      },
    ],
    onConfirm: (_, __, picked) => {
      const rider = riders.find((r) => r.id === picked['rider'])
      if (rider) void run(() => assignDelivery(delivery.id, rider.id), fill(words.assign.done, { name: rider.name }))
    },
  })

  const asks: Record<Exclude<DeliveryAction, 'assign'>, Ask> = {
    ready: { title: words.ready.title, consequence: words.ready.body, confirmLabel: words.ready.confirm, onConfirm: () => void run(() => markReadyForPickup(order.id), words.ready.done) },
    again: {
      title: words.again.title,
      consequence: view === 'failed' || view === 'recalled' || view === 'cancelled' ? words.again.bodyNew : words.again.body,
      confirmLabel: words.again.confirm,
      onConfirm: () => void run(() => offerDeliveryAgain(delivery.id), words.again.done),
    },
    cancel: {
      title: words.cancel.title,
      consequence: view === 'assigned' ? fill(words.cancel.bodyAssigned, { name }) : words.cancel.body,
      confirmLabel: words.cancel.confirm,
      cancelLabel: words.cancel.keep,
      danger: true,
      onConfirm: () => void run(() => cancelDelivery(delivery.id), words.cancel.done),
    },
    recall: {
      title: words.recall.title,
      consequence: fill(words.recall.body, { name }),
      confirmLabel: words.recall.confirm,
      cancelLabel: words.recall.keep,
      danger: true,
      onConfirm: () => void run(() => cancelDelivery(delivery.id), fill(words.recall.done, { name })),
    },
    notDelivered: {
      title: words.notDelivered.title,
      consequence: fill(words.notDelivered.body, { name }),
      confirmLabel: words.notDelivered.confirm,
      danger: true,
      onConfirm: () => void run(() => cancelDelivery(delivery.id), fill(words.notDelivered.done, { name })),
    },
    delivered: {
      title: words.delivered.title,
      consequence: cash ? `${words.delivered.body} ${words.delivered.cashBody}` : words.delivered.body,
      confirmLabel: words.delivered.confirm,
      reason: { label: words.delivered.reason, hint: words.delivered.hint, placeholder: words.delivered.placeholder },
      ...(cash && {
        choices: [
          {
            key: 'cash',
            label: words.delivered.cash,
            options: [
              { value: 'yes', label: words.delivered.cashYes },
              { value: 'no', label: words.delivered.cashNo },
            ],
            initial: canMarkPaid ? 'yes' : 'no',
            error: (picked: string) => (picked === 'yes' && !canMarkPaid ? words.delivered.cashNeedsRole : null),
          },
        ],
      }),
      onConfirm: (reason, _, picked) => void run(() => markDeliveryDelivered(delivery.id, (reason ?? '').trim(), cash ? picked['cash'] === 'yes' : null), fill(words.delivered.done, { number: order.number })),
    },
  }

  const press = (action: DeliveryAction) => {
    setError(null)
    if (action === 'assign') return void pickRider()
    setAsk(asks[action])
  }

  const label = (action: DeliveryAction): string => words.actions[action]
  const primary = (action: DeliveryAction) => action === 'ready' || action === 'assign' || action === 'again' || action === 'delivered'
  const danger = (action: DeliveryAction) => action === 'recall'

  return (
    <section className="df-order-card df-dlv" aria-labelledby={`${id}-title`}>
      <div className="df-dlv-head">
        <span className="df-dlv-heading">
          <h2 id={`${id}-title`}>{words.title}</h2>
          <span className="df-order-sub">{words.sub}</span>
        </span>
        <StatusPill tone={look.tone} icon={look.icon} label={copy.pill} />
      </div>
      <div className="df-dlv-body">
        <div className={`df-dlv-banner df-dlv-banner--${look.tone}`} role={look.alert ? 'alert' : 'status'}>
          <strong>{fill(copy.title, { name, reason: reasonText(delivery.failedReason) })}</strong>
          <span>{fill(copy.body, { name })}</span>
        </div>
        {withRider(view) && delivery.rider && (
          <div className="df-dlv-rider">
            <span className="df-dlv-mark" aria-hidden="true">
              {name
                .split(/\s+/)
                .map((part) => part[0] ?? '')
                .join('')
                .slice(0, 2)
                .toUpperCase()}
            </span>
            <span className="df-dlv-person">
              <strong>{name}</strong>
              <span className="df-order-sub">{vehicle || words.noVehicle}</span>
              {open && delivery.rider.phone && (
                <a href={`tel:${delivery.rider.phone}`} aria-label={fill(words.call, { name })}>
                  {delivery.rider.phone}
                </a>
              )}
            </span>
          </div>
        )}
        {claim && (
          <div className="df-dlv-claim">
            <strong>{words.claimTitle}</strong>
            <span>{claim}</span>
          </div>
        )}
        {actions.length > 0 && (
          <div className="df-dlv-actions">
            {actions.map((action) => (
              <button key={action} type="button" className={`df-button df-order-action${primary(action) ? ' df-order-action--primary' : danger(action) ? ' df-order-action--refund' : ''}`} disabled={busy} onClick={() => press(action)}>
                {label(action)}
              </button>
            ))}
          </div>
        )}
        {failure && (
          <p className="df-order-note" role="alert">
            {failure}
          </p>
        )}
        {!canAct && <p className="df-order-sub">{words.note.readOnly}</p>}
        {canAct && !canPick && view === 'unassigned' && <p className="df-order-sub">{words.note.assignOwner}</p>}
        {note && <p className="df-order-sub">{note}</p>}
        <div className="df-dlv-steps">
          <div className="df-order-card-head">
            <h3>{words.stepsTitle}</h3>
            <span className="df-order-sub">{fill(messages.orders.timesIn, { zone: zoneName(timeZone) })}</span>
          </div>
          <ol className="df-order-events">
            {steps.map((step, index) => (
              <li key={`${step.at}-${index}`}>
                <span className="df-order-event-time">{timeText(step.at, timeZone)}</span>
                <span>{step.text}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      {ask && (
        <ConfirmDialog
          key={ask.title}
          {...ask}
          open
          target={fill(messages.orders.detail.note.target, { number: order.number })}
          cancelLabel={ask.cancelLabel ?? messages.orders.detail.markPaid.cancel}
          error={error}
          onCancel={close}
        />
      )}
    </section>
  )
}

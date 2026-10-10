import { ConfirmDialog, EmptyState, ErrorState, Icon, LoadingState, StatusPill, Toast, useScreenState, type ConfirmDialogProps } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/detail.css'
import '@dripfunnel/shared/ui/states.css'
import { getRouteApi, Link, useParams } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addOrderNote, addTracking, cancelOrder, cancelReasons, loadOrder, markOrderPaid, shipItems, type Order, type OrderShipment } from '../../api/order'
import { loadStoreTimeZone } from '../../api/orders'
import { loadShipFrom, type Warehouse } from '../../api/stock'
import { harnessEnabled, harnessSearch } from '../../harness'
import { fill, formatCount, messages, plural } from '../../messages'
import { refusalIn } from '../common/refusal'
import { OrderHistory } from './OrderHistory'
import { allLeft, OrderParts, type Picks } from './OrderParts'
import { OrderShipments } from './OrderShipments'
import { OrderSide } from './OrderSide'
import { ShipPanel, type ShipForm, type ShipKind } from './ShipPanel'
import { orderSample, orderStates, sampleWarehouses } from './orderPageStates'
import { ordersSeatOf } from './ordersAccess'
import { canShipNow, methodText, nothingSent, orderStatus, paidByHand } from './orderDetail'
import { moneyText, paymentOf, statusPill } from './orderView'
import './order.css'
import './orders.css'

const words = messages.orders.detail
const cancelWords = messages.orders.cancel
const shellRoute = getRouteApi('/_app')
const refused = refusalIn({ ...words.refused, other: words.failed })

type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'missing' } | { kind: 'ready'; order: Order }
type Dialog = 'markPaid' | 'cancel' | 'note'

interface Action {
  key: string
  label: string
  tone: 'primary' | 'warning' | 'plain'
  disabled: boolean
  onClick: () => void
}

const leftOf = (order: Order): bigint => BigInt(order.total?.amount ?? '0') - BigInt(order.refunded?.amount ?? '0')

/** An order (PortalOrders detail, FIRST-RELEASE §6): its lines by who packs them, shipping, payment and history. ?state= per orderStates.ts. */
export const OrderPage = () => {
  const { acting, state } = shellRoute.useLoaderData()
  const { orderId = '' } = useParams({ strict: false })
  const forced = useScreenState(orderStates, harnessEnabled)
  const sample = useMemo(() => orderSample(forced), [forced])
  const { canRead, access } = useMemo(() => ordersSeatOf(forced, acting, state?.readOnly ?? false), [forced, acting, state])
  const store = acting.store.name

  const [view, setView] = useState<View>({ kind: 'loading' })
  const [timeZone, setTimeZone] = useState('UTC')
  const [picks, setPicks] = useState<Picks | null>(null)
  const [warehouses, setWarehouses] = useState<Warehouse[] | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const latest = useRef(0)

  const load = useCallback(() => {
    const mine = ++latest.current
    if (forced === 'loading') return setView({ kind: 'loading' })
    if (forced === 'error') return setView({ kind: 'error' })
    if (forced === 'notFound') return setView({ kind: 'missing' })
    if (sample) return setView({ kind: 'ready', order: sample })
    if (!canRead) return
    void loadOrder(orderId).then(
      (order) => {
        if (mine === latest.current) setView(order ? { kind: 'ready', order } : { kind: 'missing' })
      },
      () => {
        if (mine === latest.current) setView({ kind: 'error' })
      },
    )
  }, [forced, sample, canRead, orderId])
  useEffect(load, [load])

  useEffect(() => {
    if (forced) return setTimeZone(access.supplier ? 'UTC' : 'Asia/Kolkata')
    if (access.supplier || !canRead) return
    void loadStoreTimeZone().then((zone) => setTimeZone(zone ?? 'UTC'), () => setTimeZone('UTC'))
  }, [forced, access.supplier, canRead])

  const openShip = (order: Order) => {
    setFormError(null)
    setPicks(allLeft(order, access.supplier))
  }

  const shipOpen = picks !== null
  useEffect(() => {
    if (!shipOpen || warehouses) return
    if (sample) return setWarehouses(sampleWarehouses)
    void loadShipFrom(access.supplier).then(setWarehouses, () => {
      setPicks(null)
      setToast(words.failed)
    })
  }, [shipOpen, warehouses, sample, access.supplier])

  // The harness opens the form as the prototype's Ship items does.
  useEffect(() => {
    if (forced === 'shipping' && sample) setPicks(allLeft(sample, false))
  }, [forced, sample])

  if (!canRead)
    return (
      <div className="df-order">
        <EmptyState title={messages.orders.denied.title} body={messages.orders.denied.body} />
      </div>
    )

  const back = (
    <Link className="df-button df-order-back" to="/orders" search={(prev) => harnessSearch(prev, sample ? (access.supplier ? 'supplier' : 'list') : undefined)}>
      <Icon name="back" size={16} />
      {access.supplier ? words.backSupplier : words.back}
    </Link>
  )

  if (view.kind !== 'ready')
    return (
      <div className="df-order">
        <div className="df-order-head">{back}</div>
        {view.kind === 'loading' && <LoadingState label={words.loading} />}
        {view.kind === 'error' && <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: load }} />}
        {view.kind === 'missing' && <EmptyState title={words.notFound.title} body={words.notFound.body} action={back} />}
      </div>
    )

  const order = view.order
  const status = orderStatus(order, access.supplier)
  const pay = access.money ? paymentOf(order.paymentState) : null
  const left = allLeft(order, access.supplier)
  const firstName = order.customerName?.split(' ')[0] ?? null
  const shipKind: ShipKind = access.supplier ? (order.parts.some((p) => p.shippingMode === 'to-store') ? 'toStore' : 'courier') : order.shippingOption === 'pickup' ? 'pickup' : 'courier'
  const pickCount = picks ? Object.values(picks).reduce((sum, n) => sum + n, 0) : 0

  const run = async (work: () => Promise<void>, done: string, onError: (text: string) => void) => {
    setBusy(true)
    try {
      await work()
      setToast(done)
      setDialog(null)
      setPicks(null)
      load()
    } catch (error) {
      onError(refused(error))
    } finally {
      setBusy(false)
    }
  }

  const ship = (form: ShipForm) => {
    const lines = Object.entries(picks ?? {})
      .filter(([, quantity]) => quantity > 0)
      .map(([lineId, quantity]) => ({ lineId, quantity }))
    const count = { count: formatCount(pickCount) }
    const done =
      shipKind === 'toStore'
        ? fill(plural(words.ship.doneToStore, pickCount), { ...count, store })
        : shipKind === 'pickup'
          ? fill(plural(words.ship.doneHanded, pickCount), count)
          : firstName
            ? fill(plural(words.ship.done, pickCount), { ...count, name: firstName })
            : fill(plural(words.ship.doneShort, pickCount), count)
    if (sample) return setPicks(null)
    void run(() => shipItems({ orderId: order.id, ...form, lines }), done, setFormError)
  }

  const track = (shipment: OrderShipment, courierName: string | null, trackingNumber: string, trackingUrl: string | null) => {
    if (sample) return
    void run(() => addTracking(shipment.id, courierName, trackingNumber, trackingUrl), words.shipments.added, setFormError)
  }

  const actions: Action[] = []
  const ro = access.readOnly
  if (access.canShip && canShipNow(order, access.supplier) && Object.keys(left).length > 0)
    actions.push({ key: 'ship', label: picks ? words.actions.choosing : words.actions.ship, tone: 'primary', disabled: ro, onClick: () => openShip(order) })
  const awaitingHand = !access.supplier && order.state === 'placed' && order.paymentState === 'pending' && paidByHand(order.paymentMethod)
  // Shown disabled to a seat that can’t, with who can (FIRST-RELEASE §3.1).
  if (awaitingHand) actions.push({ key: 'markPaid', label: words.actions.markPaid, tone: 'warning', disabled: ro || !access.canMarkPaid, onClick: () => setDialog('markPaid') })
  if (access.canCancel && order.state === 'placed' && order.paymentState !== 'refunded' && nothingSent(order))
    actions.push({ key: 'cancel', label: words.actions.cancel, tone: 'plain', disabled: ro, onClick: () => setDialog('cancel') })

  const notes: string[] = []
  if (ro) notes.push(words.readOnly)
  else if (!access.canMarkPaid && awaitingHand) notes.push(words.staffOnly)

  const dialogProps = (): ConfirmDialogProps | null => {
    const shared = { open: true, target: fill(words.note.target, { number: order.number }), error: dialogError, onCancel: () => setDialog(null) }
    const failed = (text: string) => setDialogError(text)
    switch (dialog) {
      case 'markPaid':
        return {
          ...shared,
          title: fill(words.markPaid.title, { number: order.number }),
          consequence: fill(words.markPaid.body, { amount: order.total ? moneyText(order.total) : '', method: methodText(order.paymentMethod) }),
          confirmLabel: words.markPaid.confirm,
          cancelLabel: words.markPaid.cancel,
          onConfirm: () => void run(() => markOrderPaid(order.id), fill(words.markPaid.done, { number: order.number }), failed),
        }
      case 'cancel': {
        const paid = order.paymentState === 'paid' || order.paymentState === 'partly_refunded'
        const name = order.customerName ?? words.customer.guest
        const method = methodText(order.paymentMethod)
        const rest = order.total ? moneyText({ amount: String(leftOf(order)), currency: order.total.currency }) : null
        return {
          ...shared,
          danger: true,
          title: fill(cancelWords.title, { number: order.number }),
          consequence: !paid ? cancelWords.bodyUnpaid : access.money && rest ? fill(cancelWords.bodyPaid, { name, amount: rest, method }) : fill(cancelWords.bodyPaidNoAmount, { name, method }),
          confirmLabel: cancelWords.confirm,
          cancelLabel: cancelWords.keep,
          choices: [{ key: 'reason', label: cancelWords.reason, options: cancelReasons.map((r) => ({ value: r, label: cancelWords.reasons[r] })), initial: 'out_of_stock', error: () => null }],
          onConfirm: (_, __, picked) => {
            const reason = cancelReasons.find((r) => r === picked.reason) ?? 'store'
            void run(() => cancelOrder(order.id, reason), fill(cancelWords.done, { number: order.number }), failed)
          },
        }
      }
      case 'note':
        return {
          ...shared,
          title: words.note.title,
          consequence: words.note.body,
          confirmLabel: words.note.confirm,
          cancelLabel: words.note.cancel,
          input: { label: words.note.label, type: 'text', initial: '', placeholder: words.note.placeholder, error: (value) => (value.trim() === '' ? words.note.missing : value.trim().length > 1000 ? words.note.tooLong : null) },
          onConfirm: (_, value) => void run(() => addOrderNote(order.id, (value ?? '').trim()), words.note.done, failed),
        }
      case null:
        return null
    }
  }
  const openDialog = dialogProps()

  return (
    <div className="df-order">
      <div className="df-order-head">
        {back}
        <h1 className="df-order-number">{order.number}</h1>
        <StatusPill {...statusPill[status]} label={messages.orders.status[status]} />
        {pay && (
          <span className={pay === 'pending' || pay === 'authorised' ? 'df-order-pay df-order-pay--pending' : 'df-order-pay'}>
            {pay === 'refunded' || pay === 'partlyRefunded' ? fill(words.pay[pay], { amount: order.refunded ? moneyText(order.refunded) : '' }) : words.pay[pay]}
          </span>
        )}
        <span className="df-order-head-gap" />
        {actions.map((a) => (
          <button key={a.key} type="button" className={`df-button df-order-action df-order-action--${a.tone}`} disabled={a.disabled || busy} onClick={a.onClick}>
            {a.label}
          </button>
        ))}
      </div>
      {notes.map((n) => (
        <p key={n} className="df-order-note">
          {n}
        </p>
      ))}
      {order.test && <p className="df-order-info">{words.test}</p>}
      {access.supplier && <p className="df-order-info">{shipKind === 'toStore' ? words.supplierNote : words.supplierNoteShopper}</p>}

      <div className="df-order-grid">
        <div className="df-order-main">
          <OrderParts order={order} access={access} picks={picks} onPick={(lineId, quantity) => setPicks((current) => (current ? { ...current, [lineId]: Math.max(0, quantity) } : current))} />
          {picks && (
            <ShipPanel
              kind={shipKind}
              count={pickCount}
              warehouses={warehouses}
              store={store}
              busy={busy}
              error={formError}
              onCancel={() => setPicks(null)}
              onShip={ship}
            />
          )}
          <OrderShipments order={order} timeZone={timeZone} canTrack={(s) => access.canShip && !ro && (access.supplier || s.supplierId === null)} busy={busy} error={formError} onTrack={track} />
          <OrderHistory order={order} timeZone={timeZone} note={access.canNote ? { disabled: ro, onAdd: () => setDialog('note') } : null} />
        </div>
        <div className="df-order-aside">
          <OrderSide order={order} access={access} store={store} />
        </div>
      </div>

      {openDialog && (
        <ConfirmDialog
          {...openDialog}
          onConfirm={(...args) => {
            setDialogError(null)
            if (sample) return setDialog(null)
            openDialog.onConfirm(...args)
          }}
        />
      )}
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  )
}

import { EmptyState, ErrorState, LoadingState, StatusPill, Toast, useScreenState } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/detail.css'
import '@dripfunnel/shared/ui/states.css'
import { getRouteApi, Link, useParams } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadCart, loadReminderSending, type CartDetail } from '../../api/carts'
import { loadOfferPlace } from '../../api/offers'
import { harnessEnabled, harnessSearch } from '../../harness'
import { fill, formatCount, formatList, messages, plural } from '../../messages'
import { regionWords } from '../offers/offerView'
import { moneyText } from '../orders/orderView'
import { useCartActions } from './cartActions'
import { cartStates, sampleDetail } from './cartStates'
import { agoText, cartAccessOf, canRemind, pillOf, eventsOf, statusLine, stepText, type Sender } from './cartView'
import './carts.css'

const words = messages.carts
const shellRoute = getRouteApi('/_app')

type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'missing' } | { kind: 'ready'; detail: CartDetail }

/** One abandoned cart (Carts › cart view): what's in it as it would be bought now, what happened, and the shopper. */
export const CartPage = () => {
  const { acting, state } = shellRoute.useLoaderData()
  const { cartId = '' } = useParams({ strict: false })
  const forced = useScreenState(cartStates, harnessEnabled)
  const access = useMemo(() => cartAccessOf(forced, acting, state?.readOnly ?? false), [forced, acting, state])
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [country, setCountry] = useState<string | null>(null)
  const [sending, setSending] = useState<{ enabled: boolean; level: string } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const latest = useRef(0)

  const load = useCallback(() => {
    const mine = ++latest.current
    if (forced === 'loading') return setView({ kind: 'loading' })
    if (forced === 'error') return setView({ kind: 'error' })
    if (forced) {
      const detail = sampleDetail(cartId)
      return setView(detail ? { kind: 'ready', detail } : { kind: 'missing' })
    }
    if (!access.canRead) return
    void loadCart(cartId).then(
      (detail) => mine === latest.current && setView(detail ? { kind: 'ready', detail } : { kind: 'missing' }),
      () => mine === latest.current && setView({ kind: 'error' }),
    )
  }, [forced, access.canRead, cartId])
  useEffect(load, [load])

  useEffect(() => {
    if (forced) {
      setCountry('IN')
      return setSending({ enabled: forced !== 'youSend', level: forced === 'youSend' ? 'youSend' : 'automatic' })
    }
    if (!access.canRead) return
    void loadOfferPlace().then((p) => setCountry(p.country), () => undefined)
    void loadReminderSending().then(setSending, () => setSending(null))
  }, [forced, access.canRead])

  const sender: Sender = access.readOnly ? 'paused' : !sending || !sending.enabled || sending.level === 'youSend' ? 'merchant' : 'schedule'
  const actions = useCartActions({
    sample: Boolean(forced),
    canUpgrade: access.canUpgrade,
    codes: sending?.level === 'automatic',
    scheduled: sender === 'schedule',
    onDone: (message) => {
      setToast(message)
      load()
    },
  })

  const crumb = (
    <nav className="df-breadcrumb" aria-label={words.crumbs}>
      <Link to="/carts" search={(prev) => harnessSearch(prev, forced ?? undefined)}>
        {words.title}
      </Link>
      <span aria-hidden="true">/</span>
      <span aria-current="page">{view.kind === 'ready' ? (view.detail.cart.name ?? words.guest) : words.cart}</span>
    </nav>
  )

  // A supplier, or a seat without carts.read, meets "not found" rather than learning a cart exists.
  if (!access.canRead || view.kind === 'missing') return <div className="df-carts"><EmptyState title={words.denied.title} body={view.kind === 'missing' && access.canRead ? words.missing : words.denied.body} /></div>
  if (view.kind === 'loading') return <div className="df-carts">{crumb}<LoadingState label={words.loadingCart} /></div>
  if (view.kind === 'error') return <div className="df-carts">{crumb}<ErrorState title={words.error.titleCart} body={words.error.body} retry={{ label: words.error.retry, onRetry: load }} /></div>

  const { cart, lines } = view.detail
  const now = new Date()
  const gone = lines.filter((l) => l.outOfStock)
  const remind = access.canEdit && canRemind(cart)
  const start = (act: 'send' | 'stop' | 'resume') => {
    setFailure(null)
    actions.start(cart, act, setFailure)
  }
  const stockOf = (l: CartDetail['lines'][number]) => (l.outOfStock ? words.stock.out : l.available !== null && l.available < 5 ? fill(words.stock.few, { count: formatCount(l.available) }) : words.stock.in)

  return (
    <div className="df-carts">
      {crumb}
      <div className="df-cart-head">
        <div className="df-cart-title">
          <div className="df-cart-title-line">
            <h1 className="df-page-title">{cart.name ?? words.guest}</h1>
            <StatusPill {...pillOf(cart, sender)} />
          </div>
          <span className="df-carts-sub">{fill(words.page.left, { line: statusLine(cart, now, sender), step: stepText(cart.step, country), ago: agoText(cart.abandonedAt, now) })}</span>
        </div>
        <div className="df-cart-acts">
          {remind && (
            <button type="button" className="df-button df-button--primary" disabled={actions.busy} onClick={() => start('send')}>
              {words.menu.send}
            </button>
          )}
          {cart.recoveredOrderId && (
            <Link className="df-button df-button--primary" to="/orders/$orderId" params={{ orderId: cart.recoveredOrderId }}>
              {fill(words.menu.order, { number: cart.recoveredOrderNumber ?? '' })}
            </Link>
          )}
          {remind && (
            <button type="button" className="df-button" disabled={actions.busy} onClick={() => start('stop')}>
              {words.menu.stop}
            </button>
          )}
          {access.canEdit && cart.status === 'stopped' && (
            <button type="button" className="df-button" disabled={actions.busy} onClick={() => start('resume')}>
              {words.menu.resume}
            </button>
          )}
          {cart.customerId && (
            <Link className="df-button" to="/customers" search={{ customer: cart.customerId }}>
              {words.page.customer}
            </Link>
          )}
        </div>
      </div>
      {access.readOnly && <p className="df-carts-note df-carts-note--warning" role="status"><strong>{words.notes.readOnlyTitle}</strong> {words.notes.readOnly}</p>}
      {gone.length > 0 && cart.status !== 'recovered' && (
        <p className="df-carts-note df-carts-note--warning" role="status">
          {gone.length === lines.length ? words.page.allGone : fill(plural(words.page.someGone, gone.length), { names: formatList(gone.map((l) => l.name ?? words.page.item)) })}
        </p>
      )}
      {failure && <p className="df-carts-note df-carts-note--danger" role="alert">{failure}</p>}

      <div className="df-cart-grid">
        <div className="df-cart-column">
          <section className="df-cart-card" aria-labelledby="df-cart-lines">
            <h2 id="df-cart-lines">{words.page.inCart}</h2>
            <ul className="df-cart-lines">
              {lines.map((l) => (
                <li key={l.versionId}>
                  <span className="df-carts-cell">
                    <strong>{[l.name ?? words.page.item, l.versionName].filter(Boolean).join(' · ')}</strong>
                    <span className={l.outOfStock ? 'df-carts-sub df-carts-bad' : 'df-carts-sub'}>{fill(words.page.qty, { count: formatCount(l.quantity), stock: stockOf(l) })}</span>
                  </span>
                  <span>{l.lineTotal ? moneyText(l.lineTotal) : '—'}</span>
                </li>
              ))}
            </ul>
            <div className="df-cart-total">
              <span>{words.page.value}</span>
              <strong>{cart.value ? moneyText(cart.value) : '—'}</strong>
            </div>
            <span className="df-carts-sub">{fill(words.page.valueNote, { ship: regionWords(country).ship })}</span>
          </section>
          <section className="df-cart-card" aria-labelledby="df-cart-events">
            <h2 id="df-cart-events">{words.page.happened}</h2>
            <ol className="df-cart-events">
              {eventsOf(view.detail, country).map((e) => (
                <li key={e.key} data-tone={e.tone}>
                  <span>{e.what}</span>
                  {e.at && <span className="df-carts-sub">{agoText(e.at, now)}</span>}
                </li>
              ))}
            </ol>
          </section>
        </div>
        <div className="df-cart-column">
          <section className="df-cart-card" aria-labelledby="df-cart-shopper">
            <h2 id="df-cart-shopper">{words.page.shopper}</h2>
            <dl className="df-cart-facts">
              <div>
                <dt>{words.page.email}</dt>
                <dd>{cart.email ?? words.page.notGiven}</dd>
              </div>
              <div>
                <dt>{words.page.phone}</dt>
                <dd>{cart.phone ?? '—'}</dd>
              </div>
              <div>
                <dt>{words.page.sent}</dt>
                <dd>{formatCount(cart.remindersSent)}</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
      {actions.dialog}
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  )
}

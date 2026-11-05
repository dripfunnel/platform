import { EmptyState, ErrorState, LoadingState, Toast, useScreenState } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/detail.css'
import '@dripfunnel/shared/ui/states.css'
import { getRouteApi, Link, useParams } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadWishlistShopper, type WishlistReminder, type WishlistShopperDetail } from '../../api/wishlists'
import { harnessEnabled, harnessSearch } from '../../harness'
import { fill, messages } from '../../messages'
import { moneyText } from '../orders/orderView'
import { cartStates, sampleWishlistShopper } from './cartStates'
import { agoText, cartAccessOf } from './cartView'
import { useWishlistActions } from './wishlistActions'
import { itemsText } from './WishlistsPane'
import './carts.css'

const words = messages.carts
const w = words.wishlists.page
const shellRoute = getRouteApi('/_app')

type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'missing' } | { kind: 'ready'; detail: WishlistShopperDetail }

/** One shopper's wishlist (Carts › Wishlists): what they saved, as they could see it now. Read only for every seat. */
export const WishlistShopperPage = () => {
  const { acting, state } = shellRoute.useLoaderData()
  const { customerId = '' } = useParams({ strict: false })
  const forced = useScreenState(cartStates, harnessEnabled)
  const access = useMemo(() => cartAccessOf(forced, acting, state?.readOnly ?? false), [forced, acting, state])
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [toast, setToast] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const latest = useRef(0)

  const load = useCallback(() => {
    const mine = ++latest.current
    if (forced === 'loading') return setView({ kind: 'loading' })
    if (forced === 'error') return setView({ kind: 'error' })
    if (forced) {
      const detail = sampleWishlistShopper(customerId)
      return setView(detail ? { kind: 'ready', detail } : { kind: 'missing' })
    }
    if (!access.canRead) return
    // Another shopper never shows under this one's address while it loads.
    setView((current) => (current.kind === 'ready' && current.detail.shopper.customerId === customerId ? current : { kind: 'loading' }))
    void loadWishlistShopper(customerId).then(
      (detail) => mine === latest.current && setView(detail ? { kind: 'ready', detail } : { kind: 'missing' }),
      () => mine === latest.current && setView({ kind: 'error' }),
    )
  }, [forced, access.canRead, customerId])
  useEffect(load, [load])
  const actions = useWishlistActions({
    sample: forced !== null,
    canUpgrade: access.canUpgrade,
    onDone: (done) => {
      setToast(done)
      load()
    },
  })

  const crumb = (
    <nav className="df-breadcrumb" aria-label={w.crumbs}>
      <Link to="/carts" search={(prev) => ({ ...harnessSearch(prev, forced ?? undefined), pane: 'wishlists' })}>
        {words.title}
      </Link>
      <span aria-hidden="true">/</span>
      <span aria-current="page">{view.kind === 'ready' ? (view.detail.shopper.name ?? words.guest) : w.title}</span>
    </nav>
  )

  // A supplier, or a seat without carts.read, meets "not found" rather than learning a wishlist exists.
  if (!access.canRead || view.kind === 'missing') return <div className="df-carts"><EmptyState title={words.denied.title} body={view.kind === 'missing' && access.canRead ? w.missing : words.denied.body} /></div>
  if (view.kind === 'loading') return <div className="df-carts">{crumb}<LoadingState label={w.loading} /></div>
  if (view.kind === 'error') return <div className="df-carts">{crumb}<ErrorState title={w.errorTitle} body={words.error.body} retry={{ label: words.error.retry, onRetry: load }} /></div>

  const { shopper, items, reminders } = view.detail
  const a = words.wishlists.act
  const stopped = shopper.stoppedAt !== null
  const canRemind = access.canEdit && !stopped && shopper.email !== null && shopper.items > 0
  const entry = (r: WishlistReminder) => {
    const who = r.position ? fill(w.step, { n: String(r.position) }) : r.sentBy ? fill(w.byHand, { name: r.sentBy }) : w.byHandUnknown
    const skip = r.state === 'skipped' && r.skipReason ? (w.skips as Record<string, string>)[r.skipReason] ?? null : null
    return { who, state: (w.states as Record<string, string>)[r.state] ?? r.state, skip, at: r.sentAt ?? r.queuedAt }
  }
  return (
    <div className="df-carts">
      {crumb}
      <div className="df-cart-head">
        <div className="df-cart-title">
          <h1 className="df-page-title">{shopper.name ?? words.guest}</h1>
          <span className="df-carts-sub">{fill(w.saved, { items: itemsText(shopper.items), ago: agoText(shopper.lastSavedAt, new Date()) })}</span>
        </div>
        <div className="df-cart-acts">
          {canRemind && (
            <button type="button" className="df-button" onClick={() => { setFailure(null); actions.start(shopper, 'send', setFailure) }}>
              {a.send}
            </button>
          )}
          {access.canEdit && (stopped ? (
            <button type="button" className="df-button" disabled={actions.busy} onClick={() => { setFailure(null); actions.start(shopper, 'resume', setFailure) }}>
              {a.resume}
            </button>
          ) : (
            <button type="button" className="df-button" onClick={() => { setFailure(null); actions.start(shopper, 'stop', setFailure) }}>
              {a.stop}
            </button>
          ))}
          <Link className="df-button" to="/customers" search={{ customer: shopper.customerId }}>
            {w.customer}
          </Link>
        </div>
      </div>
      {failure && <p className="df-carts-note df-carts-note--danger" role="alert">{failure}</p>}
      <div className="df-cart-grid">
        <div className="df-cart-column">
          <section className="df-cart-card" aria-labelledby="df-wish-items">
            <h2 id="df-wish-items">{w.heading}</h2>
            <ul className="df-cart-wishes">
              {items.map((i) => (
                <li key={i.productId}>
                  {i.photoUrl ? <img className="df-cart-wish-photo" src={i.photoUrl} alt="" loading="lazy" /> : <span className="df-cart-wish-photo df-cart-wish-photo--none" aria-hidden="true" />}
                  <span className="df-carts-cell df-cart-wish-name">
                    <strong>{i.name ?? words.page.item}</strong>
                    {!i.inStock && <span className="df-carts-sub df-carts-bad">{w.outOfStock}</span>}
                  </span>
                  <span>{i.price ? moneyText(i.price) : '—'}</span>
                </li>
              ))}
            </ul>
            <span className="df-carts-sub">{w.note}</span>
          </section>
        </div>
        <div className="df-cart-column">
          <section className="df-cart-card" aria-labelledby="df-wish-reminders">
            <h2 id="df-wish-reminders">{w.status}</h2>
            {stopped && (
              <p className="df-carts-note df-carts-note--warning">
                {fill(w.stopped, { name: shopper.stoppedBy ?? words.guest })}
                {shopper.stoppedNote ? ` ${fill(w.stoppedNote, { note: shopper.stoppedNote })}` : ''}
              </p>
            )}
            {!stopped && shopper.email === null && <p className="df-carts-sub">{w.noEmail}</p>}
            {reminders.length === 0 ? (
              <p className="df-carts-sub">{w.none}</p>
            ) : (
              <ul className="df-cart-wishes" aria-label={w.history}>
                {reminders.map((r) => {
                  const e = entry(r)
                  return (
                    <li key={r.id}>
                      <span className="df-carts-cell">
                        <strong>{e.who}</strong>
                        <span className="df-carts-sub">{[e.state, e.skip].filter(Boolean).join(words.joiner)}</span>
                      </span>
                      <span className="df-carts-sub">{agoText(e.at, new Date())}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
          <section className="df-cart-card" aria-labelledby="df-wish-shopper">
            <h2 id="df-wish-shopper">{words.page.shopper}</h2>
            <dl className="df-cart-facts">
              <div>
                <dt>{words.page.email}</dt>
                <dd>{shopper.email ?? words.page.notGiven}</dd>
              </div>
              <div>
                <dt>{words.wishlists.table.items}</dt>
                <dd>{itemsText(shopper.items)}</dd>
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

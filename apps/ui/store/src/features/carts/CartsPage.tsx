import { EmptyState, ErrorState, LoadingState, MoreActions, SearchField, StatusPill, Toast, usePhone, useScreenState } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/list.css'
import '@dripfunnel/shared/ui/states.css'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { cartPageSize, cartTabs, loadCartCounts, loadCarts, loadCartSummary, loadReminderSending, type AbandonedCart, type CartCounts, type CartPage, type CartSummary, type CartTab } from '../../api/carts'
import { loadOfferPlace } from '../../api/offers'
import { harnessEnabled, harnessSearch } from '../../harness'
import { fill, formatCount, formatList, messages, plural } from '../../messages'
import { moneyText } from '../orders/orderView'
import { useCartActions } from './cartActions'
import { cartSample, cartStates } from './cartStates'
import { agoText, cartAccessOf, canRemind, pillOf, itemsText, statusLine, stepText, senderOf } from './cartView'
import './carts.css'

const words = messages.carts
const shellRoute = getRouteApi('/_app')
const pageRoute = getRouteApi('/_app/carts')

// A page is shown only for the tab, search and page it was read for; anything else shows loading until its own answers.
type List = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; page: CartPage; key: string }
type Paging = { key: string; cursor: { after?: string | null; before?: string | null }; index: number }

const money = (list: readonly { amount: string; currency: string }[]) => (list.length ? formatList(list.map(moneyText)) : '—')

/** Abandoned carts (designs/Carts.dc.html, FIRST-RELEASE §9): the last 14 days, carts by where they stand, and each cart's actions. */
export const CartsPage = () => {
  const { acting, state } = shellRoute.useLoaderData()
  const { status } = pageRoute.useSearch()
  const navigate = useNavigate()
  const forced = useScreenState(cartStates, harnessEnabled)
  const sample = useMemo(() => cartSample(forced), [forced])
  const access = useMemo(() => cartAccessOf(forced, acting, state?.readOnly ?? false), [forced, acting, state])
  const phone = usePhone()
  const tab: CartTab = status ?? 'open'

  const [search, setSearch] = useState('')
  const [paging, setPaging] = useState<Paging>({ key: tab, cursor: {}, index: 0 })
  const [list, setList] = useState<List>({ kind: 'loading' })
  const [counts, setCounts] = useState<CartCounts | null>(null)
  const [summary, setSummary] = useState<CartSummary | null>(null)
  const [place, setPlace] = useState<{ timeZone: string; country: string | null }>({ timeZone: 'UTC', country: null })
  const [sending, setSending] = useState<{ enabled: boolean; level: string } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const latest = useRef(0)

  // A page belongs to the tab and search it was read in: any other starts on its first page.
  const key = `${tab}|${search}`
  const cursor = useMemo(() => (paging.key === key ? paging.cursor : {}), [paging, key])
  const pageIndex = paging.key === key ? paging.index : 0

  // Only the latest request answers: a slow read of another tab or search never replaces the one on screen.
  const load = useCallback(() => {
    const mine = ++latest.current
    if (forced === 'loading') return setList({ kind: 'loading' })
    if (forced === 'error') return setList({ kind: 'error' })
    if (sample) return setList({ kind: 'ready', key: '', page: { rows: sample[tab].filter((c) => !search || `${c.name ?? ''} ${c.email ?? ''} ${c.firstItem ?? ''}`.toLowerCase().includes(search.toLowerCase())), next: null, previous: null } })
    if (!access.canRead) return
    const read = JSON.stringify([tab, search, cursor])
    setList((current) => (current.kind === 'ready' && current.key === read ? current : { kind: 'loading' }))
    void loadCarts(tab, search, cursor).then(
      (page) => mine === latest.current && setList({ kind: 'ready', page, key: read }),
      () => mine === latest.current && setList({ kind: 'error' }),
    )
  }, [forced, sample, access.canRead, tab, search, cursor])
  useEffect(load, [load])

  // The counts, tiles, the store's country and how reminders go are hints beside the list: a failure leaves them out.
  const loadMeta = useCallback(() => {
    if (forced === 'loading' || forced === 'error') return
    if (sample) {
      setCounts(sample.counts)
      setSummary(sample.summary)
      setPlace({ timeZone: 'Asia/Kolkata', country: 'IN' })
      return setSending({ enabled: forced !== 'youSend', level: forced === 'youSend' ? 'youSend' : 'automatic' })
    }
    if (!access.canRead) return
    void loadCartCounts().then(setCounts, () => setCounts(null))
    void loadCartSummary().then(setSummary, () => setSummary(null))
    void loadOfferPlace().then(setPlace, () => undefined)
    void loadReminderSending().then(setSending, () => setSending(null))
  }, [forced, sample, access.canRead])
  useEffect(loadMeta, [loadMeta])

  const sender = senderOf(access.readOnly, sending)
  const actions = useCartActions({
    sample: Boolean(sample),
    canUpgrade: access.canUpgrade,
    codes: sending?.level === 'automatic',
    scheduled: sender === 'schedule',
    onDone: (message) => {
      setToast(message)
      load()
      loadMeta()
    },
  })

  const tabsId = useId()
  const tabRefs = useRef<Partial<Record<CartTab, HTMLButtonElement | null>>>({})
  const goTab = (next: CartTab) => void navigate({ to: '/carts', search: (prev) => ({ ...harnessSearch(prev, forced ?? undefined), status: next === 'open' ? undefined : next }), replace: true })
  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = cartTabs.indexOf(tab)
    const next = event.key === 'ArrowRight' ? cartTabs[(at + 1) % cartTabs.length] : event.key === 'ArrowLeft' ? cartTabs[(at + cartTabs.length - 1) % cartTabs.length] : event.key === 'Home' ? cartTabs[0] : event.key === 'End' ? cartTabs[cartTabs.length - 1] : undefined
    if (!next) return
    event.preventDefault()
    goTab(next)
    tabRefs.current[next]?.focus()
  }

  if (!access.canRead)
    return (
      <div className="df-carts">
        <h1 className="df-page-title">{words.title}</h1>
        <EmptyState title={words.denied.title} body={words.denied.body} />
      </div>
    )

  const now = new Date()
  const rows = list.kind === 'ready' ? list.page.rows : []
  const none = counts !== null && counts.open + counts.recovered + counts.lost === 0
  const reachablePct = summary && summary.reachable > 0 ? Math.round((summary.recovered / summary.reachable) * 100) : null

  const menu = (cart: AbandonedCart) => {
    const remind = access.canEdit && canRemind(cart)
    const act = (which: 'send' | 'stop' | 'resume', close: () => void) => (
      <button key={which} type="button" className="df-button" onClick={() => {
          close()
          setFailure(null)
          actions.start(cart, which, setFailure)
        }}>
        {words.menu[which]}
        <span className="df-carts-menu-sub">{which === 'send' ? cart.email : words.menuSub[which]}</span>
      </button>
    )
    return (
      <MoreActions label={words.row.actions}>
        {(close) => (
          <>
            <Link className="df-button" to="/carts/$cartId" params={{ cartId: cart.id }} search={(prev) => harnessSearch(prev, forced ?? undefined)} onClick={close}>
              {words.menu.view}
              <span className="df-carts-menu-sub">{words.menuSub.view}</span>
            </Link>
            {remind && act('send', close)}
            {remind && act('stop', close)}
            {access.canEdit && cart.status === 'stopped' && act('resume', close)}
            {cart.recoveredOrderId && (
              <Link className="df-button" to="/orders/$orderId" params={{ orderId: cart.recoveredOrderId }} onClick={close}>
                {fill(words.menu.order, { number: cart.recoveredOrderNumber ?? '' })}
                <span className="df-carts-menu-sub">{words.menuSub.order}</span>
              </Link>
            )}
          </>
        )}
      </MoreActions>
    )
  }

  return (
    <div className="df-carts">
      <div className="df-carts-head">
        <h1 className="df-page-title">{words.title}</h1>
        <p className="df-page-lede">{words.lede}</p>
      </div>

      {access.readOnly && <p className="df-carts-note df-carts-note--warning" role="status"><strong>{words.notes.readOnlyTitle}</strong> {words.notes.readOnly}</p>}
      {access.viewOnly && <p className="df-carts-note df-carts-note--info" role="status"><strong>{words.notes.staffTitle}</strong> {words.notes.staff}</p>}
      {access.canEdit && sending?.level === 'youSend' && <p className="df-carts-note" role="status"><strong>{words.notes.youSendTitle}</strong> {words.notes.youSend}</p>}
      {access.canEdit && sending && sending.level !== 'youSend' && !sending.enabled && <p className="df-carts-note df-carts-note--warning" role="status"><strong>{words.notes.offTitle}</strong> {words.notes.off}</p>}
      {failure && <p className="df-carts-note df-carts-note--danger" role="alert">{failure}</p>}

      {none ? (
        <section className="df-carts-first" aria-labelledby="df-carts-first">
          <h2 id="df-carts-first">{words.first.title}</h2>
          <p className="df-carts-sub">{fill(words.first.body, { then: sender === 'schedule' ? words.first.auto : words.first.manual })}</p>
          <ol className="df-carts-how">
            {words.first.how.map((h, i) => (
              <li key={h.title}>
                <span aria-hidden="true">{i + 1}</span>
                <strong>{h.title}</strong>
                <span className="df-carts-sub">{h.body}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <>
          {summary && (
            <>
              <dl className="df-carts-tiles">
                <div>
                  <dt>{words.tiles.abandoned}</dt>
                  <dd>{formatCount(summary.abandoned)}</dd>
                  <span className="df-carts-sub">{fill(words.tiles.leftBehind, { amount: money(summary.leftBehind) })}</span>
                </div>
                <div>
                  <dt>{words.tiles.sent}</dt>
                  <dd>{formatCount(summary.remindersSent)}</dd>
                  <span className="df-carts-sub">{fill(plural(words.tiles.reachable, summary.reachable), { count: formatCount(summary.reachable) })}</span>
                </div>
                <div data-good>
                  <dt>{words.tiles.recovered}</dt>
                  <dd>{formatCount(summary.recovered)}</dd>
                  <span className="df-carts-sub">{reachablePct === null ? '—' : fill(words.tiles.pct, { pct: String(reachablePct) })}</span>
                </div>
                <div data-good>
                  <dt>{words.tiles.sales}</dt>
                  <dd>{money(summary.recoveredSales)}</dd>
                  <span className="df-carts-sub">{fill(plural(words.tiles.withCode, summary.recoveredWithCode), { count: formatCount(summary.recoveredWithCode) })}</span>
                </div>
              </dl>
              <p className="df-carts-sub">{fill(words.tiles.note, { days: String(summary.days) })}</p>
            </>
          )}

          <div className="df-carts-tabs" role="tablist" aria-label={words.tabs.label} onKeyDown={onTabKey}>
            {cartTabs.map((t) => (
              <button
                key={t}
                ref={(el) => {
                  tabRefs.current[t] = el
                }}
                id={`${tabsId}-${t}`}
                type="button"
                role="tab"
                aria-selected={tab === t}
                aria-controls={`${tabsId}-panel`}
                tabIndex={tab === t ? 0 : -1}
                onClick={() => goTab(t)}
              >
                {words.tabs[t]}
                <span className="df-carts-count">{counts ? formatCount(counts[t]) : '–'}</span>
              </button>
            ))}
          </div>

          <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${tab}`} className="df-carts-panel">
            <div className="df-carts-toolbar">
              <SearchField label={words.search.label} placeholder={words.search.placeholder} value={search || undefined} onChange={(value) => setSearch(value ?? '')} />
            </div>
            {list.kind === 'loading' && <LoadingState label={words.loading} />}
            {list.kind === 'error' && <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: load }} />}
            {list.kind === 'ready' && rows.length === 0 && (
              <div className="df-carts-empty">
                <strong>{search ? words.noMatch.title : words.empty[tab].title}</strong>
                <span>{search ? words.noMatch.body : words.empty[tab].body}</span>
              </div>
            )}
            {list.kind === 'ready' && rows.length > 0 && !phone && (
              <div className="df-carts-table" role="table" aria-label={fill(words.table.label, { tab: words.tabs[tab] })}>
                <div className="df-carts-row df-carts-row--head" role="row">
                  <span role="columnheader">{words.table.shopper}</span>
                  <span role="columnheader">{words.table.cart}</span>
                  <span role="columnheader">{words.table.value}</span>
                  <span role="columnheader">{words.table.left}</span>
                  <span role="columnheader">{words.table.reminders}</span>
                  <span role="columnheader">
                    <span className="df-visually-hidden">{words.row.actions}</span>
                  </span>
                </div>
                {rows.map((cart) => (
                  <div key={cart.id} className="df-carts-row" role="row">
                    <span role="cell" className="df-carts-cell">
                      <Link className="df-carts-name" to="/carts/$cartId" params={{ cartId: cart.id }} search={(prev) => harnessSearch(prev, forced ?? undefined)}>
                        {cart.name ?? words.guest}
                      </Link>
                      <span className="df-carts-sub">{cart.email ?? words.noEmail}</span>
                    </span>
                    <span role="cell" className="df-carts-cell">{itemsText(cart)}</span>
                    <span role="cell">{cart.value ? moneyText(cart.value) : '—'}</span>
                    <span role="cell" className="df-carts-cell">
                      <span>{stepText(cart.step, place.country)}</span>
                      <span className="df-carts-sub">{agoText(cart.abandonedAt, now)}</span>
                    </span>
                    <span role="cell" className="df-carts-cell">
                      <StatusPill {...pillOf(cart, sender)} />
                      <span className="df-carts-sub">{statusLine(cart, now, sender)}</span>
                    </span>
                    <span role="cell">{menu(cart)}</span>
                  </div>
                ))}
              </div>
            )}
            {list.kind === 'ready' && rows.length > 0 && phone && (
              <ul className="df-carts-cards" aria-label={fill(words.table.label, { tab: words.tabs[tab] })}>
                {rows.map((cart) => (
                  <li key={cart.id} className="df-carts-card">
                    <span className="df-carts-card-top">
                      <StatusPill {...pillOf(cart, sender)} />
                      <strong>{cart.value ? moneyText(cart.value) : '—'}</strong>
                    </span>
                    <Link className="df-carts-name" to="/carts/$cartId" params={{ cartId: cart.id }} search={(prev) => harnessSearch(prev, forced ?? undefined)}>
                      {cart.name ?? words.guest}
                    </Link>
                    <span className="df-carts-sub">{itemsText(cart)}</span>
                    <span className="df-carts-sub">{[stepText(cart.step, place.country), agoText(cart.abandonedAt, now), statusLine(cart, now, sender)].join(words.joiner)}</span>
                    {menu(cart)}
                  </li>
                ))}
              </ul>
            )}
            {list.kind === 'ready' && (list.page.next || list.page.previous) && (
              <nav className="df-carts-pager" aria-label={words.pages.label}>
                <span>{fill(words.pages.showing, { from: formatCount(pageIndex * cartPageSize + 1), to: formatCount(pageIndex * cartPageSize + rows.length) })}</span>
                <span>
                  <button type="button" className="df-button" disabled={!list.page.previous} onClick={() => setPaging({ key, cursor: { before: list.page.previous }, index: Math.max(0, pageIndex - 1) })}>
                    {words.pages.previous}
                  </button>
                  <button type="button" className="df-button" disabled={!list.page.next} onClick={() => setPaging({ key, cursor: { after: list.page.next }, index: pageIndex + 1 })}>
                    {words.pages.next}
                  </button>
                </span>
              </nav>
            )}
          </div>
        </>
      )}

      {actions.dialog}
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  )
}

import { ErrorState, LoadingState, MoreActions, SearchField, StatusPill, Toast, usePhone } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/list.css'
import '@dripfunnel/shared/ui/states.css'
import type { StatusIconName, StatusTone } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { loadWishlistCounts, loadWishlistShoppers, loadWishlistSummary, wishlistPageSize, wishlistTabs, type WishlistCounts, type WishlistPage, type WishlistShopper, type WishlistSummary, type WishlistTab } from '../../api/wishlists'
import { harnessSearch } from '../../harness'
import { fill, formatCount, messages, plural } from '../../messages'
import { tabKeyHandler } from '../common/tabKeys'
import { sampleWishlistCounts, sampleWishlistSummary } from './cartStates'
import { agoText, type CartAccess } from './cartView'
import { useWishlistActions } from './wishlistActions'

const words = messages.carts
const w = words.wishlists

type List = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; page: WishlistPage; key: string }
type Paging = { key: string; cursor: { after?: string | null; before?: string | null }; index: number }

export const itemsText = (count: number) => fill(plural(w.items, count), { count: formatCount(count) })

/** Where a shopper's reminders stand: stopped by the team, none yet, or how many went and when the last did. */
export const reminderStatus = (s: WishlistShopper, now: Date) => (s.stoppedAt ? w.status.stopped : s.lastSentAt ? fill(w.status.last, { count: formatCount(s.remindersSent), ago: agoText(s.lastSentAt, now) }) : w.status.none)

/** A shopper's pill, as a cart's: stopped or unreachable, reminded, or still waiting for a reminder. */
const pillOf = (s: WishlistShopper): { tone: StatusTone; icon: StatusIconName; label: string } =>
  s.stoppedAt ? { tone: 'neutral', icon: 'ban', label: w.pill.stopped } : s.email === null ? { tone: 'neutral', icon: 'cross', label: w.pill.noEmail } : s.remindersSent > 0 ? { tone: 'info', icon: 'clock', label: w.pill.reminded } : { tone: 'warning', icon: 'hour', label: w.pill.waiting }

/** The Wishlists list (FIRST-RELEASE §9): shoppers with a wishlist by reminder tab, newest saved first. Owner and Manager can remind, stop and resume from each row; Staff only read. */
export const WishlistsPane = ({ access, forced, sample, state }: { access: CartAccess; forced: 'loading' | 'error' | null; sample: WishlistShopper[] | null; state: string | undefined }) => {
  const phone = usePhone()
  const [tab, setTab] = useState<WishlistTab>('waiting')
  const [search, setSearch] = useState('')
  const [paging, setPaging] = useState<Paging>({ key: '', cursor: {}, index: 0 })
  const [list, setList] = useState<List>({ kind: 'loading' })
  const [counts, setCounts] = useState<WishlistCounts | null>(null)
  const [summary, setSummary] = useState<WishlistSummary | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const latest = useRef(0)

  // A page belongs to the tab and search it was read for: any other starts on its first page.
  const key = `${tab}|${search}`
  if (paging.key !== key) setPaging({ key, cursor: {}, index: 0 })
  const cursor = useMemo(() => (paging.key === key ? paging.cursor : {}), [paging, key])
  const pageIndex = paging.key === key ? paging.index : 0

  // Only the latest request answers: a slow search never replaces the one on screen.
  const load = useCallback(() => {
    const mine = ++latest.current
    if (forced === 'loading') return setList({ kind: 'loading' })
    if (forced === 'error') return setList({ kind: 'error' })
    if (sample) {
      const found = sample.filter((s) => (tab === 'stopped' ? s.stoppedAt : tab === 'reminded' ? !s.stoppedAt && s.remindersSent > 0 : !s.stoppedAt && s.remindersSent === 0) && (!search || `${s.name ?? ''} ${s.email ?? ''} ${s.firstProduct ?? ''}`.toLowerCase().includes(search.toLowerCase())))
      return setList({ kind: 'ready', key: '', page: { rows: found, next: null, previous: null } })
    }
    const read = JSON.stringify([tab, search, cursor])
    setList((current) => (current.kind === 'ready' && current.key === read ? current : { kind: 'loading' }))
    void loadWishlistShoppers(tab, search, cursor).then(
      (page) => mine === latest.current && setList({ kind: 'ready', page, key: read }),
      () => mine === latest.current && setList({ kind: 'error' }),
    )
  }, [forced, sample, tab, search, cursor])
  useEffect(load, [load])

  // The counts and tiles are hints beside the list: a failure leaves them out. A send or stop reloads them with the list.
  const [stamp, setStamp] = useState(0)
  useEffect(() => {
    if (forced) {
      setCounts(null)
      return setSummary(null)
    }
    if (sample) {
      setCounts(sampleWishlistCounts(sample))
      return setSummary(sampleWishlistSummary(sample))
    }
    void loadWishlistCounts().then(setCounts, () => setCounts(null))
    void loadWishlistSummary().then(setSummary, () => setSummary(null))
  }, [forced, sample, stamp])

  const tabsId = useId()
  const tabRefs = useRef<Partial<Record<WishlistTab, HTMLButtonElement | null>>>({})
  const onTabKey = tabKeyHandler(wishlistTabs, tab, setTab, (next) => tabRefs.current[next]?.focus())
  const total = counts ? counts.waiting + counts.reminded + counts.stopped : null

  const actions = useWishlistActions({
    sample: sample !== null,
    canUpgrade: access.canUpgrade,
    onDone: (done) => {
      setToast(done)
      setStamp((n) => n + 1)
      load()
    },
  })

  const now = new Date()
  const rows = list.kind === 'ready' ? list.page.rows : []
  const menu = (s: WishlistShopper) => {
    const remind = access.canEdit && !s.stoppedAt && s.email !== null && s.items > 0
    const act = (which: 'send' | 'stop' | 'resume', close: () => void, sub: string) => (
      <button key={which} type="button" className="df-button" onClick={() => {
          close()
          setFailure(null)
          actions.start(s, which, setFailure)
        }}>
        {words.menu[which]}
        <span className="df-carts-menu-sub">{sub}</span>
      </button>
    )
    return (
      <MoreActions label={words.row.actions}>
        {(close) => (
          <>
            <Link className="df-button" to="/carts/wishlist/$customerId" params={{ customerId: s.customerId }} search={(prev) => harnessSearch(prev, state)} onClick={close}>
              {w.menu.view}
              <span className="df-carts-menu-sub">{w.menu.viewSub}</span>
            </Link>
            {remind && act('send', close, s.email ?? '')}
            {remind && act('stop', close, w.menu.stopSub)}
            {access.canEdit && s.stoppedAt && act('resume', close, words.menuSub.resume)}
          </>
        )}
      </MoreActions>
    )
  }
  const pill = (s: WishlistShopper) => (
    <>
      <StatusPill {...pillOf(s)} />
      <span className="df-carts-sub">{reminderStatus(s, now)}</span>
    </>
  )
  const open = (s: WishlistShopper) => (
    <Link className="df-carts-name" to="/carts/wishlist/$customerId" params={{ customerId: s.customerId }} search={(prev) => harnessSearch(prev, state)}>
      {s.name ?? words.guest}
    </Link>
  )

  const reachablePct = summary && summary.reachable > 0 ? Math.round((summary.reminded / summary.reachable) * 100) : null

  return (
    <>
      {summary && (
        <>
          <dl className="df-carts-tiles">
            <div>
              <dt>{w.tiles.shoppers}</dt>
              <dd>{formatCount(summary.shoppers)}</dd>
              <span className="df-carts-sub">{fill(plural(w.tiles.products, summary.products), { count: formatCount(summary.products) })}</span>
            </div>
            <div>
              <dt>{w.tiles.sent}</dt>
              <dd>{formatCount(summary.remindersSent)}</dd>
              <span className="df-carts-sub">{fill(plural(w.tiles.reachable, summary.reachable), { count: formatCount(summary.reachable) })}</span>
            </div>
            <div data-good>
              <dt>{w.tiles.reminded}</dt>
              <dd>{formatCount(summary.reminded)}</dd>
              <span className="df-carts-sub">{reachablePct === null ? '—' : fill(w.tiles.pct, { pct: String(reachablePct) })}</span>
            </div>
            <div>
              <dt>{w.tiles.stopped}</dt>
              <dd>{counts ? formatCount(counts.stopped) : '—'}</dd>
              <span className="df-carts-sub">{w.tiles.stoppedNote}</span>
            </div>
          </dl>
          <p className="df-carts-sub">{fill(w.tiles.note, { days: String(summary.days) })}</p>
        </>
      )}

      <div className="df-carts-tabs" role="tablist" aria-label={w.tabs.label} onKeyDown={onTabKey}>
        {wishlistTabs.map((t) => (
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
            onClick={() => setTab(t)}
          >
            {w.tabs[t]}
            <span className="df-carts-count">{counts ? formatCount(counts[t]) : '–'}</span>
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${tab}`} className="df-carts-panel">
        <div className="df-carts-toolbar">
          <SearchField label={w.search.label} placeholder={w.search.placeholder} value={search || undefined} onChange={(value) => setSearch(value ?? '')} />
        </div>
        {failure && <p className="df-carts-note df-carts-note--danger" role="alert">{failure}</p>}
        {list.kind === 'loading' && <LoadingState label={words.loading} />}
        {list.kind === 'error' && <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: load }} />}
        {list.kind === 'ready' && rows.length === 0 && (
          <div className="df-carts-empty">
            <strong>{search ? w.noMatch.title : total === 0 ? w.empty.title : w.emptyTab[tab].title}</strong>
            <span>{search ? w.noMatch.body : total === 0 ? w.empty.body : w.emptyTab[tab].body}</span>
          </div>
        )}
        {list.kind === 'ready' && rows.length > 0 && !phone && (
          <div className="df-carts-table" role="table" aria-label={w.table.label}>
            <div className="df-carts-row df-carts-row--wish df-carts-row--head" role="row">
              <span role="columnheader">{w.table.shopper}</span>
              <span role="columnheader">{w.table.items}</span>
              <span role="columnheader">{w.table.newest}</span>
              <span role="columnheader">{w.table.when}</span>
              <span role="columnheader">{w.table.status}</span>
              <span role="columnheader">
                <span className="df-visually-hidden">{words.row.actions}</span>
              </span>
            </div>
            {rows.map((s) => (
              <div key={s.customerId} className="df-carts-row df-carts-row--wish" role="row">
                <span role="cell" className="df-carts-cell">
                  {open(s)}
                  <span className="df-carts-sub">{s.email ?? words.noEmail}</span>
                </span>
                <span role="cell">{itemsText(s.items)}</span>
                <span role="cell">{s.firstProduct ?? '—'}</span>
                <span role="cell">{agoText(s.lastSavedAt, now)}</span>
                <span role="cell" className="df-carts-cell">
                  {pill(s)}
                </span>
                <span role="cell">{menu(s)}</span>
              </div>
            ))}
          </div>
        )}
        {list.kind === 'ready' && rows.length > 0 && phone && (
          <ul className="df-carts-cards" aria-label={w.table.label}>
            {rows.map((s) => (
              <li key={s.customerId} className="df-carts-card">
                {open(s)}
                <span className="df-carts-sub">{s.email ?? words.noEmail}</span>
                <span className="df-carts-sub">{[itemsText(s.items), s.firstProduct, agoText(s.lastSavedAt, now)].filter(Boolean).join(words.joiner)}</span>
                {pill(s)}
                {menu(s)}
              </li>
            ))}
          </ul>
        )}
        {actions.dialog}
        <Toast message={toast} onDone={() => setToast(null)} />
        {list.kind === 'ready' && (list.page.next || list.page.previous) && (
          <nav className="df-carts-pager" aria-label={w.pages.label}>
            <span>{fill(words.pages.showing, { from: formatCount(pageIndex * wishlistPageSize + 1), to: formatCount(pageIndex * wishlistPageSize + rows.length) })}</span>
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
  )
}

import { EmptyState, ErrorState, LoadingState, MoreActions, SearchField, StatusPill, Toast, usePhone, useScreenState } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/list.css'
import '@dripfunnel/shared/ui/states.css'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { loadOfferCounts, loadOfferNames, loadOfferPlace, loadOffers, offerKinds, offerPageSize, offerTabs, type Offer, type OfferCounts, type OfferKind, type OfferPage, type OfferTab } from '../../api/offers'
import { harnessEnabled, harnessSearch } from '../../harness'
import { fill, formatCount, messages, plural } from '../../messages'
import { CodeCheck } from './CodeCheck'
import { FirstTime } from './FirstTime'
import { flash, takeFlash } from './flash'
import { actsFor, useOfferActions, type OfferAct } from './offerActions'
import { offerAccessOf } from './offerAccess'
import { offerSample, offerStates, sampleNames } from './offerStates'
import { kindOf, noNames, regionWords, statusKeyOf, statusLook, timeLine, whatText, type OfferNames } from './offerView'
import './offerEditor.css'
import './offers.css'

const words = messages.offers
const shellRoute = getRouteApi('/_app')
const pageRoute = getRouteApi('/_app/offers')

type List = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; page: OfferPage }
type Counts = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; counts: OfferCounts }
type Cursor = { after?: string | null; before?: string | null }
// A page belongs to the tab it was read in: a tab reached any way (a click, Back, a link) starts on its first page.
type Paging = { tab: OfferTab; cursor: Cursor; index: number }

/** Offers (designs/Offers.dc.html, FIRST-RELEASE §8): tabs by status, search and filters, "Check a code", row actions. */
export const OffersPage = () => {
  const { acting, state } = shellRoute.useLoaderData()
  const { status } = pageRoute.useSearch()
  const navigate = useNavigate()
  const forced = useScreenState(offerStates, harnessEnabled)
  const sample = useMemo(() => offerSample(forced), [forced])
  const access = useMemo(() => offerAccessOf(forced, acting, state?.readOnly ?? false), [forced, acting, state])
  const phone = usePhone()
  const tab: OfferTab = status ?? 'live'

  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<OfferKind | null>(null)
  const [trigger, setTrigger] = useState<Offer['trigger'] | null>(null)
  const [paging, setPaging] = useState<Paging>({ tab, cursor: {}, index: 0 })
  const [list, setList] = useState<List>({ kind: 'loading' })
  const [counts, setCounts] = useState<Counts>({ kind: 'loading' })
  const [names, setNames] = useState<OfferNames>(noNames)
  const [place, setPlace] = useState<{ timeZone: string; country: string | null }>({ timeZone: 'UTC', country: null })
  const [toast, setToast] = useState<string | null>(() => takeFlash())
  const [failure, setFailure] = useState<string | null>(null)
  const latest = useRef(0)

  const cursor = useMemo(() => (paging.tab === tab ? paging.cursor : {}), [paging, tab])
  const pageIndex = paging.tab === tab ? paging.index : 0

  // Only the latest request answers: a slow read of the tab or search before never replaces the one on screen.
  const load = useCallback(() => {
    const mine = ++latest.current
    if (forced === 'loading') return setList({ kind: 'loading' })
    if (forced === 'error') return setList({ kind: 'error' })
    if (sample) {
      const q = search.trim().toLowerCase()
      const rows = sample[tab].filter((o) => (!kind || kindOf(o.action) === kind) && (!trigger || o.trigger === trigger) && (!q || o.name.toLowerCase().includes(q) || (o.code ?? '').toLowerCase().includes(q)))
      return setList({ kind: 'ready', page: { rows, next: null, previous: null } })
    }
    if (!access.canRead) return
    setList((current) => (current.kind === 'ready' ? current : { kind: 'loading' }))
    void loadOffers({ tab, kind, trigger, search }, cursor).then(
      (page) => mine === latest.current && setList({ kind: 'ready', page }),
      () => mine === latest.current && setList({ kind: 'error' }),
    )
  }, [forced, sample, access.canRead, tab, kind, trigger, search, cursor])
  useEffect(load, [load])

  const loadCounts = useCallback(() => {
    if (forced === 'loading' || forced === 'error') return
    if (sample) return setCounts({ kind: 'ready', counts: sample.counts })
    if (!access.canRead) return
    void loadOfferCounts().then(
      (c) => setCounts({ kind: 'ready', counts: c }),
      () => setCounts({ kind: 'error' }),
    )
  }, [forced, sample, access.canRead])
  useEffect(loadCounts, [loadCounts])

  // Names and the store's place only word the rows; when they fail the rows count instead and dates stay in UTC, named.
  useEffect(() => {
    if (forced) {
      setPlace({ timeZone: 'Asia/Kolkata', country: 'IN' })
      return setNames(sampleNames ?? noNames)
    }
    if (!access.canRead) return
    void loadOfferPlace().then(setPlace, () => undefined)
    void loadOfferNames().then(setNames, () => undefined)
  }, [forced, access.canRead])

  const actions = useOfferActions({
    sample: Boolean(sample),
    canUpgrade: access.canUpgrade,
    timeZone: place.timeZone,
    now: () => new Date(),
    onDone: (message, done) => {
      if (done.kind === 'duplicated') {
        flash(message)
        return void navigate({ to: '/offers/$offerId', params: { offerId: done.id }, search: (prev) => harnessSearch(prev) })
      }
      setToast(message)
      load()
      loadCounts()
    },
  })

  const tabsId = useId()
  const tabRefs = useRef<Partial<Record<OfferTab, HTMLButtonElement | null>>>({})
  const goTab = (next: OfferTab) => {
    void navigate({ to: '/offers', search: (prev) => ({ ...harnessSearch(prev, forced ?? undefined), status: next === 'live' ? undefined : next }), replace: true })
  }
  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = offerTabs.indexOf(tab)
    const next = event.key === 'ArrowRight' ? offerTabs[(at + 1) % offerTabs.length] : event.key === 'ArrowLeft' ? offerTabs[(at + offerTabs.length - 1) % offerTabs.length] : event.key === 'Home' ? offerTabs[0] : event.key === 'End' ? offerTabs[offerTabs.length - 1] : undefined
    if (!next) return
    event.preventDefault()
    goTab(next)
    tabRefs.current[next]?.focus()
  }
  const filter = (next: { search?: string; kind?: OfferKind | null; trigger?: Offer['trigger'] | null }) => {
    if (next.search !== undefined) setSearch(next.search)
    if (next.kind !== undefined) setKind(next.kind)
    if (next.trigger !== undefined) setTrigger(next.trigger)
    setPaging({ tab, cursor: {}, index: 0 })
  }

  if (!access.canRead)
    return (
      <div className="df-offers">
        <h1 className="df-page-title">{words.title}</h1>
        <EmptyState title={words.denied.title} body={words.denied.body} />
      </div>
    )

  const region = regionWords(place.country)
  const now = new Date()
  const total = counts.kind === 'ready' ? counts.counts.live + counts.counts.scheduled + counts.counts.off + counts.counts.ended : null
  const filtered = search !== '' || kind !== null || trigger !== null
  const rows = list.kind === 'ready' ? list.page.rows : []

  const menu = (offer: Offer) => {
    const acts = access.canEdit ? actsFor(offer, now) : []
    const item = (act: OfferAct, close: () => void) => (
      <button key={act} type="button" className="df-button" onClick={() => {
          close()
          setFailure(null)
          actions.start(offer, act, setFailure)
        }}>
        {words.menu[act]}
        <span className="df-offers-menu-sub">{words.menuSub[act]}</span>
      </button>
    )
    return (
      <MoreActions label={words.row.actions}>
        {(close) => (
          <>
            {access.canEdit && (
              <Link className="df-button" to="/offers/$offerId/edit" params={{ offerId: offer.id }} search={(prev) => harnessSearch(prev)} onClick={close}>
                {words.menu.edit}
                <span className="df-offers-menu-sub">{words.menuSub.edit}</span>
              </Link>
            )}
            <Link className="df-button" to="/offers/$offerId" params={{ offerId: offer.id }} search={(prev) => harnessSearch(prev, forced ?? undefined)} onClick={close}>
              {access.canEdit ? words.menu.results : words.menu.view}
              <span className="df-offers-menu-sub">{access.canEdit ? words.menuSub.results : words.menuSub.view}</span>
            </Link>
            {offer.code && (
              <button type="button" className="df-button" onClick={() => {
                  close()
                  void navigator.clipboard?.writeText(offer.code ?? '').then(() => setToast(fill(words.copied, { code: offer.code ?? '' })), () => setToast(words.copyFailed))
                }}>
                {words.menu.copy}
                <span className="df-offers-menu-sub">{offer.code}</span>
              </button>
            )}
            {acts.map((act) => item(act, close))}
          </>
        )}
      </MoreActions>
    )
  }

  const usesOf = (offer: Offer) => (offer.totalUsesLimit ? fill(words.row.usesOf, { used: formatCount(offer.usesCount), total: formatCount(offer.totalUsesLimit) }) : fill(plural(words.row.uses, offer.usesCount), { count: formatCount(offer.usesCount) }))
  const meter = (offer: Offer) => (offer.totalUsesLimit ? Math.min(100, Math.round((offer.usesCount / offer.totalUsesLimit) * 100)) : null)
  const empty = filtered ? null : words.empty[tab]

  return (
    <div className="df-offers">
      <div className="df-offers-head">
        <div>
          <h1 className="df-page-title">{words.title}</h1>
          <p className="df-page-lede">{fill(words.lede, { ship: region.ship })}</p>
        </div>
        {access.canEdit && !phone && (
          <Link className="df-button df-button--primary" to="/offers/new" search={(prev) => harnessSearch(prev)}>
            {words.create}
          </Link>
        )}
      </div>

      {access.readOnly && <p className="df-offers-note df-offers-note--warning" role="status"><strong>{words.notes.readOnlyTitle}</strong> {words.notes.readOnly}</p>}
      {access.viewOnly && <p className="df-offers-note df-offers-note--info" role="status"><strong>{words.notes.staffTitle}</strong> {words.notes.staff}</p>}
      {failure && <p className="df-offers-note df-offers-note--danger" role="alert">{failure}</p>}

      {counts.kind === 'ready' && total === 0 ? (
        access.canEdit ? (
          <FirstTime ship={region.ship} />
        ) : (
          <EmptyState title={words.firstTime.title} body={fill(words.firstTime.body, { ship: region.ship })} />
        )
      ) : (
        <>
          <CodeCheck sample={sample ? [...sample.live, ...sample.scheduled, ...sample.off, ...sample.ended] : null} timeZone={place.timeZone} />

          <div className="df-offers-tabs" role="tablist" aria-label={words.tabs.label} onKeyDown={onTabKey}>
            {offerTabs.map((t) => (
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
                <span className="df-offers-count">{counts.kind === 'ready' ? formatCount(counts.counts[t]) : '–'}</span>
              </button>
            ))}
          </div>

          <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${tab}`} className="df-offers-panel">
            <div className="df-offers-toolbar">
              <SearchField label={words.search.label} placeholder={words.search.placeholder} value={search || undefined} onChange={(value) => filter({ search: value ?? '' })} />
              <select className="df-list-select" aria-label={words.filters.type} value={kind ?? 'all'} onChange={(e) => filter({ kind: offerKinds.find((k) => k === e.target.value) ?? null })}>
                <option value="all">{words.filters.allTypes}</option>
                {offerKinds.map((k) => (
                  <option key={k} value={k}>
                    {fill(words.kinds[k], { ship: region.ship })}
                  </option>
                ))}
              </select>
              <select className="df-list-select" aria-label={words.filters.how} value={trigger ?? 'all'} onChange={(e) => filter({ trigger: e.target.value === 'automatic' || e.target.value === 'code' ? e.target.value : null })}>
                <option value="all">{words.filters.allHow}</option>
                <option value="automatic">{words.filters.automatic}</option>
                <option value="code">{words.filters.code}</option>
              </select>
            </div>

            {list.kind === 'loading' && <LoadingState label={words.loading} />}
            {list.kind === 'error' && <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: load }} />}
            {list.kind === 'ready' && rows.length === 0 && (
              <div className="df-offers-empty">
                <strong>{empty ? empty.title : words.noMatch.title}</strong>
                <span>{empty ? fill(empty.body, { ship: region.ship }) : words.noMatch.body}</span>
                {!empty && (
                  <button type="button" className="df-button" onClick={() => filter({ search: '', kind: null, trigger: null })}>
                    {words.noMatch.clear}
                  </button>
                )}
                {empty && access.canEdit && (tab === 'live' || tab === 'scheduled') && (
                  <Link className="df-button" to="/offers/new" search={(prev) => ({ ...harnessSearch(prev), recipe: tab === 'scheduled' ? 'seasonal' : undefined })}>
                    {tab === 'scheduled' ? words.empty.scheduled.cta : words.empty.live.cta}
                  </Link>
                )}
              </div>
            )}

            {list.kind === 'ready' && rows.length > 0 && !phone && (
              <div className="df-offers-table" role="table" aria-label={fill(words.table.label, { tab: words.tabs[tab] })}>
                <div className="df-offers-row df-offers-row--head" role="row">
                  <span role="columnheader">{words.table.offer}</span>
                  <span role="columnheader">{words.table.code}</span>
                  <span role="columnheader">{words.table.status}</span>
                  <span role="columnheader">{words.table.uses}</span>
                  <span role="columnheader">
                    <span className="df-visually-hidden">{words.row.actions}</span>
                  </span>
                </div>
                {rows.map((offer) => {
                  const key = statusKeyOf(offer, now)
                  const pct = meter(offer)
                  return (
                    <div key={offer.id} className="df-offers-row" role="row">
                      <span role="cell" className="df-offers-cell">
                        <Link className="df-offers-name" to="/offers/$offerId" params={{ offerId: offer.id }} search={(prev) => harnessSearch(prev, forced ?? undefined)}>
                          {offer.name}
                        </Link>
                        <span className="df-offers-sub">{whatText(offer, region, names)}</span>
                      </span>
                      <span role="cell">{offer.code ? <code className="df-offers-code">{offer.code}</code> : <span className="df-offers-sub">{offer.trigger === 'code' ? words.row.singleUse : words.row.automatic}</span>}</span>
                      <span role="cell" className="df-offers-cell">
                        <StatusPill tone={statusLook[key].tone} icon={statusLook[key].icon} label={words.status[key]} />
                        <span className="df-offers-sub">{timeLine(offer, now, place.timeZone)}</span>
                      </span>
                      <span role="cell" className="df-offers-cell df-offers-uses">
                        {usesOf(offer)}
                        {pct !== null && (
                          <span className="df-offers-meter" aria-hidden="true">
                            <span style={{ width: `${pct}%` }} data-full={pct >= 100 || undefined} />
                          </span>
                        )}
                      </span>
                      <span role="cell">{menu(offer)}</span>
                    </div>
                  )
                })}
              </div>
            )}

            {list.kind === 'ready' && rows.length > 0 && phone && (
              <ul className="df-offers-cards" aria-label={fill(words.table.label, { tab: words.tabs[tab] })}>
                {rows.map((offer) => {
                  const key = statusKeyOf(offer, now)
                  return (
                    <li key={offer.id} className="df-offers-card">
                      <span className="df-offers-card-top">
                        <StatusPill tone={statusLook[key].tone} icon={statusLook[key].icon} label={words.status[key]} />
                        <span className="df-offers-sub">{timeLine(offer, now, place.timeZone)}</span>
                      </span>
                      <Link className="df-offers-name" to="/offers/$offerId" params={{ offerId: offer.id }} search={(prev) => harnessSearch(prev, forced ?? undefined)}>
                        {offer.name}
                      </Link>
                      <span className="df-offers-sub">{whatText(offer, region, names)}</span>
                      <span className="df-offers-card-foot">
                        <code className="df-offers-code">{offer.code ?? (offer.trigger === 'code' ? words.row.singleUse : words.row.automatic)}</code>
                        <span>{usesOf(offer)}</span>
                      </span>
                      {menu(offer)}
                    </li>
                  )
                })}
              </ul>
            )}

            {list.kind === 'ready' && (list.page.next || list.page.previous) && (
              <nav className="df-offers-pager" aria-label={words.pages.label}>
                <span>{fill(words.pages.showing, { from: formatCount(pageIndex * offerPageSize + 1), to: formatCount(pageIndex * offerPageSize + rows.length) })}</span>
                <span>
                  <button type="button" className="df-button" disabled={!list.page.previous} onClick={() => {
                      setPaging({ tab, cursor: { before: list.page.previous }, index: Math.max(0, pageIndex - 1) })
                    }}>
                    {words.pages.previous}
                  </button>
                  <button type="button" className="df-button" disabled={!list.page.next} onClick={() => {
                      setPaging({ tab, cursor: { after: list.page.next }, index: pageIndex + 1 })
                    }}>
                    {words.pages.next}
                  </button>
                </span>
              </nav>
            )}
          </div>
        </>
      )}

      {access.canEdit && phone && (
        <Link className="df-offers-fab" to="/offers/new" search={(prev) => harnessSearch(prev)}>
          {words.createPlus}
        </Link>
      )}
      {actions.dialog}
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  )
}


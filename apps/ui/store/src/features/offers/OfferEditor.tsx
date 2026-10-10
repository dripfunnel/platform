import { isApiError } from '@dripfunnel/shared/graphql'
import { ConfirmDialog, EmptyState, ErrorState, LoadingState, StatusPill, Toast, usePhone, useScreenState } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/detail.css'
import '@dripfunnel/shared/ui/states.css'
import { getRouteApi, Link, useBlocker, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'
import { loadCollections } from '../../api/collections'
import { createGroup, loadCustomerGroups } from '../../api/customers'
import { loadFilters } from '../../api/filters'
import { loadAllMarkets } from '../../api/markets'
import { generateCodes, loadCustomerNames, loadOffer, loadOfferFacts, loadProductNames, offerKinds, saveOffer, type Offer } from '../../api/offers'
import { draftPrefix } from '../../drafts'
import { harnessEnabled, harnessSearch } from '../../harness'
import { fill, formatCount, messages, plural } from '../../messages'
import { seasonalDatesFor } from '../collections/seasonal'
import { offerAccessOf } from './offerAccess'
import { offerRefusal } from './offerActions'
import { blankDraft, draftOf, errorsOf, fitsDraft, inputOf, localOf, offerLimits, offerOf, recipes, type OfferDraft, type StoreFacts } from './offerDraft'
import { editorSample, editorStates } from './offerStates'
import { OfferForm, typedMoney, type FormLists } from './OfferForm'
import { zoneName } from '../orders/orderView'
import { dateTimeText, regionWords, sentence, statusKeyOf, statusLook, timeLine, type OfferNames } from './offerView'
import { ProductPicker } from './ProductPicker'
import { TypePicker } from './TypePicker'
import './offerEditor.css'
import './offers.css'

// The offer editor (designs/OfferEditor.dc.html, Set up; FIRST-RELEASE §8): the type picker and recipes, one page of
// five questions with the summary beside it, and Save asking Start now / Schedule / Keep off (#337).

const words = messages.offers.editor
const shellRoute = getRouteApi('/_app')
const searchSchema = z.object({ type: z.enum(offerKinds).optional().catch(undefined), recipe: z.enum(recipes).optional().catch(undefined) })

type Season = { name: string; on: Date } | null
type Loaded = { kind: 'loading' } | { kind: 'error' } | { kind: 'missing' } | { kind: 'ready'; facts: StoreFacts; lists: FormLists; offer: Offer | null; season: Season }
type Ask = 'start' | 'live' | null
type Done = { id: string; title: string; body: string }
type Picking = 'productIds' | 'buyIds' | 'getIds' | null

// Unsaved work survives a reload or a lost session in this tab (C4), tied to its store and the revision it started from.
const draftKey = (storeId: string, id: string | null) => `${draftPrefix}offer:${storeId}:${id ?? 'new'}`
const keptSchema = z.object({ revision: z.number().nullable(), draft: z.record(z.string(), z.unknown()) })
const keptDraft = (storeId: string, id: string | null, revision: number | null, template: OfferDraft): OfferDraft | null => {
  try {
    const kept = keptSchema.safeParse(JSON.parse(sessionStorage.getItem(draftKey(storeId, id)) ?? 'null'))
    if (kept.success && kept.data.revision === revision && fitsDraft(kept.data.draft, template)) return kept.data.draft
  } catch {
    // Unreadable storage is as good as nothing kept.
  }
  sessionStorage.removeItem(draftKey(storeId, id))
  return null
}
const holderSchema = z.object({ name: z.string(), status: z.string() })

export const OfferEditor = () => {
  const { acting, state } = shellRoute.useLoaderData()
  const storeId = acting.store.id
  const params: { offerId?: string } = useParams({ strict: false })
  const offerId = params.offerId ?? null
  const asked = searchSchema.parse(useSearch({ strict: false }))
  const navigate = useNavigate()
  const phone = usePhone()
  const forced = useScreenState(editorStates, harnessEnabled)
  const sample = useMemo(() => editorSample(forced), [forced])
  const access = useMemo(() => offerAccessOf(forced === 'staff' || forced === 'readOnly' || forced === 'denied' ? forced : forced ? 'list' : null, acting, state?.readOnly ?? false), [forced, acting, state])

  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' })
  const [draft, setDraft] = useState<OfferDraft | null>(null)
  const [orig, setOrig] = useState('')
  const [revision, setRevision] = useState<number | null>(null)
  const [restored, setRestored] = useState(false)
  const [productNames, setProductNames] = useState<Map<string, string>>(new Map())
  const [customerNames, setCustomerNames] = useState<Map<string, string>>(new Map())
  const [tried, setTried] = useState(forced === 'errors')
  const [codeTaken, setCodeTaken] = useState<string | null>(null)
  const [stale, setStale] = useState<number | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const [ask, setAsk] = useState<Ask>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [done, setDone] = useState<Done | null>(null)
  const [saving, setSaving] = useState(false)
  const [picking, setPicking] = useState<Picking>(null)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const leaving = useRef(false)

  useEffect(() => {
    let live = true
    if (forced === 'loading') return setLoaded({ kind: 'loading' })
    if (forced === 'error') return setLoaded({ kind: 'error' })
    if (sample) {
      setLoaded({ kind: 'ready', facts: sample.facts, lists: sample.lists, offer: sample.offer, season: null })
      setProductNames(new Map(sample.productNames))
      const d = sample.offer ? draftOf(sample.offer, sample.facts) : sample.pick ? null : blankDraft(asked.type ?? 'order', asked.recipe ?? null, { facts: sample.facts, now: new Date(), ship: regionWords(sample.facts.country).ship, season: null })
      setDraft(d)
      setOrig(JSON.stringify(d))
      setRevision(sample.offer?.revision ?? null)
      return
    }
    if (!access.canRead || access.viewOnly) return
    setLoaded({ kind: 'loading' })
    void Promise.all([loadOfferFacts(), loadFilters(), loadCollections(), loadCustomerGroups(), loadAllMarkets(), offerId ? loadOffer(offerId) : Promise.resolve(null)]).then(
      async ([facts, filters, collections, groups, markets, offer]) => {
        if (!live) return
        if (offerId && !offer) return setLoaded({ kind: 'missing' })
        const next = seasonalDatesFor(markets.filter((m) => m.active).flatMap((m) => m.countries).concat(facts.country ?? []), new Date(), 1)[0]
        const season = next ? { name: messages.collections.seasonal.names[next.key], on: next.on } : null
        const fresh = offer ? draftOf(offer, facts) : asked.type || asked.recipe ? blankDraft(asked.type ?? 'order', asked.recipe ?? null, { facts, now: new Date(), ship: regionWords(facts.country).ship, season }) : null
        const kept = keptDraft(storeId, offerId, offer?.revision ?? null, blankDraft('order', null, { facts, now: new Date(), ship: '', season: null }))
        const d = kept ?? fresh
        const [names, people] = await Promise.all([
          loadProductNames([...new Set([...(d?.productIds ?? []), ...(d?.buyIds ?? []), ...(d?.getIds ?? [])])]).catch(() => new Map<string, string>()),
          loadCustomerNames(d?.customerIds ?? []).catch(() => new Map<string, string>()),
        ])
        if (!live) return
        setProductNames(names)
        setCustomerNames(people)
        setDraft(d)
        setOrig(JSON.stringify(fresh))
        setRestored(kept !== null)
        setRevision(offer?.revision ?? null)
        setLoaded({ kind: 'ready', facts, lists: { filters, collections, groups, markets }, offer, season })
      },
      () => live && setLoaded({ kind: 'error' }),
    )
    return () => {
      live = false
    }
  }, [forced, sample, access.canRead, access.viewOnly, storeId, offerId, asked.type, asked.recipe, attempt])

  const dirty = draft !== null && JSON.stringify(draft) !== orig
  useEffect(() => {
    if (sample || !draft) return
    if (dirty) sessionStorage.setItem(draftKey(storeId, offerId), JSON.stringify({ revision, draft }))
    else sessionStorage.removeItem(draftKey(storeId, offerId))
  }, [draft, dirty, storeId, offerId, revision, sample])

  useBlocker({ shouldBlockFn: () => dirty && !leaving.current && !window.confirm(words.leave), enableBeforeUnload: () => dirty && !leaving.current })

  const back = (
    <nav className="df-breadcrumb" aria-label={messages.offers.page.crumbs}>
      <Link to="/offers" search={(prev) => harnessSearch(prev)}>
        {messages.offers.title}
      </Link>
      <span aria-hidden="true">/</span>
      <span aria-current="page">{loaded.kind === 'ready' && loaded.offer ? loaded.offer.name : words.crumbNew}</span>
    </nav>
  )

  if (!access.canRead) return <div className="df-offers"><EmptyState title={messages.offers.denied.title} body={messages.offers.denied.body} /></div>
  if (access.viewOnly)
    return (
      <div className="df-offers">
        <EmptyState title={words.staff.title} body={words.staff.body} />
        <Link className="df-button" to="/offers" search={(prev) => harnessSearch(prev)}>
          {words.staff.back}
        </Link>
      </div>
    )
  if (loaded.kind === 'missing') return <div className="df-offers">{back}<EmptyState title={words.missing} body={words.missingBody} /></div>
  if (loaded.kind === 'loading') return <div className="df-offers">{back}<LoadingState label={words.loading} /></div>
  if (loaded.kind === 'error') return <div className="df-offers">{back}<ErrorState title={messages.offers.error.title} body={messages.offers.error.body} retry={{ label: messages.offers.error.retry, onRetry: () => setAttempt((n) => n + 1) }} /></div>

  const { facts, lists, offer, season } = loaded
  const region = regionWords(facts.country)
  const isNew = offer === null
  const now = new Date()
  const readOnly = access.readOnly
  const disabled = readOnly || saving

  if (!draft)
    return (
      <div className="df-offers df-offer-editor">
        {back}
        <TypePicker
          ship={region.ship}
          season={season?.name ?? null}
          onPick={(type, recipe) => {
            const d = blankDraft(type, recipe, { facts, now, ship: region.ship, season })
            setDraft(d)
            setOrig(JSON.stringify(d))
          }}
        />
      </div>
    )

  const names: OfferNames = { collections: new Map(lists.collections.map((c) => [c.id, c.name])), filterValues: new Map(lists.filters.flatMap((f) => f.values.map((v) => [v.id, `${f.name}: ${v.name}`] as const))), groups: new Map(lists.groups.map((g) => [g.id, g.name])) }
  const shaped = offerOf(draft, facts)
  const errors = { ...errorsOf(draft, facts), ...(codeTaken ? { code: codeTaken } : {}) }
  const errorList = Object.values(errors)
  const set = (patch: Partial<OfferDraft>) => {
    if ('code' in patch) setCodeTaken(null)
    setDraft((d) => (d ? { ...d, ...patch } : d))
  }
  const startsLater = shaped.startsAt !== null && new Date(shaped.startsAt) > now
  const wasLive = offer !== null && offer.enabled && (offer.status === 'live')
  const pastEnd = !isNew && shaped.endsAt !== null && new Date(shaped.endsAt) <= now
  const liveCode = wasLive && offer.code ? offer.code : null

  const value = draft.kind === 'percent' ? `${draft.percent || 0}%` : typedMoney(draft.amounts[facts.main] ?? '', facts.main)
  const quiet = draft.trigger === 'automatic' && draft.minimum === 'none' && draft.who === 'all' && !draft.startsAt && !draft.endsAt && !draft.totalUses && !draft.repeat
  const loud = quiet ? fill(draft.type === 'shipping' ? (draft.shipMode === 'off' ? words.loud.shippingOff : words.loud.shipping) : words.loud[draft.type], { value, ship: region.ship, amount: typedMoney(draft.amounts[facts.main] ?? '', facts.main), buy: draft.buyQuantity, get: draft.getQuantity }) : null
  const said = sentence({ ...shaped, code: shaped.code ?? (draft.trigger === 'code' && !draft.singleUse ? words.noCodeYet : null) }, region, names, now, facts.timeZone)
  const warns = [
    draft.kind === 'percent' && Number(draft.percent) > 50 && draft.type !== 'bxgy' && draft.type !== 'shipping' ? fill(words.warns.big, { percent: draft.percent, tenth: String(Math.round(Number(draft.percent) / 10)) }) : '',
    draft.type === 'order' && draft.kind === 'fixed' && !draft.tiers.length && draft.minimum === 'none' ? fill(words.warns.noMinimum, { amount: value }) : '',
    draft.trigger === 'code' && !draft.singleUse && !draft.endsAt && !draft.totalUses && !draft.perCustomer ? words.warns.openCode : '',
  ].filter(Boolean)
  const will = isNew ? (startsLater && shaped.startsAt ? { key: 'scheduled' as const, text: fill(words.will.scheduled, { date: dateTimeText(shaped.startsAt, facts.timeZone) }) } : { key: 'live' as const, text: words.will.live }) : { key: statusKeyOf(offer, now), text: timeLine(offer, now, facts.timeZone) }

  /** Saves the form, on or off; a start cleared when "Start now" is picked. Refusals land where they were asked. */
  const commit = async (enabled: boolean, clearStart: boolean) => {
    if (sample) {
      setAsk(null)
      return setDone({ id: offer?.id ?? 'o1', title: words.done.live, body: words.done.liveBody })
    }
    setSaving(true)
    setDialogError(null)
    setBanner(null)
    const input = inputOf(clearStart ? { ...draft, startsAt: '' } : draft, facts, enabled)
    try {
      const saved = await saveOffer(offer?.id ?? null, offer ? revision : null, input)
      let codes = ''
      if (isNew && draft.trigger === 'code' && draft.singleUse) {
        codes = await generateCodes(saved.id, { count: Number(draft.batch.count), prefix: draft.batch.prefix.trim().toUpperCase(), length: Number(draft.batch.length) }).then(
          (b) => fill(plural(words.done.codesMade, b.count), { count: formatCount(b.count) }),
          (error: unknown) => fill(words.done.codesFailed, { reason: offerRefusal(error, access.canUpgrade) }),
        )
      }
      sessionStorage.removeItem(draftKey(storeId, offerId))
      leaving.current = true
      setAsk(null)
      setStale(null)
      setOrig(JSON.stringify(draft))
      if (!isNew) {
        leaving.current = false
        setToast(enabled && !startsLater ? words.savedLive : words.saved)
        setAttempt((n) => n + 1)
        return
      }
      const zone = zoneName(facts.timeZone)
      const starts = clearStart ? null : shaped.startsAt
      const outcome = !enabled
        ? { title: words.done.off, body: words.done.offBody }
        : starts && new Date(starts) > new Date()
          ? { title: words.done.scheduled, body: fill(words.done.scheduledBody, { date: dateTimeText(starts, facts.timeZone), zone }) }
          : shaped.code
            ? { title: fill(words.done.codeLive, { code: shaped.code }), body: words.done.codeLiveBody }
            : { title: words.done.live, body: words.done.liveBody }
      setDone({ id: saved.id, title: outcome.title, body: `${outcome.body}${codes ? ` ${codes}` : ''}` })
    } catch (error) {
      leaving.current = false
      if (isApiError(error, 'CODE_TAKEN')) {
        const holder = holderSchema.safeParse(error.details)
        const status = holder.success ? holder.data.status : ''
        const name = holder.success ? holder.data.name : ''
        const code = shaped.code ?? ''
        setCodeTaken(status === 'deleted' ? fill(words.codeTaken.deleted, { code, name }) : status === 'ended' || status === 'used_up' ? fill(words.codeTaken.ended, { code, name }) : status === 'live' || status === 'scheduled' || status === 'off' ? fill(words.codeTaken.other, { code, name, status: messages.offers.status[status] }) : fill(words.codeTaken.unknown, { code, name }))
        setTried(true)
        setAsk(null)
      } else if (isApiError(error, 'STALE_REVISION')) {
        setStale(typeof error.details['revision'] === 'number' ? error.details['revision'] : null)
        setAsk(null)
      } else if (ask) setDialogError(offerRefusal(error, access.canUpgrade))
      else setBanner(offerRefusal(error, access.canUpgrade))
    } finally {
      setSaving(false)
    }
  }

  const save = (asOff: boolean) => {
    setTried(true)
    if (Object.keys(errorsOf(draft, facts)).length > 0) return window.scrollTo?.({ top: 0 })
    setDialogError(null)
    if (isNew && asOff) return void commit(false, false)
    if (isNew) return setAsk('start')
    if (wasLive) return setAsk('live')
    void commit(offer.enabled, false)
  }

  const pickedIds = picking ? draft[picking] : []
  const bar = readOnly ? null : wasLive ? { tone: 'live', title: words.bar.live, body: words.bar.liveBody } : { tone: 'plain', title: dirty ? words.bar.dirty : isNew ? words.bar.new : words.bar.clean, body: isNew ? words.bar.newBody : '' }

  return (
    <div className="df-offers df-offer-editor">
      {back}
      <div className="df-offer-editor-head">
        <span className="df-eyebrow">{fill(messages.offers.kinds[draft.type], { ship: region.ship })}</span>
        <div className="df-offer-title-line">
          <h1 className="df-page-title">{offer ? offer.name : words.crumbNew}</h1>
          {offer && <StatusPill tone={statusLook[statusKeyOf(offer, now)].tone} icon={statusLook[statusKeyOf(offer, now)].icon} label={messages.offers.status[statusKeyOf(offer, now)]} />}
        </div>
      </div>

      {readOnly && <p className="df-offers-note df-offers-note--warning" role="status"><strong>{words.readOnly.title}</strong> {words.readOnly.body}</p>}
      {restored && (
        <p className="df-offers-note df-offers-note--info" role="status">
          <strong>{words.kept.title}</strong> {words.kept.body}{' '}
          <button type="button" className="df-button" onClick={() => {
              sessionStorage.removeItem(draftKey(storeId, offerId))
              setRestored(false)
              setDraft(JSON.parse(orig) as OfferDraft)
            }}>
            {words.kept.discard}
          </button>
        </p>
      )}
      {stale !== null && (
        <p className="df-offers-note df-offers-note--warning" role="alert">
          <strong>{words.stale.title}</strong> {words.stale.body}{' '}
          <button type="button" className="df-button" onClick={() => {
              sessionStorage.removeItem(draftKey(storeId, offerId))
              setStale(null)
              setAttempt((n) => n + 1)
            }}>
            {words.stale.load}
          </button>{' '}
          <button type="button" className="df-button" onClick={() => {
              setRevision(stale)
              setStale(null)
            }}>
            {words.stale.keep}
          </button>
        </p>
      )}
      {pastEnd && (
        <p className="df-offers-note df-offers-note--warning" role="status">
          <strong>{words.ended.title}</strong> {words.ended.body}{' '}
          {!disabled && (
            <button type="button" className="df-button" onClick={() => set({ endsAt: `${localOf(new Date(Date.now() + 7 * 86_400_000).toISOString(), facts.timeZone).slice(0, 10)}T23:59` })}>
              {words.ended.extend}
            </button>
          )}
        </p>
      )}
      {banner && <p className="df-offers-note df-offers-note--danger" role="alert">{banner}</p>}
      {tried && errorList.length > 0 && (
        <div className="df-offers-note df-offers-note--danger" role="alert">
          <strong>{fill(plural(words.errorsTitle, errorList.length), { count: formatCount(errorList.length) })}</strong>
          <ul>
            {errorList.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="df-offer-layout">
        <OfferForm
          draft={draft}
          set={set}
          errors={tried ? errors : codeTaken ? { code: codeTaken } : draft.code.length >= 3 && errors.code ? { code: errors.code } : {}}
          facts={facts}
          region={region}
          lists={lists}
          productNames={productNames}
          customerNames={customerNames}
          onCustomerName={(id, name) => setCustomerNames((m) => new Map(m).set(id, name))}
          onPick={setPicking}
          onCreateGroup={async (name) => {
            if (sample) return null
            try {
              const id = await createGroup(name)
              const groups = await loadCustomerGroups().catch(() => [...lists.groups, { id, name, description: null, members: 0 }])
              setLoaded({ ...loaded, lists: { ...lists, groups } })
              return id
            } catch (error) {
              setBanner(offerRefusal(error, access.canUpgrade))
              return null
            }
          }}
          liveCode={liveCode}
          isNew={isNew}
          disabled={disabled}
        />
        <aside className="df-offer-summary" aria-label={words.summary}>
          <div className="df-offer-card-head">
            <span className="df-eyebrow">{words.summary}</span>
            {phone && (
              <button type="button" className="df-link-button" aria-expanded={summaryOpen} onClick={() => setSummaryOpen((o) => !o)}>
                {summaryOpen ? words.hideDetails : words.showDetails}
              </button>
            )}
          </div>
          <p className="df-offer-summary-sentence">{said}</p>
          {(!phone || summaryOpen) && (
            <>
              {loud && <p className="df-offers-note df-offers-note--warning">{loud}</p>}
              <span className="df-offer-will">
                <StatusPill tone={statusLook[will.key].tone} icon={statusLook[will.key].icon} label={messages.offers.status[will.key]} /> {will.text}
              </span>
              {warns.map((w) => (
                <p key={w} className="df-offers-note df-offers-note--warning">
                  {w}
                </p>
              ))}
            </>
          )}
        </aside>
      </div>

      {bar && (
        <div className={`df-offer-bar df-offer-bar--${bar.tone}`}>
          <span>
            <strong>{bar.title}</strong> {bar.body}
          </span>
          <span className="df-offer-bar-actions">
            {offer ? (
              <Link className="df-button" to="/offers/$offerId" params={{ offerId: offer.id }} search={(prev) => harnessSearch(prev)}>
                {words.cancel}
              </Link>
            ) : (
              <Link className="df-button" to="/offers" search={(prev) => harnessSearch(prev)}>
                {words.cancel}
              </Link>
            )}
            {isNew && (
              <button type="button" className="df-button" disabled={saving} onClick={() => save(true)}>
                {words.saveOff}
              </button>
            )}
            <button type="button" className="df-button df-button--primary" disabled={saving} onClick={() => save(false)}>
              {saving ? words.saving : isNew ? (startsLater ? words.schedule : words.save) : words.saveChanges}
            </button>
          </span>
        </div>
      )}

      {picking && (
        <ProductPicker
          chosen={pickedIds}
          limit={offerLimits.ids}
          onToggle={(p, on) => {
            setProductNames((m) => new Map(m).set(p.id, p.name))
            const next = on ? [...pickedIds, p.id] : pickedIds.filter((x) => x !== p.id)
            set({ [picking]: next })
          }}
          onClose={() => setPicking(null)}
        />
      )}

      {ask === 'start' && (
        <ConfirmDialog
          open
          title={startsLater ? words.ask.titleSchedule : words.ask.title}
          target={draft.name}
          consequence={loud ? `${loud} ${said}` : said}
          choices={[
            {
              key: 'when',
              label: words.ask.label,
              initial: startsLater ? 'schedule' : 'now',
              options: [
                { value: 'now', label: words.ask.now },
                { value: 'schedule', label: startsLater && shaped.startsAt ? fill(words.ask.schedule, { date: dateTimeText(shaped.startsAt, facts.timeZone) }) : words.ask.scheduleNeedsDate },
                { value: 'off', label: words.ask.off },
              ],
              error: (picked) => (picked === 'schedule' && !startsLater ? words.ask.needsDate : null),
            },
          ]}
          confirmLabel={words.ask.confirm}
          cancelLabel={words.cancel}
          blocked={saving ? words.saving : null}
          error={dialogError}
          onConfirm={(_, __, picks) => void commit(picks['when'] !== 'off', picks['when'] === 'now')}
          onCancel={() => {
            setAsk(null)
            setDialogError(null)
          }}
        />
      )}
      {ask === 'live' && offer && (
        <ConfirmDialog
          open
          title={words.live.title}
          target={offer.name}
          consequence={`${words.live.body}${liveCode && shaped.code !== liveCode ? ` ${fill(words.live.oldCode, { code: liveCode })}` : ''}`}
          confirmLabel={words.live.confirm}
          cancelLabel={words.cancel}
          blocked={saving ? words.saving : null}
          error={dialogError}
          onConfirm={() => void commit(offer.enabled, false)}
          onCancel={() => {
            setAsk(null)
            setDialogError(null)
          }}
        />
      )}
      {done && (
        <ConfirmDialog
          open
          title={done.title}
          target={draft.name}
          consequence={done.body}
          confirmLabel={words.done.see}
          cancelLabel={words.done.stay}
          onConfirm={() => void navigate({ to: '/offers/$offerId', params: { offerId: done.id }, search: (prev) => harnessSearch(prev) })}
          onCancel={() => void navigate({ to: '/offers/$offerId/edit', params: { offerId: done.id }, search: (prev) => harnessSearch(prev), replace: true })}
        />
      )}
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  )
}


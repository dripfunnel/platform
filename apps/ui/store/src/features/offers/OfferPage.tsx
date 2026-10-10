import { EmptyState, ErrorState, LoadingState, StatusPill, Toast, useScreenState } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/detail.css'
import '@dripfunnel/shared/ui/states.css'
import { getRouteApi, Link, useNavigate, useParams } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadOffer, loadOfferNames, loadOfferPlace, type Offer } from '../../api/offers'
import { harnessEnabled, harnessSearch } from '../../harness'
import { fill, formatCount, formatList, messages } from '../../messages'
import { CodeBatches } from './CodeBatches'
import { copyText } from './copyText'
import { flash, takeFlash } from './flash'
import { actsFor, useOfferActions } from './offerActions'
import { offerAccessOf } from './offerAccess'
import { OfferResults } from './OfferResults'
import { offerSample, offerStates, sampleBatches, sampleNames, sampleResults } from './offerStates'
import { countryName, dateTimeText, kindOf, orList, noNames, regionWords, sentence, statusKeyOf, statusLook, timeLine, zoneName, type OfferNames, type RegionWords } from './offerView'
import './offers.css'

const words = messages.offers
const shellRoute = getRouteApi('/_app')

type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'missing' } | { kind: 'ready'; offer: Offer }

/** "Who it's for" in words, from the offer's conditions (I1–I6). */
const whoText = (offer: Offer, names: OfferNames): string => {
  const who = words.page.who
  const parts = offer.conditions.flatMap((c) => {
    if (c.operation === 'customer_group') return [fill(who.groups, { names: orList(c.groupIds.map((id) => names.groups.get(id) ?? words.what.aGroup)) })]
    if (c.operation === 'first_order') return [who.firstOrder]
    if (c.operation === 'specific_customers') return [fill(who.customers, { count: formatCount(c.customerIds.length) })]
    if (c.operation === 'shipping_country') return [fill(who.countries, { countries: formatList(c.countries.map(countryName)) })]
    return []
  })
  return parts.length ? parts.join(words.joiner) : who.everyone
}

const details = (offer: Offer, region: RegionWords, names: OfferNames, timeZone: string): [string, string][] => {
  const d = words.page.details
  const zone = zoneName(timeZone)
  const combines = (['product', 'order', 'shipping'] as const).filter((k) => offer.combines[k]).map((k) => (k === 'shipping' ? region.ship : words.sentence.kinds[k]))
  return [
    [d.type, fill(words.kinds[kindOf(offer.action)], { ship: region.ship })],
    [d.how, offer.trigger === 'automatic' ? d.automatic : fill(d.withCode, { code: region.code })],
    [d.name, offer.name],
    ...(offer.internalName ? [[d.note, offer.internalName] as [string, string]] : []),
    [d.who, whoText(offer, names)],
    [d.starts, offer.startsAt ? `${dateTimeText(offer.startsAt, timeZone)} (${zone})` : d.whenOn],
    [d.ends, offer.endsAt ? `${dateTimeText(offer.endsAt, timeZone)} (${zone})` : d.noEnd],
    [d.total, offer.totalUsesLimit ? formatCount(offer.totalUsesLimit) : d.unlimited],
    [d.perCustomer, offer.perCustomerLimit ? formatCount(offer.perCustomerLimit) : d.unlimited],
    [d.combines, combines.length ? fill(d.combinesWith, { kinds: formatList(combines) }) : d.combinesNothing],
  ]
}

/** One offer (Offers › offer view): its sentence, results, codes and details, with the merchant's actions. */
export const OfferPage = () => {
  const { acting, state } = shellRoute.useLoaderData()
  const { offerId = '' } = useParams({ strict: false })
  const navigate = useNavigate()
  const forced = useScreenState(offerStates, harnessEnabled)
  const sample = useMemo(() => offerSample(forced), [forced])
  const access = useMemo(() => offerAccessOf(forced, acting, state?.readOnly ?? false), [forced, acting, state])

  const [view, setView] = useState<View>({ kind: 'loading' })
  const [names, setNames] = useState<OfferNames>(noNames)
  const [place, setPlace] = useState<{ timeZone: string; country: string | null }>({ timeZone: 'UTC', country: null })
  const [toast, setToast] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const latest = useRef(0)

  useEffect(() => {
    const message = takeFlash()
    if (message) setToast(message)
  }, [offerId])

  const load = useCallback(() => {
    const mine = ++latest.current
    if (forced === 'loading') return setView({ kind: 'loading' })
    if (forced === 'error') return setView({ kind: 'error' })
    if (sample) {
      const found = [...sample.live, ...sample.scheduled, ...sample.off, ...sample.ended].find((o) => o.id === offerId)
      return setView(found ? { kind: 'ready', offer: found } : { kind: 'missing' })
    }
    if (!access.canRead) return
    // Another offer (a Duplicate's copy) never shows under this one's address, nor takes its actions, while it loads.
    setView((current) => (current.kind === 'ready' && current.offer.id === offerId ? current : { kind: 'loading' }))
    void loadOffer(offerId).then(
      (offer) => mine === latest.current && setView(offer ? { kind: 'ready', offer } : { kind: 'missing' }),
      () => mine === latest.current && setView({ kind: 'error' }),
    )
  }, [forced, sample, access.canRead, offerId])
  useEffect(load, [load])

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
      if (done.kind === 'deleted' || done.kind === 'duplicated') flash(message)
      else setToast(message)
      if (done.kind === 'deleted') return void navigate({ to: '/offers', search: (prev) => harnessSearch(prev) })
      if (done.kind === 'duplicated') return void navigate({ to: '/offers/$offerId', params: { offerId: done.id }, search: (prev) => harnessSearch(prev) })
      load()
    },
  })

  const crumb = (
    <nav className="df-breadcrumb" aria-label={words.page.crumbs}>
      <Link to="/offers" search={(prev) => harnessSearch(prev, forced ?? undefined)}>
        {words.title}
      </Link>
      <span aria-hidden="true">/</span>
      <span aria-current="page">{view.kind === 'ready' ? view.offer.name : words.page.offer}</span>
    </nav>
  )

  // A supplier, or anyone without offers.read, meets "not found" rather than learning an offer exists (§4).
  if (!access.canRead || view.kind === 'missing')
    return (
      <div className="df-offers">
        <EmptyState title={words.denied.title} body={view.kind === 'missing' && access.canRead ? words.page.missing : words.denied.body} />
      </div>
    )
  if (view.kind === 'loading')
    return (
      <div className="df-offers">
        {crumb}
        <LoadingState label={words.page.loading} />
      </div>
    )
  if (view.kind === 'error')
    return (
      <div className="df-offers">
        {crumb}
        <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: load }} />
      </div>
    )

  const offer = view.offer
  const now = new Date()
  const region = regionWords(place.country)
  const key = statusKeyOf(offer, now)
  const acts = access.canEdit ? actsFor(offer, now) : []
  // A code offer without a shared code hands out single-use codes instead (H4).
  const singleUse = offer.trigger === 'code' && !offer.code
  const copy = () => void copyText(offer.code ?? '').then((ok) => setToast(ok ? fill(words.copied, { code: offer.code ?? '' }) : words.copyFailed))

  return (
    <div className="df-offers">
      {crumb}
      <div className="df-offer-head">
        <div className="df-offer-title">
          <div className="df-offer-title-line">
            <h1 className="df-page-title">{offer.name}</h1>
            <StatusPill tone={statusLook[key].tone} icon={statusLook[key].icon} label={words.status[key]} />
          </div>
          <span className="df-offers-sub">{`${timeLine(offer, now, place.timeZone)}${words.joiner}${zoneName(place.timeZone)}`}</span>
          <p className="df-offer-sentence">{sentence(offer, region, names, now, place.timeZone)}</p>
        </div>
        {acts.length > 0 && (
          <div className="df-offer-acts">
            <Link className="df-button df-button--primary" to="/offers/$offerId/edit" params={{ offerId: offer.id }} search={(prev) => harnessSearch(prev)}>
              {words.menu.edit}
            </Link>
            {acts.map((act) => (
              <button key={act} type="button" className={act === 'delete' ? 'df-button df-offer-delete' : 'df-button'} disabled={actions.busy} onClick={() => {
                  setFailure(null)
                  actions.start(offer, act, setFailure)
                }}>
                {words.menu[act]}
              </button>
            ))}
          </div>
        )}
      </div>
      {access.readOnly && <p className="df-offers-note df-offers-note--warning" role="status"><strong>{words.notes.readOnlyTitle}</strong> {words.notes.readOnly}</p>}
      {failure && <p className="df-offers-note df-offers-note--danger" role="alert">{failure}</p>}

      <div className="df-offer-grid">
        <div className="df-offer-column">
          <OfferResults offerId={offer.id} usesLimit={offer.totalUsesLimit} sample={forced === 'locked' ? 'locked' : sample ? sampleResults : null} timeZone={place.timeZone} canUpgrade={access.canUpgrade} />
          {singleUse && <CodeBatches offerId={offer.id} sample={sample ? sampleBatches : null} canEdit={access.canEdit} canExport={access.canExport} canUpgrade={access.canUpgrade} />}
        </div>
        <div className="df-offer-column">
          {offer.code && (
            <section className="df-offer-card" aria-labelledby="df-offer-share">
              <h2 id="df-offer-share">{words.page.share}</h2>
              <code className="df-offer-big-code">{offer.code}</code>
              <span>
                <button type="button" className="df-button" onClick={copy}>
                  {words.menu.copy}
                </button>
              </span>
            </section>
          )}
          <section className="df-offer-card" aria-labelledby="df-offer-details">
            <h2 id="df-offer-details">{words.page.detailsTitle}</h2>
            <dl className="df-offer-facts">
              {details(offer, region, names, place.timeZone).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>

      {actions.dialog}
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  )
}

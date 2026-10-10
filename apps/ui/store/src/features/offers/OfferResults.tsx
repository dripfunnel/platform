import { isApiError } from '@dripfunnel/shared/graphql'
import { ErrorState, LoadingState } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { loadOfferResults, type OfferResults as Results } from '../../api/offers'
import type { ApiMoney } from '../../api/orders'
import { fill, formatCount, formatDay, formatList, messages, plural } from '../../messages'
import { moneyText } from '../orders/orderView'

// An offer's results (P1, U1): uses, discount given, sales with it and the average order, and uses by day. "Sales
// with this offer" are orders that used it; nothing estimates what it caused (fact 19).

const words = messages.offers.results
const unlockSchema = z.object({ name: z.string() })

type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'locked'; plan: string | null } | { kind: 'ready'; results: Results }

/** The days the chart covers, ending today in the store's time zone. */
export const resultsDays = 30

/** The last `resultsDays` days as the store's calendar has them ("2026-10-10"), each with its uses (none for a day the API left out). */
export const usesByDay = (byDay: Results['byDay'], timeZone: string, now: Date): { day: string; uses: number }[] => {
  const uses = new Map(byDay.map((d) => [d.day, d.uses]))
  const today = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const base = Date.parse(`${today}T00:00:00Z`)
  return Array.from({ length: resultsDays }, (_, i) => {
    const day = new Date(base - (resultsDays - 1 - i) * 86_400_000).toISOString().slice(0, 10)
    return { day, uses: uses.get(day) ?? 0 }
  })
}

const moneyList = (list: readonly ApiMoney[]) => (list.length ? formatList(list.map(moneyText)) : '—')

export const OfferResults = ({ offerId, usesLimit, sample, timeZone, canUpgrade }: { offerId: string; usesLimit: number | null; sample: Results | 'locked' | null; timeZone: string; canUpgrade: boolean }) => {
  const [view, setView] = useState<View>({ kind: 'loading' })
  const latest = useRef(0)

  const load = useCallback(() => {
    const mine = ++latest.current
    if (sample === 'locked') return setView({ kind: 'locked', plan: 'Growth Pro' })
    if (sample) return setView({ kind: 'ready', results: sample })
    setView({ kind: 'loading' })
    void loadOfferResults(offerId).then(
      (results) => mine === latest.current && setView({ kind: 'ready', results }),
      (error: unknown) => {
        if (mine !== latest.current) return
        if (!isApiError(error, 'PLAN_LIMIT')) return setView({ kind: 'error' })
        const plan = unlockSchema.safeParse(error.details['unlockedBy'])
        setView({ kind: 'locked', plan: plan.success ? plan.data.name : null })
      },
    )
  }, [offerId, sample])
  useEffect(load, [load])

  const days = view.kind === 'ready' ? usesByDay(view.results.byDay, timeZone, new Date()) : []
  const most = Math.max(1, ...days.map((d) => d.uses))
  return (
    <section className="df-offer-card" aria-labelledby="df-offer-results">
      <div className="df-offer-card-head">
        <h2 id="df-offer-results">{words.title}</h2>
        <span className="df-offers-sub">{fill(words.range, { days: String(resultsDays) })}</span>
      </div>
      {view.kind === 'loading' && <LoadingState label={words.loading} />}
      {view.kind === 'error' && <ErrorState title={words.error} body={messages.offers.error.body} retry={{ label: messages.offers.error.retry, onRetry: load }} />}
      {view.kind === 'locked' && (
        <div className="df-offer-locked">
          <strong>{fill(words.locked, { plan: view.plan ?? words.somePlan })}</strong>
          <span>{words.lockedBody}</span>
          {canUpgrade ? (
            <Link className="df-button" to="/billing">
              {words.seePlans}
            </Link>
          ) : (
            <span className="df-offers-sub">{words.askOwner}</span>
          )}
        </div>
      )}
      {view.kind === 'ready' && (
        <>
          <dl className="df-offer-tiles">
            <div>
              <dt>{words.uses}</dt>
              <dd>{usesLimit ? fill(words.usesOf, { used: formatCount(view.results.uses), total: formatCount(usesLimit) }) : formatCount(view.results.uses)}</dd>
            </div>
            <div>
              <dt>{words.given}</dt>
              <dd>{moneyList(view.results.discountGiven)}</dd>
            </div>
            <div>
              <dt>{words.sales}</dt>
              <dd>{moneyList(view.results.salesWithOffer)}</dd>
            </div>
            <div>
              <dt>{words.average}</dt>
              <dd>{moneyList(view.results.averageOrder)}</dd>
            </div>
          </dl>
          <ol className="df-offer-bars" aria-label={words.chart}>
            {days.map((d, i) => (
              <li key={d.day} title={fill(plural(words.bar, d.uses), { day: formatDay(d.day), count: formatCount(d.uses) })} data-today={i === days.length - 1 || undefined}>
                <span style={{ height: `${Math.max(2, Math.round((d.uses / most) * 72))}px` }} />
                <span className="df-visually-hidden">{fill(plural(words.bar, d.uses), { day: formatDay(d.day), count: formatCount(d.uses) })}</span>
              </li>
            ))}
          </ol>
          <div className="df-offer-bars-axis" aria-hidden="true">
            <span>{days[0] ? formatDay(days[0].day) : ''}</span>
            <span>{words.today}</span>
          </div>
          <p className="df-offers-sub">{words.note}</p>
        </>
      )}
    </section>
  )
}

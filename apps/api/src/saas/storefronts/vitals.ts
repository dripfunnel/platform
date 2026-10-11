import type postgres from 'postgres'
import { z } from 'zod'
import { logEvent } from '#core/log'
import { withSystemScope } from '#db/scoped/index'
import { buckets, pageKinds, recordVerdict, recordVitals, selectBuildsToRead, selectVitals, type Measure, type VitalsDays } from '#db/scoped/vitals'
import { rollBackLiveBuild } from './publish'

// Real-user Core Web Vitals (storefront ARCHITECTURE §9): what core's reporter sends after the shopper's consent, kept per
// day with no visitor id, and the regression rule that reads a new build's against the week before it.

/** One page view's measures as core's reporter sends them; anything else in the body refuses it. */
export const vitalsBeacon = z.strictObject({
  page: z.enum(pageKinds),
  device: z.enum(['phone', 'desktop']),
  lcp: z.number().finite().min(0).max(60_000),
  // Null when the shopper never interacted with the page: there is no INP to count.
  inp: z.number().finite().min(0).max(60_000).nullable(),
  cls: z.number().finite().min(0).max(10),
})
export type VitalsBeacon = z.infer<typeof vitalsBeacon>

export const recordBeacon = (sql: postgres.Sql, storeId: string, beacon: VitalsBeacon, now: Date): Promise<void> =>
  withSystemScope(sql, (tx) =>
    recordVitals(tx, { storeId, day: now.toISOString().slice(0, 10), pageKind: beacon.page, device: beacon.device, lcpMs: beacon.lcp, inpMs: beacon.inp, clsThousandths: Math.round(beacon.cls * 1000) }),
  )

const dayMs = 86_400_000
/** A page kind and device counts only with this many samples on each side; fewer say nothing (decided on #484). */
export const minSamples = 50
/** A p75 this much worse than the week before is a regression to flag; doubled (or CLS above 0.25) rolls back (§9). */
const flagRatio = 1.2
/** Google's "good" LCP and INP: a doubling that stays under them rolls nothing back (decided on #484). */
const good = { lcp: 2500, inp: 200 }
/** A change smaller than two buckets is the histogram's resolution, never a regression. */
const moved = (measure: Measure, before: number, after: number) => after - before >= 2 * buckets[measure].width

/** The upper bound of the bucket where the 75th percentile falls, in ms (CLS in thousandths). */
export const p75 = (hist: readonly number[], measure: Measure): number => {
  const total = hist.reduce((a, b) => a + b, 0)
  let seen = 0
  for (const [i, n] of hist.entries()) {
    seen += n
    if (seen >= total * 0.75) return (i + 1) * buckets[measure].width
  }
  return hist.length * buckets[measure].width
}

const sum = (rows: readonly VitalsDays[]) => {
  const by = new Map<string, { samples: number; lcp: number[]; inp: number[]; cls: number[] }>()
  for (const r of rows) {
    const key = `${r.page_kind}/${r.device}`
    const into = by.get(key) ?? { samples: 0, lcp: r.lcp_hist.map(() => 0), inp: r.inp_hist.map(() => 0), cls: r.cls_hist.map(() => 0) }
    into.samples += r.samples
    r.lcp_hist.forEach((n, i) => (into.lcp[i] = (into.lcp[i] ?? 0) + n))
    r.inp_hist.forEach((n, i) => (into.inp[i] = (into.inp[i] ?? 0) + n))
    r.cls_hist.forEach((n, i) => (into.cls[i] = (into.cls[i] ?? 0) + n))
    by.set(key, into)
  }
  return by
}

export interface Comparison {
  page: string
  before: { lcp: number; inp: number; cls: number }
  after: { lcp: number; inp: number; cls: number }
  verdict: 'ok' | 'regressed' | 'severe'
}

/** Severe: LCP or INP doubled, or CLS above 0.25 when it wasn't (§9); regressed: a p75 a fifth worse. */
export const compare = (before: VitalsDays[], after: VitalsDays[]): Comparison[] => {
  const was = sum(before)
  const now = sum(after)
  return [...now].flatMap(([page, a]) => {
    const b = was.get(page)
    if (!b || a.samples < minSamples || b.samples < minSamples) return []
    const m = (h: { lcp: number[]; inp: number[]; cls: number[] }) => ({ lcp: p75(h.lcp, 'lcp'), inp: p75(h.inp, 'inp'), cls: p75(h.cls, 'cls') })
    const [x, y] = [m(b), m(a)]
    const doubled = (m: 'lcp' | 'inp') => y[m] >= 2 * x[m] && y[m] > good[m] && moved(m, x[m], y[m])
    const severe = doubled('lcp') || doubled('inp') || (y.cls > 250 && x.cls <= 250)
    const worse = (m: Measure) => y[m] > flagRatio * x[m] && moved(m, x[m], y[m])
    const regressed = worse('lcp') || worse('inp') || worse('cls')
    return [{ page, before: x, after: y, verdict: severe ? 'severe' : regressed ? 'regressed' : 'ok' }]
  })
}

const isoDay = (at: Date) => at.toISOString().slice(0, 10)

/**
 * The regression rule, daily: a build that has been live for a whole day is read once against the week before its
 * switch (the switch day itself on neither side). Severe rolls back; a smaller regression is flagged on the run for the
 * admin console and the repair loop (#483). Returns how many builds were read.
 */
export const readVitalsRegressions = async (sql: postgres.Sql, now: Date, limit = 100): Promise<number> => {
  const startOfToday = new Date(`${isoDay(now)}T00:00:00Z`)
  // Switched before yesterday began, so yesterday was a whole day of it; not more than a week back.
  const builds = await withSystemScope(sql, (tx) => selectBuildsToRead(tx, new Date(startOfToday.getTime() - 8 * dayMs), new Date(startOfToday.getTime() - dayMs), limit))
  for (const build of builds) {
    const switchDay = new Date(`${isoDay(build.switched_at)}T00:00:00Z`)
    const [before, after] = await withSystemScope(sql, async (tx) => [
      await selectVitals(tx, build.store_id, isoDay(new Date(switchDay.getTime() - 7 * dayMs)), isoDay(new Date(switchDay.getTime() - dayMs))),
      await selectVitals(tx, build.store_id, isoDay(new Date(switchDay.getTime() + dayMs)), isoDay(new Date(startOfToday.getTime() - dayMs))),
    ])
    const pages = compare(before, after)
    const verdict = pages.some((p) => p.verdict === 'severe') ? 'severe' : pages.some((p) => p.verdict === 'regressed') ? 'regressed' : 'ok'
    const rolledBack = verdict === 'severe' && (await rollBackLiveBuild(sql, { storeId: build.store_id, runId: build.id, code: 'vitals_regressed', now }))
    await withSystemScope(sql, (tx) => recordVerdict(tx, build.id, { readAt: now.toISOString(), verdict, rolledBack, pages }))
    if (verdict !== 'ok') logEvent({ event: 'storefront_vitals_regressed', api: 'system', storeId: build.store_id, code: rolledBack ? 'rolled_back' : verdict })
  }
  return builds.length
}

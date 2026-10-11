import type { ScopedSql } from './index'

// storefront_vitals_day (DATA-MODEL §7.8): a day's real-user samples as histograms, in system scope only (the Shop API's
// intake names the store from its host; the regression rule reads them per build).

export const pageKinds = ['home', 'collection', 'product', 'custom', 'cart', 'checkout', 'other'] as const
export type PageKind = (typeof pageKinds)[number]
export type Device = 'phone' | 'desktop'

/** Each histogram's bucket width and count; the last bucket takes everything above. CLS is kept in thousandths. */
export const buckets = { lcp: { width: 250, count: 41 }, inp: { width: 25, count: 81 }, cls: { width: 10, count: 101 } } as const
export type Measure = keyof typeof buckets

/** Samples a store's page kind and device keep a day; past it a day's histogram is full (decided on #484). */
export const maxDailySamples = 5_000

export const bucketOf = (measure: Measure, value: number): number => Math.min(buckets[measure].count - 1, Math.max(0, Math.floor(value / buckets[measure].width)))

export interface VitalsSample {
  storeId: string
  day: string
  pageKind: PageKind
  device: Device
  lcpMs: number
  /** Null for a page view with no interaction, which adds nothing to INP. */
  inpMs: number | null
  clsThousandths: number
}

const zeros = (measure: Measure) => `{${Array.from({ length: buckets[measure].count }, () => 0).join(',')}}`

/** One sample added to its day's histograms, atomically, so concurrent beacons never lose one. */
export const recordVitals = async (tx: ScopedSql, s: VitalsSample): Promise<void> => {
  // Postgres arrays count from 1.
  const [lcp, cls] = [bucketOf('lcp', s.lcpMs) + 1, bucketOf('cls', s.clsThousandths) + 1]
  const inp = s.inpMs === null ? null : bucketOf('inp', s.inpMs) + 1
  await tx`
    insert into storefront_vitals_day (store_id, day, page_kind, device, samples, lcp_hist, inp_hist, cls_hist)
    values (${s.storeId}, ${s.day}, ${s.pageKind}, ${s.device}, 0, ${zeros('lcp')}::int[], ${zeros('inp')}::int[], ${zeros('cls')}::int[])
    on conflict (store_id, day, page_kind, device) do nothing`
  await tx`
    update storefront_vitals_day set samples = samples + 1,
      lcp_hist[${lcp}] = lcp_hist[${lcp}] + 1, cls_hist[${cls}] = cls_hist[${cls}] + 1${inp === null ? tx`` : tx`, inp_hist[${inp}] = inp_hist[${inp}] + 1`}
    where store_id = ${s.storeId} and day = ${s.day} and page_kind = ${s.pageKind} and device = ${s.device} and samples < ${maxDailySamples}`
}

export interface VitalsDays {
  page_kind: PageKind
  device: Device
  samples: number
  lcp_hist: number[]
  inp_hist: number[]
  cls_hist: number[]
}

/** Every day's histograms in [from, to] (inclusive days); at most a few hundred rows a store, summed by the caller. */
export const selectVitals = (tx: ScopedSql, storeId: string, from: string, to: string): Promise<VitalsDays[]> =>
  tx<VitalsDays[]>`
    select page_kind, device, samples, array_to_json(lcp_hist) as lcp_hist, array_to_json(inp_hist) as inp_hist, array_to_json(cls_hist) as cls_hist from storefront_vitals_day
    where store_id = ${storeId} and day between ${from} and ${to}`

/** Live builds that switched in [from, to) and the regression rule hasn't read yet (ARCHITECTURE §9). */
export const selectBuildsToRead = (tx: ScopedSql, from: Date, to: Date, limit: number): Promise<{ id: string; store_id: string; switched_at: Date }[]> =>
  tx<{ id: string; store_id: string; switched_at: Date }[]>`
    select r.id, r.store_id, r.switched_at from publish_run r join storefront f on f.live_build_id = r.id
    where r.state = 'live' and r.vitals is null and r.previous_build_id is not null and r.switched_at >= ${from} and r.switched_at < ${to}
    order by r.switched_at limit ${limit}`

export const recordVerdict = async (tx: ScopedSql, runId: string, vitals: Record<string, unknown>): Promise<void> => {
  await tx`update publish_run set vitals = ${tx.json(JSON.parse(JSON.stringify(vitals)) as Parameters<typeof tx.json>[0])} where id = ${runId}`
}

import type { ScopedSql } from '#db/scoped/index'
import { insertCharge, insertPayout, insertSalesMonth, setBillingFeed } from '#db/scoped/partnerDashboard'

// Northstar's merchant charges, payouts and monthly sales (designs/partner-data.js TREND, PAYOUTS
// and the stores' sales), the rows Stripe Connect fills in production (#163). Seeded at the
// prototype's moment (29 Sep 2026 17:42 UTC), the three ranges read its figures exactly.

const months = [
  { gross: 398840, fee: 146600 },
  { gross: 426140, fee: 154900 },
  { gross: 410820, fee: 149200, early: { gross: 9380, fee: 4500 } },
  { gross: 389460, fee: 142100 },
  { gross: 361000, fee: 131800 },
  { gross: 318000, fee: 118000, early: { gross: 11388, fee: 4200 } },
] as const

const adjustment = { month: 2, amount: -3800, note: 'Refund to Summit Supply for a double charge' }
const rates: Readonly<Record<string, number>> = { USD: 1, CAD: 1.36 }
const sales: Readonly<Record<string, readonly [number, number, string]>> = {
  'Juniper & Co.': [1842000, 1688000, 'USD'],
  'Cobalt Kitchen': [1211000, 0, 'USD'],
  'Maple & Pine Home': [988000, 812000, 'CAD'],
  'Harbor Coffee Co.': [530000, 0, 'USD'],
}

interface Charged {
  id: string
  name: string
  status: string
  currency: string
  amount: number
  last4: string | null
}

/** Shares of `total` in proportion to `weights`, summing to it exactly (largest remainder). */
const allocate = (total: number, weights: readonly number[]): number[] => {
  const sum = weights.reduce((a, b) => a + b, 0)
  const raw = weights.map((w) => (total * w) / sum)
  const out = raw.map(Math.floor)
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0])
  const left = total - out.reduce((a, b) => a + b, 0)
  for (let k = 0; k < left; k += 1) out[order[k]?.[1] ?? 0] = (out[order[k]?.[1] ?? 0] ?? 0) + 1
  return out
}

const monthAt = (now: Date, back: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))
const hours = (d: Date, h: number) => new Date(d.getTime() + h * 60 * 60 * 1000)

export const seedMoney = async (tx: ScopedSql, partnerKeys: ReadonlyMap<string, string>, now: Date): Promise<void> => {
  const partnerId = partnerKeys.get('ns')
  if (!partnerId) return
  const stores = await tx<Charged[]>`
    select s.id, s.name, s.status, x.currency, x.amount, x.payment_method_last4 as last4
    from store s join store_subscription x on x.store_id = s.id
    where s.partner_id = ${partnerId} and s.status in ('active', 'past_due') and x.amount > 0
    order by s.name, s.id
  `
  const paying = stores.filter((s) => s.status === 'active')
  const weights = paying.map((s) => Math.round(s.amount / (rates[s.currency] ?? 1)))
  const charge = async (s: Charged, gross: number, fee: number, at: Date) =>
    insertCharge(tx, {
      partnerId,
      storeId: s.id,
      kind: 'subscription',
      status: 'paid',
      amount: Math.round(gross * (rates[s.currency] ?? 1)),
      currency: s.currency,
      payoutCurrency: 'USD',
      payoutGross: gross,
      fee,
      cardLast4: s.last4,
      failureReason: null,
      chargedAt: at,
    })

  for (const [back, m] of months.entries()) {
    const start = monthAt(now, back)
    const end = back === 0 ? now : monthAt(now, back - 1)
    const early = 'early' in m ? m.early : null
    // The early share falls on the 1st at 06:00, before a range that starts later that day.
    if (early && paying[0]) await charge(paying[0], early.gross, early.fee, hours(start, 6))
    const from = early ? hours(start, 48) : start
    const gross = allocate(m.gross - (early?.gross ?? 0), weights)
    const fee = allocate(m.fee - (early?.fee ?? 0), weights)
    for (const [i, s] of paying.entries()) {
      const at = new Date(from.getTime() + ((i + 0.5) / paying.length) * (end.getTime() - from.getTime()))
      if ((gross[i] ?? 0) > 0) await charge(s, gross[i] ?? 0, fee[i] ?? 0, at)
    }
    if (back <= 4) {
      const paid = back > 0
      await insertPayout(tx, {
        partnerId,
        periodStart: start,
        periodEnd: monthAt(now, back - 1),
        currency: 'USD',
        gross: m.gross,
        fee: m.fee,
        adjustments: back === adjustment.month ? adjustment.amount : 0,
        adjustmentNote: back === adjustment.month ? adjustment.note : null,
        stores: paying.length,
        status: paid ? 'paid' : 'scheduled',
        scheduledFor: monthAt(now, back - 1),
        paidAt: paid ? hours(monthAt(now, back - 1), 6) : null,
      })
    }
  }

  // A past-due store's last attempt failed: nothing collected, so nothing in the sums.
  for (const s of stores.filter((r) => r.status === 'past_due')) {
    await insertCharge(tx, {
      partnerId,
      storeId: s.id,
      kind: 'subscription',
      status: 'failed',
      amount: s.amount,
      currency: s.currency,
      payoutCurrency: 'USD',
      payoutGross: 0,
      fee: 0,
      cardLast4: s.last4,
      failureReason: 'Card declined',
      chargedAt: hours(monthAt(now, 0), 6),
    })
  }

  const all = await tx<{ id: string; name: string; country: string | null }[]>`select id, name, country from store where partner_id = ${partnerId} and status <> 'cancelled' order by name, id`
  for (const [i, s] of all.entries()) {
    const named = sales[s.name]
    const [last, before, currency] = named ?? [i === 0 ? 641000 : ((i * 37) % 50) * 9000 + 45000, ((i * 29) % 50) * 9000 + 40000, s.country === 'CA' ? 'CAD' : 'USD']
    for (const [back, amount] of [[1, last], [2, before]] as const) {
      if (amount > 0) await insertSalesMonth(tx, { storeId: s.id, partnerId, month: monthAt(now, back), currency, amount, payoutCurrency: 'USD', payoutAmount: Math.round(amount / (rates[currency] ?? 1)), orders: Math.round(amount / 3000) })
    }
  }
  await setBillingFeed(tx, partnerId, now, null)
}

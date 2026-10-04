import type { Report } from '../../api/reports'

// What the Platform API answers for each tab; every figure and sentence here is the API's.
const usd = (amount: number) => ({ amount, currency: 'USD' })

export const reports: { [T in Report['tab']]: Extract<Report, { tab: T }> } = {
  growth: {
    tab: 'growth',
    data: {
      summary: 'Trials converted at 34% this month, up from 29%. You have 86 stores, 8 more than in August.',
      fresh: false,
      bars: [{ label: 'Aug', count: 12 }, { label: 'Sep', count: 15 }],
      rows: [{ month: '2026-09-01T00:00:00.000Z', signups: 15, newStores: 11, trialToPaidBps: 3400, churned: 2, netStores: 86 }, { month: '2026-08-01T00:00:00.000Z', signups: 12, newStores: 9, trialToPaidBps: null, churned: 1, netStores: 78 }],
    },
  },
  revenue: {
    tab: 'revenue',
    data: {
      summary: 'You’ve collected $3,988.40 so far in September, on track to beat August’s $4,261.40.',
      fresh: false,
      currency: 'USD',
      currencyNote: 'All amounts in USD; CAD payments are converted at the payout rate.',
      bars: [{ label: 'Sep', amount: usd(398840) }],
      rows: [{ month: '2026-09-01T00:00:00.000Z', collected: usd(398840), fee: usd(54000), payout: usd(344840) }],
      mrr: [{ plan: 'Growth', amount: usd(215600), approximate: true }],
      payments: { failed: 2, recovered: 1 },
    },
  },
  plans: {
    tab: 'plans',
    data: { summary: 'Growth is your most popular plan, with 44 of 86 stores.', fresh: false, bars: [{ label: 'Growth', count: 44 }], rows: [{ plan: 'Growth', stores: 44 }], changes: [{ from: 'Starter', to: 'Growth', stores: 3 }] },
  },
  stores: {
    tab: 'stores',
    data: {
      summary: 'Harbor Coffee sold the most last month ($18,420.00). 2 stores sold less than the month before.',
      fresh: false,
      note: 'Totals only. Individual orders, customers and products stay with each merchant.',
      rows: [{ storeId: 's1', store: 'Harbor Coffee', plan: 'Pro', sales: usd(1842000), orders: 312, changeBps: 1250, declining: false }],
      truncated: false,
      declining: [{ storeId: 's2', store: 'Lumen Candle Co.', plan: null, sales: usd(120000), orders: 18, changeBps: -820, declining: true }],
      decliningTruncated: false,
    },
  },
  usage: {
    tab: 'usage',
    data: { summary: '2 stores are at 80% or more of a limit.', meters: { aiPrompts: 1234, publishNow: 312 }, rows: [{ storeId: 's1', store: 'Harbor Coffee', limit: 'products', used: 100, cap: 100, percentBps: 10000 }, { storeId: 's2', store: 'Lumen Candle Co.', limit: 'ai_prompts', used: 250, cap: 300, percentBps: 8333 }], truncated: false },
  },
  setup: {
    tab: 'setup',
    data: { summary: 'A new store is ready in 1 min 42 s on average.', medianSeconds: 102, failed: 1, domainsStuck: 1, rows: [{ kind: 'stuck', storeId: 's3', store: 'Juniper & Co.', detail: 'firstBuild', since: '2026-10-03T10:00:00.000Z' }, { kind: 'domain', storeId: 's4', store: 'Cobalt Kitchen', detail: 'shop.cobalt.example', since: '2026-10-01T10:00:00.000Z' }], truncated: false },
  },
}

import type { BillingRead, CataloguePlan, Invoice, PlanValue, Subscription } from '../../api/billing'

// Billing's states under ?state= (ui/README.md §6): loading, error, active, trial, trialEnding, pastDue, scheduled,
// partner, noPlan, readOnly, denied.
export const billingStates = ['loading', 'error', 'active', 'trial', 'trialEnding', 'pastDue', 'scheduled', 'partner', 'noPlan', 'readOnly', 'denied'] as const
export type BillingState = (typeof billingStates)[number]

// A build-time constant Vite folds, so a production bundle carries none of these literals.
const harness = import.meta.env.DEV || import.meta.env.VITE_STATE_HARNESS === '1'

const inr = (amount: string) => ({ amount, currency: 'INR' })
const day = 24 * 60 * 60 * 1000
const inDays = (n: number) => new Date(Date.now() + n * day).toISOString()

const limit = (key: string, amount: number | null): PlanValue => ({ key, kind: 'amount', enabled: null, amount, unlimited: amount === null })
const on = (key: string, enabled: boolean): PlanValue => ({ key, kind: 'switch', enabled, amount: null, unlimited: false })
const pick = (key: string, amount: number): PlanValue => ({ key, kind: 'choice', enabled: null, amount, unlimited: false })

const plan = (id: string, name: string, monthly: string, yearly: string, values: PlanValue[], current = false): CataloguePlan => ({ id, name, description: null, current, monthly: inr(monthly), yearly: inr(yearly), values })

// The pricing page's four plans (designs/DF Store Pricing.dc.html), in rupees.
const plans: CataloguePlan[] = harness
  ? [
      plan('free', 'Free', '0', '0', [limit('products', 10), limit('staff', 0), on('suppliers_enabled', false), limit('ai_prompts', 0), pick('ai_mode', 0), limit('markets', 1), limit('bandwidth_gb', 2), limit('publish_now', 3), on('custom_domain', false), pick('support_level', 0)]),
      plan('growth', 'Growth', '83300', '499900', [limit('products', 100), limit('staff', 2), on('suppliers_enabled', false), limit('ai_prompts', 50), pick('ai_mode', 1), limit('markets', 2), limit('bandwidth_gb', 10), limit('publish_now', 10), on('custom_domain', true), pick('support_level', 1)], true),
      plan('pro', 'Growth Pro', '116600', '699900', [limit('products', 1000), limit('staff', 5), on('suppliers_enabled', true), limit('ai_prompts', 200), pick('ai_mode', 1), limit('markets', 5), limit('bandwidth_gb', 50), limit('publish_now', 30), on('custom_domain', true), pick('support_level', 2)]),
      plan('business', 'Business', '166600', '999900', [limit('products', null), limit('staff', 15), on('suppliers_enabled', true), limit('ai_prompts', 1000), pick('ai_mode', 1), limit('markets', null), limit('bandwidth_gb', 200), limit('publish_now', null), on('custom_domain', true), pick('support_level', 3)]),
    ]
  : []

const invoice = (id: string, number: string, issuedAt: string, amount: string, status: Invoice['status'] = 'paid'): Invoice => ({
  id,
  number,
  kind: 'subscription',
  status,
  amount: inr(amount),
  tax: inr(String(Math.round(Number(amount) * 0.18))),
  issuedAt,
  paidAt: status === 'paid' ? issuedAt : null,
  lines: [{ label: 'Growth plan', kind: 'plan' }],
})

const active: Subscription | null = harness
  ? {
      plan: { id: 'growth', name: 'Growth' },
      status: 'active',
      interval: 'MONTH',
      price: inr('83300'),
      periodStart: inDays(-12),
      periodEnd: inDays(18),
      trialEndsAt: null,
      cancelAt: null,
      scheduled: null,
      card: { brand: 'visa', last4: '4242', expires: '2028-04' },
      collectedBy: 'dripfunnel',
      partnerName: 'Kesari Commerce',
      asOf: inDays(0),
    }
  : null

const read = (subscription: Subscription | null, more: Partial<BillingRead> = {}): BillingRead => ({
  subscription,
  plans: plans.map((p) => ({ ...p, current: p.id === subscription?.plan.id })),
  usage: [
    { key: 'products', used: 84, limit: 100, unlimited: false, monthly: false },
    { key: 'staff', used: 1, limit: 2, unlimited: false, monthly: false },
    { key: 'suppliers', used: 0, limit: 0, unlimited: false, monthly: false },
    { key: 'ai_prompts', used: 12, limit: 50, unlimited: false, monthly: true },
    { key: 'publish_now', used: 10, limit: 10, unlimited: false, monthly: true },
  ],
  details: {
    legalName: 'Kesari Textiles Pvt Ltd',
    email: 'accounts@kesari.example',
    address: { line1: '14, 3rd Cross, Indiranagar', line2: null, city: 'Bengaluru', region: 'Karnataka', postal: '560038', country: 'IN' },
    taxId: '29ABCDE1234F1Z5',
    taxIdKind: 'gstin',
  },
  store: { legalName: 'Kesari Textiles Pvt Ltd', name: 'Kesari', contactEmail: 'hello@kesari.example', country: 'IN', taxId: null, address: null },
  invoices: { rows: [invoice('i3', 'KC-0003', inDays(-12), '83300'), invoice('i2', 'KC-0002', inDays(-42), '83300'), invoice('i1', 'KC-0001', inDays(-72), '83300')], next: null },
  ...more,
})

/** The sample for a state, or null for one drawn without data (loading, error, denied). */
export const billingSample = (state: BillingState | null): BillingRead | null => {
  if (!harness || !active || !state) return null
  const trial: Subscription = { ...active, plan: { id: 'business', name: 'Business' }, status: 'trial', price: inr('0'), trialEndsAt: inDays(7), card: null }
  switch (state) {
    case 'active':
    case 'readOnly':
      return read(active)
    case 'trial':
      return read(trial, { invoices: { rows: [], next: null }, details: null })
    case 'trialEnding':
      return read({ ...trial, trialEndsAt: inDays(1) }, { invoices: { rows: [], next: null } })
    case 'pastDue':
      return read({ ...active, status: 'past_due' }, { invoices: { rows: [invoice('i4', 'KC-0004', inDays(-2), '83300', 'open'), ...read(active).invoices.rows], next: null } })
    case 'scheduled':
      return read({ ...active, plan: { id: 'pro', name: 'Growth Pro' }, price: inr('116600'), scheduled: { plan: { id: 'growth', name: 'Growth' }, interval: 'MONTH', at: active.periodEnd } })
    case 'partner':
      return read({ ...active, collectedBy: 'partner' })
    case 'noPlan':
      return read(null, { plans: [], usage: [], invoices: { rows: [], next: null } })
    default:
      return null
  }
}

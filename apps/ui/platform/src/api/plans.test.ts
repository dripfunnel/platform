import { describe, expect, it } from 'vitest'
import { planInput, type PlanInput } from './plans'
import { createPlansServer, samplePlans } from './plansSample'

const server = () => createPlansServer(samplePlans)

const growth = (): PlanInput => {
  const plan = server().editor('growth', 'partner-owner')?.plan
  if (!plan) throw new Error('growth')
  return planInput.parse({
    name: plan.name,
    description: plan.description,
    trialDays: plan.trialDays,
    prices: plan.prices.map((price) => ({ currency: price.currency, monthly: price.monthly, yearly: price.yearly })),
    entitlements: plan.entitlements,
  })
}

describe('the plans fixture, as the Platform API would answer', () => {
  it('lists the catalogue with the fee and margin beside every price as Money', () => {
    const page = server().list('partner-owner')
    expect(page.items.map((plan) => plan.name)).toEqual(['Starter', 'Growth', 'Pro', 'Basic (2024)'])
    const growthRow = page.items[1]
    expect(growthRow?.prices[0]).toMatchObject({ currency: 'USD', monthly: { amount: 4900, currency: 'USD' }, fee: { amount: 1800, currency: 'USD' }, converted: false, margin: { kind: 'keep', amount: { amount: 3100, currency: 'USD' }, of: { amount: 4900, currency: 'USD' } } })
    expect(growthRow?.prices[1]).toMatchObject({ currency: 'CAD', converted: true })
    expect(page.actions.create).toEqual({ allowed: true })
    expect(server().list('partner-finance').actions.create).toEqual({ allowed: false, reason: 'OWNERS_AND_ADMINS_ONLY' })
  })

  it('quotes a loss when a price is below the fee, and nothing when unpriced, with the plan’s own fee', () => {
    expect(server().quote('pro', [{ currency: 'USD', monthly: { amount: 9900, currency: 'USD' }, yearly: null }])[0]?.margin).toEqual({ kind: 'keep', amount: { amount: 6400, currency: 'USD' }, of: { amount: 9900, currency: 'USD' } })
    const quotes = server().quote(null, [
      { currency: 'USD', monthly: { amount: 1500, currency: 'USD' }, yearly: null },
      { currency: 'CAD', monthly: null, yearly: null },
    ])
    expect(quotes[0]?.margin).toEqual({ kind: 'loss', amount: { amount: 300, currency: 'USD' } })
    expect(quotes[1]?.margin).toEqual({ kind: 'unpriced' })
  })

  it('refuses a value above DripFunnel’s ceiling, naming the row, and never clamps', () => {
    const s = server()
    const input = growth()
    const result = s.save('growth', { ...input, entitlements: { ...input.entitlements, products: 25000 } }, 'new', 'partner-owner')
    expect(result).toEqual({ ok: false, reason: 'ABOVE_CEILING', row: 'products' })
    expect(s.editor('growth', 'partner-owner')?.plan?.entitlements.products).toBe(5000)
  })

  it('lets Finance change prices and nothing else', () => {
    const s = server()
    const input = growth()
    const repriced = { ...input, prices: input.prices.map((price) => (price.currency === 'USD' ? { ...price, monthly: { amount: 5900, currency: 'USD' } } : price)) }
    expect(s.save('growth', repriced, 'new', 'partner-finance')).toEqual({ ok: true, id: 'growth' })
    expect(s.editor('growth', 'partner-finance')?.plan?.prices[0]?.monthly).toEqual({ amount: 5900, currency: 'USD' })
    expect(s.save('growth', { ...input, name: 'Growth Plus' }, 'new', 'partner-finance')).toEqual({ ok: false, reason: 'PRICES_ONLY' })
    expect(s.save('growth', input, 'new', 'partner-support')).toEqual({ ok: false, reason: 'OWNERS_AND_ADMINS_ONLY' })
    expect(s.editor('growth', 'partner-finance')?.permission).toEqual({ edit: { allowed: false, reason: 'OWNERS_AND_ADMINS_ONLY' }, price: { allowed: true } })
    expect(s.editor(null, 'partner-finance')?.permission.price).toEqual({ allowed: false, reason: 'OWNERS_AND_ADMINS_ONLY' })
  })

  it('asks who gets a change to a plan stores are on, and saves a new plan as a draft', () => {
    const s = server()
    expect(s.save('growth', growth(), null, 'partner-owner')).toEqual({ ok: false, reason: 'NEEDS_APPLY_TO' })
    expect(s.save('growth', growth(), 'renewal', 'partner-owner')).toEqual({ ok: true, id: 'growth' })
    const created = s.save(null, { ...growth(), name: 'Scale' }, null, 'partner-owner')
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(s.editor(created.id, 'partner-owner')?.plan).toMatchObject({ name: 'Scale', status: 'draft', stores: 0 })
    expect(planInput.safeParse({ ...growth(), name: '  ' }).success).toBe(false)
  })

  it('makes a draft live only once every currency is priced, and never retires the last Live plan', () => {
    const s = server()
    const created = s.save(null, { ...growth(), name: 'Scale', prices: [{ currency: 'USD', monthly: { amount: 14900, currency: 'USD' }, yearly: null }, { currency: 'CAD', monthly: null, yearly: null }] }, null, 'partner-owner')
    if (!created.ok) throw new Error(created.reason)
    expect(s.makeLive(created.id, 'partner-owner')).toEqual({ ok: false, reason: 'UNPRICED_CURRENCY', currency: 'CAD' })
    expect(s.makeLive('growth', 'partner-finance')).toEqual({ ok: false, reason: 'OWNERS_AND_ADMINS_ONLY' })
    expect(s.retire('starter', { keep: true }, 'partner-owner')).toEqual({ ok: true })
    expect(() => s.retire('growth', { keep: false, moveTo: 'basic24', on: '2026-11-01T00:00:00Z' }, 'partner-owner')).toThrow()
    expect(s.retire('growth', { keep: false, moveTo: 'pro', on: '2026-11-01T00:00:00Z' }, 'partner-owner')).toEqual({ ok: true })
    expect(s.list('partner-owner').items.find((plan) => plan.id === 'pro')?.stores).toBe(55)
    expect(s.list('partner-owner').items.find((plan) => plan.id === 'growth')?.stores).toBe(0)
    expect(s.retire('pro', { keep: true }, 'partner-owner')).toEqual({ ok: false, reason: 'LAST_LIVE_PLAN' })
    expect(s.editor('pro', 'partner-owner')?.retireTargets).toEqual([])
  })
})

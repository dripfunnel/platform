import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { growthEditors } from '../features/plans/plansTestData'
import { loadPlanEditor, loadPlans, makePlanLive, retirePlan, savePlan, type PlanInput } from './plans'

// The Platform API's rules for plans are its own tests' (apps/api tests/platform-plans.test.ts);
// these check the client reads every answer the way the screens expect it.
const answer = vi.fn<(body: { query: string; variables?: Record<string, unknown> }) => unknown>()
beforeEach(() => {
  answer.mockReset()
  vi.stubGlobal('fetch', (_: string, init: RequestInit) => Promise.resolve(new Response(JSON.stringify(answer(JSON.parse(String(init.body)) as { query: string })))))
})
afterEach(() => vi.unstubAllGlobals())

const usd = (amount: number) => ({ amount, currency: 'USD' })
const row = { id: 'p1', name: 'Growth', description: 'Daily sellers', status: 'live', trialDays: 14, stores: 3, prices: [{ currency: 'USD', monthly: usd(4900), yearly: null, fee: usd(1800), converted: false, margin: { kind: 'keep', amount: usd(3100), of: usd(4900) } }] }
const entitlements = { domain: true, offers: true, suppliersOn: false, powered: true, aplus: false, size: true, products: 5000, staff: 5, suppliers: 0, languages: 2, currencies: 2, publish: 60, ai: 100 }
const growth = growthEditors['partner-owner'].plan
const input: PlanInput = { name: 'Growth', description: '', trialDays: 14, prices: [{ currency: 'USD', monthly: usd(4900), yearly: null }], entitlements }

describe('loadPlans', () => {
  it('reads the catalogue and the create block as the screens use them', async () => {
    answer.mockReturnValue({ data: { plans: { items: [row], chargedBy: 'DripFunnel for Northstar', create: { allowed: false, reason: 'OWNERS_AND_ADMINS_ONLY' } } } })
    const page = await loadPlans()
    expect(page.actions.create).toEqual({ allowed: false, reason: 'OWNERS_AND_ADMINS_ONLY' })
    expect(page.items[0]?.prices[0]?.margin).toEqual({ kind: 'keep', amount: usd(3100), of: usd(4900) })
  })

  it('refuses a margin without its amounts and a refusal code it was never promised', async () => {
    answer.mockReturnValueOnce({ data: { plans: { items: [{ ...row, prices: [{ ...row.prices[0], margin: { kind: 'keep', amount: null, of: null } }] }], chargedBy: 'x', create: { allowed: true, reason: null } } } })
    await expect(loadPlans()).rejects.toMatchObject({ code: 'BAD_RESPONSE' })
    answer.mockReturnValueOnce({ data: { plans: { items: [], chargedBy: 'x', create: { allowed: false, reason: 'SOMETHING_NEW' } } } })
    await expect(loadPlans()).rejects.toMatchObject({ code: 'BAD_RESPONSE' })
  })
})

describe('loadPlanEditor', () => {
  it('joins the row and its entitlements, and the ceilings with the Powered-by rule; a missing ceiling stays null', async () => {
    answer.mockReturnValue({
      data: {
        planEditor: {
          plan: { row, entitlements },
          ceilings: { products: 10000, staff: 10, suppliers: null, languages: 3, currencies: 3, publish: 100, ai: 200 },
          powered: { allowed: false, note: 'contract' },
          currencies: ['USD'],
          trials: [0, 7, 14, 30],
          chargedBy: 'DripFunnel for Northstar',
          edit: { allowed: false, reason: 'PRICES_ONLY' },
          price: { allowed: true, reason: null },
          retireTargets: [{ id: 'p2', name: 'Pro' }],
          retireDates: ['2026-11-01T00:00:00.000Z'],
        },
      },
    })
    const editor = await loadPlanEditor('p1')
    expect(editor?.plan).toMatchObject({ id: 'p1', name: 'Growth', entitlements })
    expect(editor?.ceilings).toMatchObject({ products: 10000, suppliers: null, powered: { allowed: false, note: 'contract' } })
    expect(editor?.permission).toEqual({ edit: { allowed: false, reason: 'PRICES_ONLY' }, price: { allowed: true } })
  })

  it('reads a plan this partner doesn’t have as null', async () => {
    answer.mockReturnValue({ data: { planEditor: null } })
    expect(await loadPlanEditor('elsewhere')).toBeNull()
  })
})

describe('the plan mutations', () => {
  it('creates a new plan and updates an existing one, sending applyTo only to the update', async () => {
    answer.mockReturnValue({ data: { createPlan: { ok: true, id: 'p9', reason: null, row: null, currency: null }, updatePlan: { ok: true, id: 'p1', reason: null, row: null, currency: null } } })
    expect(await savePlan(null, input, null)).toEqual({ ok: true, id: 'p9' })
    expect(answer.mock.calls[0]?.[0].query).toContain('createPlan(input: $input)')
    expect(await savePlan('p1', input, 'renewal')).toEqual({ ok: true, id: 'p1' })
    expect(answer.mock.calls[1]?.[0]).toMatchObject({ variables: { id: 'p1', applyTo: 'renewal' } })
  })

  it('names the row above its ceiling and the currency without a price', async () => {
    answer.mockReturnValueOnce({ data: { updatePlan: { ok: false, id: null, reason: 'ABOVE_CEILING', row: 'products', currency: null } } })
    expect(await savePlan('p1', input, null)).toEqual({ ok: false, reason: 'ABOVE_CEILING', row: 'products' })
    answer.mockReturnValueOnce({ data: { makePlanLive: { ok: false, id: null, reason: 'UNPRICED_CURRENCY', row: null, currency: 'CAD' } } })
    expect(await makePlanLive('p1')).toEqual({ ok: false, reason: 'UNPRICED_CURRENCY', currency: 'CAD' })
    answer.mockReturnValueOnce({ data: { retirePlan: { ok: false, id: null, reason: 'LAST_LIVE_PLAN', row: null, currency: null } } })
    expect(await retirePlan('p1', { keep: true })).toEqual({ ok: false, reason: 'LAST_LIVE_PLAN' })
  })

  it('reads a price DripFunnel has no fee for yet, a plan with no price at all, and a plan that moved on', async () => {
    answer.mockReturnValueOnce({ data: { quotePlanPrices: [{ ...row.prices[0], fee: null, margin: { kind: 'noFee', amount: null, of: null } }] } })
    const { quotePlanPrices } = await import('./plans')
    expect((await quotePlanPrices('p1', input.prices))[0]).toMatchObject({ fee: null, margin: { kind: 'noFee' } })
    answer.mockReturnValueOnce({ data: { makePlanLive: { ok: false, id: null, reason: 'UNPRICED_CURRENCY', row: null, currency: null } } })
    expect(await makePlanLive('p1')).toEqual({ ok: false, reason: 'UNPRICED_CURRENCY', currency: null })
    answer.mockReturnValueOnce({ data: { updatePlan: { ok: false, id: null, reason: 'INVALID_STATE', row: null, currency: null } } })
    expect(await savePlan('p1', input, null)).toEqual({ ok: false, reason: 'INVALID_STATE' })
  })

  it('throws on a refusal the API never promised for that mutation', async () => {
    answer.mockReturnValue({ data: { retirePlan: { ok: false, id: null, reason: 'NEEDS_APPLY_TO', row: null, currency: null } } })
    await expect(retirePlan('p1', { keep: true })).rejects.toMatchObject({ code: 'NEEDS_APPLY_TO' })
  })
})

it('keeps the screen tests’ Growth plan in the API’s shape', () => {
  expect(growth?.entitlements.products).toBeGreaterThan(0)
})

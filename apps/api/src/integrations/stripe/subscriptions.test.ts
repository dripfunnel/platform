import { describe, expect, it } from 'vitest'
import { StripeRefused } from './api'
import { storeBillingStripe } from './subscriptions'

const sub = { id: 'sub_1', customer: 'cus_1', status: 'active', metadata: {}, items: { data: [{ id: 'si_1', current_period_start: 1, current_period_end: 2, price: { id: 'price_1', currency: 'usd', unit_amount: 3000 } }] } }

const recording = (answers: { status: number; json: unknown }[], seen: Request[]) =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Request(input, init))
    const a = answers[seen.length - 1] ?? answers[answers.length - 1]
    return Response.json(a?.json, { status: a?.status ?? 200 })
  }) as typeof fetch

const price = { product: 'dfplan_1', currency: 'USD', amount: 6000, interval: 'month' as const }

describe('a store’s plan on Stripe', () => {
  it('starts a subscription with its price, metadata and the caller’s idempotency key, refusing an incomplete payment', async () => {
    const seen: Request[] = []
    const api = storeBillingStripe({ secretKey: 'rk_test_a', fetchImpl: recording([{ status: 200, json: sub }], seen) })
    await api.createSubscription({ customer: 'cus_1', price, metadata: { store_id: 's1' } }, 'plan-start:k1')
    const body = new URLSearchParams(await seen[0]?.text())
    expect(seen[0]?.headers.get('idempotency-key')).toBe('plan-start:k1')
    expect(body.get('items[0][price_data][unit_amount]')).toBe('6000')
    expect(body.get('items[0][price_data][currency]')).toBe('usd')
    expect(body.get('payment_behavior')).toBe('error_if_incomplete')
    expect(body.get('metadata[store_id]')).toBe('s1')
  })

  it('moves now with the proration invoiced at once, on the subscription’s own item', async () => {
    const seen: Request[] = []
    const api = storeBillingStripe({ secretKey: 'rk_test_a', fetchImpl: recording([{ status: 200, json: sub }], seen) })
    await api.changeSubscription(sub as never, { price, metadata: {} }, 'plan-change:k2')
    const body = new URLSearchParams(await seen[0]?.text())
    expect(new URL(seen[0]?.url ?? '').pathname).toBe('/v1/subscriptions/sub_1')
    expect([body.get('items[0][id]'), body.get('proration_behavior')]).toEqual(['si_1', 'always_invoice'])
  })

  it('schedules a change for the period’s end: the current phase as it is, then the new price', async () => {
    const seen: Request[] = []
    const schedule = { id: 'sub_sched_1', phases: [{ start_date: 1, end_date: 2 }] }
    const api = storeBillingStripe({ secretKey: 'rk_test_a', fetchImpl: recording([{ status: 200, json: schedule }], seen) })
    expect(await api.scheduleChange(sub as never, { price, metadata: { plan_id: 'p2' } }, 'plan-schedule:k3')).toBe('sub_sched_1')
    expect(seen[0]?.headers.get('idempotency-key')).toBe('plan-schedule:k3:from')
    const body = new URLSearchParams(await seen[1]?.text())
    expect([body.get('phases[0][items][0][price]'), body.get('phases[0][end_date]'), body.get('phases[1][items][0][price_data][unit_amount]'), body.get('phases[1][metadata][plan_id]')]).toEqual(['price_1', '2', '6000', 'p2'])
  })

  it('makes the plan’s product once, an existing one answering its id', async () => {
    const seen: Request[] = []
    const api = storeBillingStripe({ secretKey: 'rk_test_a', fetchImpl: recording([{ status: 400, json: { error: { code: 'resource_already_exists' } } }], seen) })
    expect(await api.ensurePlanProduct({ id: '0b6e-11', name: 'Growth' })).toBe('dfplan_0b6e11')
    const other = storeBillingStripe({ secretKey: 'rk_test_a', fetchImpl: recording([{ status: 400, json: { error: { code: 'parameter_invalid' } } }], []) })
    await expect(other.ensurePlanProduct({ id: '1', name: 'Growth' })).rejects.toEqual(new StripeRefused('parameter_invalid'))
  })
})

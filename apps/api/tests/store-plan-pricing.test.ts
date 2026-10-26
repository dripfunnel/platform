import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PortalProxy } from '../src/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #459: a partner's live plans for its own pricing page, read signed out on its portal host (SAAS §6.1).

let db: TestDatabase
let t: Tenants
const host = 'store.partner-a.example'
const hostB = 'store.partner-b.example'
const ip = '203.0.113.9'
const fee = 987654
const ceiling = 876543
let allowed = true
const keys: string[] = []

const limiter = { limit: async ({ key }: { key: string }) => (keys.push(key), { success: allowed }) }
const env = (overrides: Record<string, unknown> = {}) => ({
  ADMIN_HOST: 'admin.dripfunnel.ai',
  PLATFORM_HOST: 'platform.dripfunnel.ai',
  HOOKS_HOST: 'hooks.dripfunnel.ai',
  HYPERDRIVE: { connectionString: db.url },
  HEALTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  SIGN_IN_RATE_LIMITER: { limit: async () => ({ success: true }) },
  SHOP_RATE_LIMITER: limiter,
  CF_VERSION_METADATA: { id: 'test', tag: '' },
  ...overrides,
})
const ctx = { waitUntil: (promise: Promise<unknown>) => promise, passThroughOnException: () => undefined } as unknown as ExecutionContext

const fields = '{ name description trialDays prices { currency monthly { amount currency } yearly { amount currency } } settings { key kind enabled amount unlimited } }'

interface Answer {
  status: number
  body: { data?: { pricing: Plan[] | null } | null; errors?: { extensions: { code: string } }[] } | null
}
interface Plan {
  name: string
  description: string | null
  trialDays: number
  prices: { currency: string; monthly: { amount: string; currency: string } | null; yearly: { amount: string; currency: string } | null }[]
  settings: { key: string; kind: string; enabled: boolean | null; amount: number | null; unlimited: boolean }[]
}

/** A server-side GET, as a partner's own site would make it: no Origin, no cookie. */
const ask = async (args = '', h = host, e = env(), headers: Record<string, string> = { 'cf-connecting-ip': ip }): Promise<Answer> => {
  const query = encodeURIComponent(`{ pricing${args} ${fields} }`)
  const response = await new PortalProxy(ctx, e as never).fetch(new Request(`https://${h}/api?query=${query}`, { headers }))
  return { status: response.status, body: response.headers.get('content-type')?.includes('json') ? ((await response.json()) as Answer['body']) : null }
}

const plan = async (partnerId: string, name: string, status: string, trialDays: number, prices: [string, number | null, number | null][]) => {
  const [row] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, description, status, trial_days) values (${partnerId}, ${name}, ${`${name} plan`}, ${status}, ${trialDays}) returning id`
  const id = row?.id ?? ''
  for (const [currency, monthly, yearly] of prices) {
    await db.sql`insert into plan_price (plan_id, partner_id, version, currency, monthly_amount, yearly_amount) values (${id}, ${partnerId}, 1, ${currency}, ${monthly}, ${yearly})`
  }
  return id
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerA}, 'portal', ${host}, 'live', 'CNAME', 'x'), (${t.partnerB}, 'portal', ${hostB}, 'live', 'CNAME', 'x')`
  const growth = await plan(t.partnerA, 'Growth', 'live', 14, [['USD', 2900, 29000], ['INR', 99900, null], ['EUR', null, null]])
  await db.sql`
    insert into plan_entitlement (plan_id, partner_id, version, key, enabled, amount) values
      (${growth}, ${t.partnerA}, 1, 'products', null, 500), (${growth}, ${t.partnerA}, 1, 'staff', null, 2147483647),
      (${growth}, ${t.partnerA}, 1, 'offers', true, null), (${growth}, ${t.partnerA}, 1, 'support_level', null, 2)
  `
  await plan(t.partnerA, 'Basic', 'live', 7, [['USD', 0, 0]])
  await plan(t.partnerA, 'Coming soon', 'draft', 14, [['USD', 500, 5000]])
  await plan(t.partnerA, 'Legacy', 'retired', 14, [['USD', 900, 9000]])
  await plan(t.partnerB, 'B only', 'live', 30, [['USD', 1500, 15000]])

  // An edit wrote version 2: Basic's buyers keep version 1, the pricing page shows version 2.
  const [basic] = await db.sql<{ id: string }[]>`select id from plan where name = 'Basic'`
  await db.sql`insert into plan_version (plan_id, partner_id, version, trial_days) values (${basic?.id ?? ''}, ${t.partnerA}, 2, 0)`
  await db.sql`insert into plan_price (plan_id, partner_id, version, currency, monthly_amount, yearly_amount) values (${basic?.id ?? ''}, ${t.partnerA}, 2, 'USD', 100, 1000)`
  await db.sql`update plan set version = 2 where id = ${basic?.id ?? ''}`

  // DripFunnel's side, which the answer never carries: the fee, a conversion rate and a ceiling.
  await db.sql`insert into partner_contract (partner_id, fee_currency) values (${t.partnerA}, 'USD')`
  await db.sql`insert into partner_contract_rate (partner_id, currency, per_fee_unit) values (${t.partnerA}, 'GBP', 0.8)`
  await db.sql`insert into plan_fee (plan_id, partner_id, amount, currency) values (${growth}, ${t.partnerA}, ${fee}, 'USD')`
  await db.sql`insert into plan_ceiling (key, amount) values ('products', ${ceiling}) on conflict (key) do update set amount = excluded.amount`
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('pricing on a partner’s portal host', () => {
  it('answers a signed-out caller the live plans in order, with prices in minor units, trial days and settings by key', async () => {
    const { status, body } = await ask()
    expect(status).toBe(200)
    expect(body?.data?.pricing).toEqual([
      { name: 'Basic', description: 'Basic plan', trialDays: 0, prices: [{ currency: 'USD', monthly: { amount: '100', currency: 'USD' }, yearly: { amount: '1000', currency: 'USD' } }], settings: [] },
      {
        name: 'Growth',
        description: 'Growth plan',
        trialDays: 14,
        prices: [
          { currency: 'INR', monthly: { amount: '99900', currency: 'INR' }, yearly: null },
          { currency: 'USD', monthly: { amount: '2900', currency: 'USD' }, yearly: { amount: '29000', currency: 'USD' } },
        ],
        settings: [
          { key: 'products', kind: 'amount', enabled: null, amount: 500, unlimited: false },
          { key: 'offers', kind: 'switch', enabled: true, amount: null, unlimited: false },
          { key: 'staff', kind: 'amount', enabled: null, amount: null, unlimited: true },
          { key: 'support_level', kind: 'choice', enabled: null, amount: 2, unlimited: false },
        ],
      },
    ])
  })

  it('keeps only the asked currency’s prices, never converted, and still lists a plan not priced in it', async () => {
    const inr = await ask('(currency: "INR")')
    expect(inr.body?.data?.pricing?.map((p) => [p.name, p.prices])).toEqual([
      ['Basic', []],
      ['Growth', [{ currency: 'INR', monthly: { amount: '99900', currency: 'INR' }, yearly: null }]],
    ])
    const gbp = await ask('(currency: "GBP")')
    expect(gbp.body?.data?.pricing?.map((p) => p.prices)).toEqual([[], []])
  })

  it('refuses a currency that isn’t an ISO code before reading anything', async () => {
    for (const currency of ['usd', 'ZZZ', 'US']) {
      keys.length = 0
      const { body } = await ask(`(currency: "${currency}")`)
      expect(body?.errors?.[0]?.extensions.code).toBe('INVALID_INPUT')
      expect(keys).toEqual([])
    }
  })

  it('never returns a draft or retired plan, DripFunnel’s fee or the ceilings', async () => {
    const { body } = await ask()
    const text = JSON.stringify(body)
    expect(body?.data?.pricing?.map((p) => p.name)).toEqual(['Basic', 'Growth'])
    for (const hidden of ['Coming soon', 'Legacy', 'B only', String(fee), String(ceiling), '0.8']) expect(text).not.toContain(hidden)
    const asked = await new PortalProxy(ctx, env() as never).fetch(new Request(`https://${host}/api?query=${encodeURIComponent('{ pricing { name fee } }')}`, { headers: { 'cf-connecting-ip': ip } }))
    expect(((await asked.json()) as { errors: { message: string }[] }).errors[0]?.message).toMatch(/Cannot query field "fee"/)
  })

  it('answers each host with its own partner’s plans only, and a host no partner holds with 404', async () => {
    const b = await ask('', hostB)
    expect(b.body?.data?.pricing?.map((p) => [p.name, p.trialDays])).toEqual([['B only', 30]])
    expect((await ask('', 'nobody.example')).status).toBe(404)
    expect((await ask('', 'store.partner-a.example.evil.example')).status).toBe(404)
  })

  it('answers the portal itself too: a POST from the host’s own origin', async () => {
    const response = await new PortalProxy(ctx, env() as never).fetch(
      new Request(`https://${host}/api`, { method: 'POST', headers: { origin: `https://${host}`, 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify({ query: '{ pricing { name } }' }) }),
    )
    expect(await response.json()).toEqual({ data: { pricing: [{ name: 'Basic' }, { name: 'Growth' }] } })
  })

  it('is rate-limited per host and address, and refused without an address or a limiter', async () => {
    keys.length = 0
    await ask()
    await ask('', hostB, env(), { 'cf-connecting-ip': '198.51.100.4' })
    expect(keys).toEqual([`pricing:${host}:${ip}`, `pricing:${hostB}:198.51.100.4`])
    allowed = false
    try {
      const { body } = await ask()
      expect(body?.data?.pricing ?? null).toBeNull()
      expect(body?.errors?.[0]?.extensions).toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 60 })
    } finally {
      allowed = true
    }
    expect((await ask('', host, env(), {})).body?.errors?.[0]?.extensions.code).toBe('RATE_LIMITED')
    expect((await ask('', host, env({ SHOP_RATE_LIMITER: undefined }))).body?.errors?.[0]?.extensions.code).toBe('RATE_LIMITED')
  })
})

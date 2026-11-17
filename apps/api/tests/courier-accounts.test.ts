import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { secretBox, type SecretBox } from '#auth/secretBox'
import type { Parcel } from '#core/couriers'
import { courierHookOf, handleCourierHook } from '#hooks/couriers'
import { storeCourierAccounts } from '#integrations/couriers/accounts'
import { courierDirectory } from '#integrations/couriers/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// #1489: a store's own Shiprocket login, read where a call goes out: quotes use that store's email and password, a store
// without one has no account, and a tracking hook is proved with that store's own token (THIRD-PARTY-ACCESS §4).

let db: TestDatabase
let t: Tenants
let secrets: SecretBox

const logins = {
  a1: { email: 'api-a1@example.com', password: 'pw-a1', webhookToken: 'token-a1' },
  b1: { email: 'api-b1@example.com', password: 'pw-b1', webhookToken: 'token-b1' },
}

// Shiprocket as far as a quote goes: the login hands back a token naming who logged in, and the rate asks for it.
const calls: { url: string; email?: string | undefined; bearer?: string | undefined }[] = []
const shiprocket: typeof fetch = async (input, init) => {
  const url = String(input)
  if (url.endsWith('/auth/login')) {
    const body = JSON.parse(String(init?.body)) as { email: string; password: string }
    calls.push({ url, email: body.email })
    const known = Object.values(logins).find((l) => l.email === body.email && l.password === body.password)
    return known ? Response.json({ token: `tok:${body.email}` }) : new Response(null, { status: 400 })
  }
  calls.push({ url, bearer: new Headers(init?.headers).get('authorization') ?? undefined })
  return Response.json({ data: { available_courier_companies: [{ courier_name: 'Delhivery', rate: 85, estimated_delivery_days: 3 }] } })
}

const parcel: Parcel = { from: { country: 'IN', postal: '302001' }, to: { country: 'IN', region: null, postal: '400001' }, weightGrams: 500, value: { amount: 0n, currency: 'INR' } }
const seal = (login: { password: string; webhookToken: string }) => secrets.seal(JSON.stringify({ password: login.password, webhookToken: login.webhookToken }))
const directory = () => courierDirectory(storeCourierAccounts(db.sql, secrets), shiprocket)

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  secrets = await secretBox(btoa('k'.repeat(32)))
  await db.sql`insert into courier_account (store_id, provider, email, credentials_sealed, connected_by) values
    (${t.storeA1}, 'shiprocket', ${logins.a1.email}, ${await seal(logins.a1)}, ${crypto.randomUUID()}),
    (${t.storeB1}, 'shiprocket', ${logins.b1.email}, ${await seal(logins.b1)}, ${crypto.randomUUID()})`
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('a store’s own courier login', () => {
  it('quotes through the store’s own email and password, and a store with none has no account and calls nobody', async () => {
    calls.length = 0
    const own = await directory().forStore(t.storeA1)
    expect([...own.accounts]).toEqual(['shiprocket'])
    expect((await own.gateway.quote('shiprocket', parcel))?.amount).toEqual({ amount: 8500n, currency: 'INR' })
    expect(calls.map((c) => c.email ?? c.bearer)).toEqual([logins.a1.email, `Bearer tok:${logins.a1.email}`])

    calls.length = 0
    const theirs = await directory().forStore(t.storeB1)
    await theirs.gateway.quote('shiprocket', parcel)
    expect(calls.map((c) => c.email ?? c.bearer)).toEqual([logins.b1.email, `Bearer tok:${logins.b1.email}`])

    // Another store of the same partner never borrows a sibling's login.
    calls.length = 0
    const none = await directory().forStore(t.storeA2)
    expect([...none.accounts]).toEqual([])
    expect(await none.gateway.quote('shiprocket', parcel)).toBeNull()
    expect(calls).toEqual([])
  })

  it('has no account when the sealed login will not open or the Worker holds no key', async () => {
    const other = await secretBox(btoa('x'.repeat(32)))
    expect([...(await courierDirectory(storeCourierAccounts(db.sql, other), shiprocket).forStore(t.storeA1)).accounts]).toEqual([])
    expect([...(await courierDirectory(storeCourierAccounts(db.sql, null), shiprocket).forStore(t.storeA1)).accounts]).toEqual([])
  })

  it('checks a login with Shiprocket, and is refused for any other courier', async () => {
    const d = directory()
    expect(await d.check('shiprocket', { email: logins.a1.email, password: logins.a1.password })).toBe('ok')
    expect(await d.check('shiprocket', { email: logins.a1.email, password: 'nope' })).toBe('rejected')
    expect(await d.check('usps', { email: logins.a1.email, password: logins.a1.password })).toBe('rejected')
  })
})

describe('a tracking hook per store', () => {
  const post = async (storeId: string, token: string) => {
    const path = `/couriers/shiprocket/${storeId}`
    const hook = courierHookOf(path)
    if (!hook) return 404
    const body = JSON.stringify({ awb: 'NONE', current_status: 'IN TRANSIT', current_timestamp: '2026-10-12 11:00:00' })
    const request = new Request(`https://hooks.example${path}`, { method: 'POST', body, headers: { 'x-api-key': token } })
    return (await handleCourierHook(request, hook, { sql: db.sql, activity: activityLog, couriers: directory() }, async () => true)).status
  }

  it('takes the store’s own token only: not another store’s, not a store without a login, not an unknown store', async () => {
    expect(await post(t.storeA1, logins.a1.webhookToken)).toBe(200)
    expect(await post(t.storeA1, logins.b1.webhookToken)).toBe(400)
    expect(await post(t.storeB1, logins.a1.webhookToken)).toBe(400)
    expect(await post(t.storeA2, logins.a1.webhookToken)).toBe(400)
    expect(await post(crypto.randomUUID(), logins.a1.webhookToken)).toBe(400)
  })
})

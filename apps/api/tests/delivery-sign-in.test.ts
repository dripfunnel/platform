import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { handleRiderAsset } from '#apis/delivery/assets'
import { deliverySchema, type DeliveryContext } from '#apis/delivery/schema'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import { resolveRider } from '#auth/riderCaller'
import { hashSessionId } from '#auth/session'
import { resolveShopper } from '#auth/shopCaller'
import type { TenantContext } from '#core/tenancy'
import { withScope, withSystemScope } from '#db/scoped/index'
import { purgeRiderSignIns } from '#db/scoped/riderSignIn'
import { photoUploadsPerDay, type RiderFiles } from '#engine/modules/ownDelivery/index'
import { activityLog } from '#saas/activity/index'
import { StorefrontEdge } from '../src/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'
import { seedStoreWorld, type StoreWorld } from './support/storeWorld'

// Card #839 (DL 2): the Delivery API at /delivery-api/ on {slug}.<SHOP_DOMAIN>, and riders signing in by a texted code
// (DELIVERY §4, §5; ACCESS §2.1's limits).

let db: TestDatabase
let t: Tenants
let w: StoreWorld
const now = () => new Date()
const shopDomain = 'shop.example'
const hostA1 = 'store-a1.shop.example'
const hostA2 = 'store-a2.shop.example'
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 2, 0x80, 0, 0, 1, 0xe0, 8, 6, 0, 0, 0])
const ravi = '+919811100001'
const meena = '+919811100002'
const sunil = '+919811100003'
const asha = '+919811100009'
const stranger = '+919899999999'

let limiterOpen = true
/** The assets bucket: what was put, and every key deleted. */
const bucket = new Map<string, Uint8Array>()
const deletedKeys: string[] = []
const files: RiderFiles = {
  put: async (key, value) => void bucket.set(key, value),
  get: async () => null,
  delete: async (keys) => {
    deletedKeys.push(...keys)
    for (const key of keys) bucket.delete(key)
  },
}
const limiterKeys: string[] = []

const allow = async (storeId: string, on: boolean) => {
  const [store] = await db.sql<{ plan_id: string; partner_id: string }[]>`select plan_id, partner_id from store where id = ${storeId}`
  await db.sql`delete from plan_entitlement where plan_id = ${store?.plan_id ?? ''} and key in ('own_delivery', 'riders')`
  if (!on) return
  await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, enabled, amount)
    values (${store?.plan_id ?? ''}, ${store?.partner_id ?? ''}, 1, 'own_delivery', true, null), (${store?.plan_id ?? ''}, ${store?.partner_id ?? ''}, 1, 'riders', null, 20)`
}

const invite = async (who: 'owner' | 'a2Owner', name: string, phone: string) => {
  const r = await w.gql(who, 'mutation I($name: String!, $phone: String!) { inviteRider(name: $name, phone: $phone) { id } }', { name, phone })
  const id = (r.data?.['inviteRider'] as { id: string } | undefined)?.id
  if (!id) throw new Error(`invite refused: ${r.code ?? ''}`)
  return id
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  w = await seedStoreWorld(db.sql, t, { now, secrets: null, lookup: null, extra: { domains: { edgeZone: 'dripfunnel.example', localHosts: false, shopDomain } } })
  await db.sql`update store set pricing_currency = 'INR', status = 'active' where id in (${t.storeA1}, ${t.storeA2}, ${t.storeB1})`
  await db.sql`update partner set state = 'live' where id in (${t.partnerA}, ${t.partnerB})`
  await allow(t.storeA1, true)
  await allow(t.storeA2, true)
  await invite('owner', 'Ravi K.', ravi)
  await invite('owner', 'Meena P.', meena)
  await invite('owner', 'Sunil D.', sunil)
  await invite('a2Owner', 'Asha R.', asha)
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

type Answer = { data: Record<string, unknown> | null | undefined; code: string | undefined }

const delivery = async (source: string, o: { host?: string; token?: string | null; variables?: Record<string, unknown>; codeCheck?: '0'; headers?: Record<string, string> } = {}): Promise<Answer> => {
  const host = o.host ?? hostA1
  const headers = { ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...o.headers }
  const caller = await resolveRider(db.sql, new Request(`https://${host}/delivery-api/`, { headers }), host, shopDomain, now())
  if (!caller) throw new Error('no store on that host')
  const deferred: Promise<unknown>[] = []
  const contextValue: DeliveryContext = {
    sql: db.sql,
    caller,
    activity: activityLog,
    facts: { requestId: 'r', ip: '203.0.113.7', userAgent: null },
    allowAttempt: async (key) => (limiterKeys.push(key), limiterOpen),
    codeCheck: o.codeCheck,
    defer: (work) => deferred.push(work),
    files,
    now,
  }
  const result = await graphql({ schema: deliverySchema as GraphQLSchema, source, contextValue, variableValues: o.variables })
  await Promise.all(deferred)
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}

const requestCode = (phone: string, host = hostA1) => delivery('mutation R($phone: String!) { requestCode(phone: $phone) }', { host, variables: { phone } })
const signIn = async (phone: string, code: string, host = hostA1) => {
  const r = await delivery('mutation S($phone: String!, $code: String!) { signIn(phone: $phone, code: $code) { sessionToken } }', { host, variables: { phone, code } })
  return { token: (r.data?.['signIn'] as { sessionToken: string } | null | undefined)?.sessionToken ?? null, code: r.code }
}
const me = async (token: string | null, host = hostA1) => (await delivery('{ me { id name phone status: vehicleType } }', { host, token })).data?.['me'] as { id: string; name: string; phone: string | null } | null
const textedCode = async (to: string) =>
  (await db.sql<{ payload: { message: string; vars: { code: string } } }[]>`select payload from outbox where kind = 'sms' and payload->>'to' = ${to} and payload->>'message' = 'code.shopper_sign_in' order by created_at desc limit 1`)[0]?.payload.vars.code ?? null
const codesFor = async (phone: string) => (await db.sql`select 1 from rider_code where phone = ${phone}`).length
const riderRow = async (phone: string | null, id?: string) =>
  (await db.sql<{ id: string; status: string; phone: string | null; photo_asset_id: string | null }[]>`select id, status, phone, photo_asset_id from rider where ${id ? db.sql`id = ${id}` : db.sql`phone = ${phone}`}`)[0]
/** The photo upload, as the rider's app sends it. */
const upload = async (token: string | null) => {
  const caller = await resolveRider(db.sql, new Request(`https://${hostA1}/delivery-api/assets`, { headers: token ? { authorization: `Bearer ${token}` } : {} }), hostA1, shopDomain, now())
  const ctx: DeliveryContext = { sql: db.sql, caller, activity: activityLog, facts: { requestId: 'r', ip: '203.0.113.7', userAgent: null }, defer: () => undefined, files, now }
  return handleRiderAsset(new Request(`https://${hostA1}/delivery-api/assets`, { method: 'POST', body: png }), ctx)
}
const uploadedId = async (token: string) => ((await (await upload(token)).json()) as { asset: { id: string } }).asset.id
/** A fresh code for the number, and a session with it. */
const signedIn = async (phone: string, host = hostA1) => {
  await db.sql`delete from rider_code where phone = ${phone}`
  await requestCode(phone, host)
  const code = await textedCode(phone)
  const { token } = await signIn(phone, code ?? '', host)
  if (!token) throw new Error('no session')
  return token
}

describe('the Delivery API’s host (ARCHITECTURE §2, DELIVERY §4)', () => {
  const env = () => ({
    ADMIN_HOST: 'admin.dripfunnel.ai',
    PLATFORM_HOST: 'platform.dripfunnel.ai',
    HOOKS_HOST: 'hooks.dripfunnel.ai',
    SHOP_DOMAIN: shopDomain,
    HYPERDRIVE: { connectionString: db.url },
    HEALTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
    SHOP_RATE_LIMITER: { limit: async () => ({ success: true }) },
    CART_RATE_LIMITER: { limit: async () => ({ success: true }) },
    CF_VERSION_METADATA: { id: 'test', tag: '' },
  })
  const ctx = { waitUntil: (promise: Promise<unknown>) => promise, passThroughOnException: () => undefined } as unknown as ExecutionContext
  const post = (host: string, path = '/delivery-api/') =>
    new StorefrontEdge(ctx, env() as never).fetch(new Request(`https://${host}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' }, body: JSON.stringify({ query: '{ health }' }) }))

  it('answers on a store’s free address through StorefrontEdge', async () => {
    const answer = await post(hostA1)
    expect(answer.status).toBe(200)
    expect(await answer.json()).toEqual({ data: { health: 'ok' } })
  })

  it('answers 404 on a preview host, a merchant’s own domain, an unknown store, our hosts and other paths', async () => {
    await db.sql`insert into custom_domain (store_id, host, status, expected_cname, ownership_token) values (${t.storeA2}, 'www.a2-delivers.example', 'live', 'x', 'y')`
    for (const host of ['store-a1-preview.shop.example', 'www.a2-delivers.example', 'nobody.shop.example', 'admin.dripfunnel.ai', 'hooks.dripfunnel.ai']) expect((await post(host)).status).toBe(404)
    expect((await post(hostA1, '/delivery-apix')).status).toBe(404)
  })

  it('is never answered on the Worker’s own routes', async () => {
    const { default: worker } = await import('../src/index')
    const request = new Request(`https://${hostA1}/delivery-api/`, { method: 'POST', headers: { 'cf-connecting-ip': '203.0.113.9' }, body: '{}' })
    const answer = await worker.fetch(request as Parameters<typeof worker.fetch>[0], env() as never, ctx)
    expect(answer.status).toBe(404)
  })
})

describe('asking for a code (DELIVERY §4)', () => {
  it('texts an invited rider a code, through the outbox, with the shoppers’ sign-in wording', async () => {
    expect((await requestCode(ravi)).data).toEqual({ requestCode: true })
    const [text] = await db.sql<{ payload: { message: string; brand: string; vars: { code: string } }; store_id: string }[]>`select payload, store_id from outbox where kind = 'sms' and payload->>'to' = ${ravi} and payload->>'message' = 'code.shopper_sign_in'`
    expect(text).toMatchObject({ store_id: t.storeA1, payload: { message: 'code.shopper_sign_in', brand: 'Store A1', vars: { code: expect.stringMatching(/^\d{6}$/) } } })
    // Hashed, never kept in the clear.
    expect(JSON.stringify(await db.sql`select * from rider_code where phone = ${ravi}`)).not.toContain(text?.payload.vars.code ?? 'none')
  })

  it('answers an uninvited number the same, and texts nothing, keeps no code and logs no number', async () => {
    expect((await requestCode(stranger)).data).toEqual({ requestCode: true })
    expect(await textedCode(stranger)).toBeNull()
    expect(await codesFor(stranger)).toBe(0)
    expect(JSON.stringify(await db.sql`select * from activity_log where action = 'rider.code_requested'`)).not.toContain(stranger)
  })

  it('answers another store’s rider the same, and texts nothing on this host', async () => {
    expect((await requestCode(asha)).data).toEqual({ requestCode: true })
    expect(await codesFor(asha)).toBe(0)
  })

  it('refuses a number that can’t be one, and an address over its limit, whatever the number', async () => {
    expect((await requestCode('98765')).code).toBe('INVALID_INPUT')
    limiterOpen = false
    expect((await requestCode(ravi)).code).toBe('RATE_LIMITED')
    expect((await requestCode(stranger)).code).toBe('RATE_LIMITED')
    limiterOpen = true
    expect(limiterKeys).toContain(`delivery:${t.storeA1}:code-ip:203.0.113.7`)
  })

  it('makes at most 3 codes a number in 10 minutes, answering the 4th the same', async () => {
    await db.sql`delete from rider_code where phone = ${meena}`
    for (let i = 0; i < 4; i++) expect((await requestCode(meena)).data).toEqual({ requestCode: true })
    expect(await codesFor(meena)).toBe(3)
  })

  it('makes at most 50 codes a store in 10 minutes', async () => {
    await db.sql`delete from rider_code where store_id = ${t.storeA1}`
    await db.sql`insert into rider_code (store_id, phone, expires_at) select ${t.storeA1}, '+9198000' || lpad(g::text, 5, '0'), now() + interval '10 minutes' from generate_series(1, 50) g`
    await requestCode(sunil)
    expect(await codesFor(sunil)).toBe(0)
    await db.sql`delete from rider_code where store_id = ${t.storeA1}`
  })

  it('texts nobody while the plan has no own delivery, answering the same', async () => {
    await allow(t.storeA1, false)
    expect((await requestCode(sunil)).data).toEqual({ requestCode: true })
    expect(await codesFor(sunil)).toBe(0)
    await allow(t.storeA1, true)
  })
})

describe('signing in (DELIVERY §5)', () => {
  it('takes the code: an invited rider joins and becomes active, with a session as `me`', async () => {
    await db.sql`delete from rider_code where phone = ${ravi}`
    await requestCode(ravi)
    const { token, code } = await signIn(ravi, (await textedCode(ravi)) ?? '')
    expect(code).toBeUndefined()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect((await riderRow(ravi))?.status).toBe('active')
    expect(await me(token)).toMatchObject({ name: 'Ravi K.', phone: ravi })
    const entries = await db.sql<{ action: string; actor_kind: string; api: string }[]>`select action, actor_kind, api from activity_log where action in ('rider.joined', 'rider.signed_in') and target_label = 'Ravi K.' order by action`
    expect(entries).toEqual([
      { action: 'rider.joined', actor_kind: 'rider', api: 'delivery' },
      { action: 'rider.signed_in', actor_kind: 'rider', api: 'delivery' },
    ])
    // Only the hash is kept (DATA-MODEL §3.6).
    expect(await db.sql`select 1 from rider_session where id_hash = ${await hashSessionId(token ?? '')}`).toHaveLength(1)
  })

  it('refuses a wrong code, a spent one and an expired one alike, and an uninvited number the same', async () => {
    await db.sql`delete from rider_code where phone = ${meena}`
    await requestCode(meena)
    const code = (await textedCode(meena)) ?? ''
    expect((await signIn(meena, code === '000000' ? '111111' : '000000')).code).toBe('CODE_REFUSED')
    expect((await signIn(stranger, code)).code).toBe('CODE_REFUSED')
    await db.sql`update rider_code set expires_at = now() - interval '1 minute' where phone = ${meena}`
    expect((await signIn(meena, code)).code).toBe('CODE_REFUSED')
    expect((await riderRow(meena))?.status).toBe('invited')
  })

  it('locks a code after 5 wrong tries, the right one included', async () => {
    await db.sql`delete from rider_code where phone = ${meena}`
    await requestCode(meena)
    const code = (await textedCode(meena)) ?? ''
    const wrong = code === '000000' ? '111111' : '000000'
    for (let i = 0; i < 5; i++) expect((await signIn(meena, wrong)).code).toBe('CODE_REFUSED')
    expect((await signIn(meena, code)).code).toBe('CODE_REFUSED')
  })

  it('refuses a suspended rider with a code from before', async () => {
    const id = (await riderRow(sunil))?.id ?? ''
    await db.sql`update rider set status = 'active' where id = ${id}`
    await db.sql`delete from rider_code where phone = ${sunil}`
    await requestCode(sunil)
    const code = (await textedCode(sunil)) ?? ''
    expect((await w.gql('owner', 'mutation S($id: ID!) { suspendRider(id: $id) { status } }', { id })).code).toBeUndefined()
    expect((await signIn(sunil, code)).code).toBe('RIDER_SUSPENDED')
    await w.gql('owner', 'mutation R($id: ID!) { restoreRider(id: $id) { status } }', { id })
  })

  it('refuses a code once the plan has no own delivery', async () => {
    await db.sql`delete from rider_code where phone = ${sunil}`
    await requestCode(sunil)
    const code = (await textedCode(sunil)) ?? ''
    await allow(t.storeA1, false)
    expect((await signIn(sunil, code)).code).toBe('CODE_REFUSED')
    await allow(t.storeA1, true)
  })

  it('limits tries per address and per number', async () => {
    limiterOpen = false
    expect((await signIn(ravi, '123456')).code).toBe('RATE_LIMITED')
    limiterOpen = true
    expect(limiterKeys).toContain(`delivery:${t.storeA1}:verify-ip:203.0.113.7`)
    expect(limiterKeys.some((k) => k.startsWith(`delivery:${t.storeA1}:verify:`) && !k.includes(ravi))).toBe(true)
  })
})

describe('the session', () => {
  it('ends at sign-out, and an expired, foreign or made-up one reads as signed out', async () => {
    const token = await signedIn(ravi)
    expect((await delivery('mutation { signOut }', { token })).data).toEqual({ signOut: true })
    expect(await me(token)).toBeNull()
    const again = await signedIn(ravi)
    await db.sql`update rider_session set expires_at = now() - interval '1 minute' where id_hash = ${await hashSessionId(again)}`
    expect(await me(again)).toBeNull()
    expect(await me('f'.repeat(64))).toBeNull()
    expect((await delivery('mutation { updateProfile(name: "X") { id } }', { token: again })).code).toBe('UNAUTHENTICATED')
  })

  it('stops working once the rider is suspended', async () => {
    const token = await signedIn(sunil)
    const id = (await riderRow(sunil))?.id ?? ''
    await w.gql('owner', 'mutation S($id: ID!) { suspendRider(id: $id) { status } }', { id })
    expect(await me(token)).toBeNull()
    await w.gql('owner', 'mutation R($id: ID!) { restoreRider(id: $id) { status } }', { id })
    // Suspension ended it for good: restoring doesn't bring it back.
    expect(await me(token)).toBeNull()
  })
})

describe('the rider’s own profile', () => {
  const save = (token: string, variables: Record<string, unknown>) =>
    delivery('mutation P($name: String!, $photo: ID, $type: VehicleType, $number: String) { updateProfile(name: $name, photoAssetId: $photo, vehicleType: $type, vehicleNumber: $number) { name photoAssetId vehicleType vehicleNumber } }', { token, variables })

  it('saves the name, vehicle and the rider’s own uploaded photo, logging the fields and never their values', async () => {
    const token = await signedIn(ravi)
    const uploaded = await upload(token)
    expect(uploaded.status).toBe(200)
    const photo = ((await uploaded.json()) as { asset: { id: string } }).asset.id
    const saved = await save(token, { name: 'Ravi Kumar', photo, type: 'scooter', number: 'RJ14 AB 1234' })
    expect(saved).toEqual({ data: { updateProfile: { name: 'Ravi Kumar', photoAssetId: photo, vehicleType: 'scooter', vehicleNumber: 'RJ14 AB 1234' } }, code: undefined })
    const [entry] = await db.sql<{ actor_kind: string; changes: unknown }[]>`select actor_kind, changes from activity_log where action = 'rider.profile_saved' order by occurred_at desc limit 1`
    expect(entry?.actor_kind).toBe('rider')
    expect(JSON.stringify(entry?.changes)).not.toContain('RJ14')
    const [file] = await db.sql<{ actor_kind: string; api: string }[]>`select actor_kind, api from activity_log where action = 'asset.uploaded' and actor_id = ${(await riderRow(ravi))?.id ?? ''}`
    expect(file).toEqual({ actor_kind: 'rider', api: 'delivery' })
  })

  it('refuses input past its limits, another rider’s photo, and an upload without a session', async () => {
    const token = await signedIn(ravi)
    expect((await save(token, { name: ' ' })).code).toBe('INVALID_INPUT')
    expect((await save(token, { name: 'Ravi', number: 'x'.repeat(21) })).code).toBe('INVALID_INPUT')
    const other = await signedIn(sunil)
    const theirs = await uploadedId(other)
    expect((await save(token, { name: 'Ravi', photo: theirs })).code).toBe('PHOTO_NOT_FOUND')
    expect((await upload(null)).status).toBe(401)
  })

  it('takes at most 10 photos a rider in 24 hours, the next refused with nothing stored', async () => {
    const token = await signedIn(meena)
    const id = (await riderRow(meena))?.id ?? ''
    const already = (await db.sql<{ n: number }[]>`select count(*)::int as n from asset where created_by = ${id}`)[0]?.n ?? 0
    for (let i = already; i < photoUploadsPerDay; i++) expect((await upload(token)).status).toBe(200)
    const refused = await upload(token)
    expect([refused.status, await refused.json()]).toEqual([429, { ok: false, code: 'RATE_LIMITED' }])
    expect(await db.sql`select 1 from asset where created_by = ${id}`).toHaveLength(photoUploadsPerDay)
    // A day later the rider may upload again.
    await db.sql`update asset set created_at = now() - interval '25 hours' where created_by = ${id}`
    expect((await upload(token)).status).toBe(200)
  })

  it('counts parallel uploads against one another, never past the limit', async () => {
    const token = await signedIn(meena)
    const id = (await riderRow(meena))?.id ?? ''
    const recent = async () => (await db.sql<{ n: number }[]>`select count(*)::int as n from asset where created_by = ${id} and created_at >= now() - interval '24 hours'`)[0]?.n ?? 0
    const already = await recent()
    const answers = await Promise.all(Array.from({ length: 30 }, () => upload(token).then((r) => r.status)))
    expect(answers.filter((s) => s === 200)).toHaveLength(photoUploadsPerDay - already)
    expect(answers.filter((s) => s !== 200).every((s) => s === 429)).toBe(true)
    expect(await recent()).toBe(photoUploadsPerDay)
  })
})

const phoneToken = (name: string) => `ExponentPushToken[${name}]`
const register = (token: string | null, expo: string, o: { host?: string; platform?: 'ios' | 'android' } = {}) =>
  delivery(`mutation R($t: String!) { registerPushDevice(token: $t, platform: ${o.platform ?? 'android'}) }`, { ...(o.host ? { host: o.host } : {}), token, variables: { t: expo } })
const unregister = (token: string | null, expo: string) => delivery('mutation U($t: String!) { unregisterPushDevice(token: $t) }', { token, variables: { t: expo } })
const devicesOf = async (phone: string) =>
  db.sql<{ store_id: string; expo_token: string; platform: string }[]>`select store_id, expo_token, platform from push_device where subject_kind = 'rider' and subject_id = ${(await riderRow(phone))?.id ?? ''} order by expo_token`
const pushesFor = async (phone: string) => (await db.sql`select 1 from outbox where kind = 'push' and payload->'subject'->>'id' = ${(await riderRow(phone))?.id ?? ''}`).length

describe('the rider’s phones for push (DELIVERY §4, §6)', () => {
  it('registers a phone once, logged without its token and confirmed by one push; a launch’s re-register only refreshes it', async () => {
    const token = await signedIn(ravi)
    const id = (await riderRow(ravi))?.id ?? ''
    expect(await register(token, phoneToken('ravi-1'))).toEqual({ data: { registerPushDevice: true }, code: undefined })
    expect(await devicesOf(ravi)).toEqual([{ store_id: t.storeA1, expo_token: phoneToken('ravi-1'), platform: 'android' }])
    const entries = await db.sql<{ actor_kind: string; actor_id: string; api: string }[]>`select actor_kind, actor_id, api from activity_log where action = 'rider.push_device_registered' and actor_id = ${id}`
    expect(entries).toEqual([{ actor_kind: 'rider', actor_id: id, api: 'delivery' }])
    expect(JSON.stringify(await db.sql`select * from activity_log where actor_id = ${id}`)).not.toContain('ravi-1')
    const [push] = await db.sql<{ payload: unknown; store_id: string }[]>`select payload, store_id from outbox where kind = 'push' and payload->'subject'->>'id' = ${id}`
    expect(push).toEqual({ payload: { subject: { kind: 'rider', id }, message: 'rider.notifications_on' }, store_id: t.storeA1 })
    await db.sql`update push_device set last_seen_at = now() - interval '1 day' where expo_token = ${phoneToken('ravi-1')}`
    expect((await register(token, phoneToken('ravi-1'), { platform: 'ios' })).data).toEqual({ registerPushDevice: true })
    expect(await devicesOf(ravi)).toEqual([{ store_id: t.storeA1, expo_token: phoneToken('ravi-1'), platform: 'ios' }])
    expect(await db.sql`select 1 from push_device where expo_token = ${phoneToken('ravi-1')} and last_seen_at > now() - interval '1 minute'`).toHaveLength(1)
    expect(await db.sql`select 1 from activity_log where action = 'rider.push_device_registered' and actor_id = ${id}`).toHaveLength(1)
    expect(await pushesFor(ravi)).toBe(1)
  })

  it('refuses a token that isn’t Expo’s, never echoing it, and a caller who isn’t signed in', async () => {
    const token = await signedIn(ravi)
    for (const bad of ['not-a-token', 'ExponentPushToken[]', 'ExponentPushToken[a b]', `ExponentPushToken[${'x'.repeat(201)}]`]) {
      expect((await register(token, bad)).code, bad).toBe('INVALID_INPUT')
      expect((await unregister(token, bad)).code, bad).toBe('INVALID_INPUT')
    }
    expect((await register(null, phoneToken('nobody'))).code).toBe('UNAUTHENTICATED')
    expect(await db.sql`select 1 from push_device where expo_token = ${phoneToken('nobody')}`).toHaveLength(0)
  })

  it('moves a phone registered again by another rider of the store to that rider, logged and confirmed', async () => {
    const meenaToken = await signedIn(meena)
    const raviToken = await signedIn(ravi)
    await register(meenaToken, phoneToken('shared'))
    const before = await pushesFor(ravi)
    expect((await register(raviToken, phoneToken('shared'))).data).toEqual({ registerPushDevice: true })
    expect((await devicesOf(meena)).map((d) => d.expo_token)).not.toContain(phoneToken('shared'))
    expect((await devicesOf(ravi)).map((d) => d.expo_token)).toContain(phoneToken('shared'))
    expect(await pushesFor(ravi)).toBe(before + 1)
  })

  it('unregisters only the caller’s own phone, answering the same for another’s', async () => {
    const meenaToken = await signedIn(meena)
    const raviToken = await signedIn(ravi)
    await register(meenaToken, phoneToken('meena-1'))
    await register(raviToken, phoneToken('ravi-2'))
    expect(await unregister(raviToken, phoneToken('meena-1'))).toEqual({ data: { unregisterPushDevice: true }, code: undefined })
    expect((await devicesOf(meena)).map((d) => d.expo_token)).toContain(phoneToken('meena-1'))
    const id = (await riderRow(ravi))?.id ?? ''
    const removedBefore = (await db.sql`select 1 from activity_log where action = 'rider.push_device_removed' and actor_id = ${id}`).length
    expect((await unregister(raviToken, phoneToken('ravi-2'))).data).toEqual({ unregisterPushDevice: true })
    expect((await devicesOf(ravi)).map((d) => d.expo_token)).not.toContain(phoneToken('ravi-2'))
    expect(await db.sql`select 1 from activity_log where action = 'rider.push_device_removed' and actor_id = ${id}`).toHaveLength(removedBefore + 1)
  })

  it('removes every phone of the rider at sign-out', async () => {
    const token = await signedIn(meena)
    await register(token, phoneToken('meena-2'))
    await register(token, phoneToken('meena-3'), { platform: 'ios' })
    expect((await devicesOf(meena)).length).toBeGreaterThanOrEqual(2)
    expect((await delivery('mutation { signOut }', { token })).data).toEqual({ signOut: true })
    expect(await devicesOf(meena)).toEqual([])
  })
})

describe('deleting the account (DELIVERY §5, as removal)', () => {
  it('signs the rider out everywhere, erases phone and photo, keeps the name, and frees the number', async () => {
    const token = await signedIn(sunil)
    const other = await signedIn(sunil)
    const id = (await riderRow(sunil))?.id ?? ''
    const replaced = await uploadedId(token)
    const current = await uploadedId(token)
    await delivery('mutation P($photo: ID) { updateProfile(name: "Sunil D.", photoAssetId: $photo) { id } }', { token, variables: { photo: current } })
    const keys = (await db.sql<{ r2_key: string }[]>`select r2_key from asset where created_by = ${id}`).map((r) => r.r2_key)
    expect(keys.length).toBeGreaterThanOrEqual(2)
    expect((await delivery('mutation { deleteMyAccount }', { token })).data).toEqual({ deleteMyAccount: true })
    expect(await riderRow(null, id)).toMatchObject({ status: 'removed', phone: null, photo_asset_id: null })
    // Every photo the rider uploaded goes, the replaced one too: rows and files (DELIVERY §5).
    expect(await db.sql`select 1 from asset where id in (${replaced}, ${current}) or created_by = ${id}`).toHaveLength(0)
    expect(deletedKeys).toEqual(expect.arrayContaining(keys))
    for (const key of keys) expect(bucket.has(key)).toBe(false)
    expect(await me(other)).toBeNull()
    const [entry] = await db.sql<{ actor_kind: string; actor_id: string; target_label: string }[]>`select actor_kind, actor_id, target_label from activity_log where action = 'rider.account_deleted'`
    expect(entry).toEqual({ actor_kind: 'rider', actor_id: id, target_label: 'Sunil D.' })
    expect(JSON.stringify(await db.sql`select * from activity_log where target_type = 'rider'`)).not.toContain(sunil)
    await invite('owner', 'Sunil D.', sunil)
  })

  it('keeps a photo the store has since put on a product, as the store’s, and deletes the rest', async () => {
    const token = await signedIn(sunil)
    const id = (await riderRow(sunil))?.id ?? ''
    const used = await uploadedId(token)
    const unused = await uploadedId(token)
    const [product] = await db.sql<{ id: string }[]>`insert into product (store_id, name, slug) values (${t.storeA1}, 'Rider photo', 'rider-photo') returning id`
    await db.sql`insert into product_photo (product_id, store_id, asset_id, position) values (${product?.id ?? ''}, ${t.storeA1}, ${used}, 0)`
    const keyOf = async (asset: string) => (await db.sql<{ r2_key: string }[]>`select r2_key from asset where id = ${asset}`)[0]?.r2_key ?? ''
    const [usedKey, unusedKey] = [await keyOf(used), await keyOf(unused)]
    // The account's own writes after the kept photo prove its savepoint left the transaction usable.
    expect((await delivery('mutation { deleteMyAccount }', { token })).data).toEqual({ deleteMyAccount: true })
    expect(await riderRow(null, id)).toMatchObject({ status: 'removed', phone: null })
    expect(await db.sql`select 1 from asset where id = ${used}`).toHaveLength(1)
    expect(await db.sql`select 1 from asset where id = ${unused}`).toHaveLength(0)
    expect([bucket.has(usedKey), bucket.has(unusedKey)]).toEqual([true, false])
    expect(deletedKeys).not.toContain(usedKey)
    expect(await db.sql`select 1 from activity_log where action = 'rider.account_deleted' and actor_id = ${id}`).toHaveLength(1)
    await invite('owner', 'Sunil D.', sunil)
  })

  it('deletes the rider’s phones with the account', async () => {
    const token = await signedIn(sunil)
    await register(token, phoneToken('sunil-1'))
    const id = (await riderRow(sunil))?.id ?? ''
    expect((await delivery('mutation { deleteMyAccount }', { token })).data).toEqual({ deleteMyAccount: true })
    expect(await db.sql`select 1 from push_device where subject_id = ${id}`).toHaveLength(0)
    await invite('owner', 'Sunil D.', sunil)
  })
})

describe('who reaches what (ACCESS §11.1, DELIVERY §10)', () => {
  it('reads another store’s rider token as signed out, and lets no rider sign in on another store’s host', async () => {
    const token = await signedIn(ravi)
    expect(await me(token, hostA2)).toBeNull()
    await requestCode(ravi, hostA2)
    expect((await signIn(ravi, (await textedCode(ravi)) ?? '', hostA2)).code).toBe('CODE_REFUSED')
  })

  it('keeps a phone per store: another store’s rider registering the same token moves nothing here, and a token of this store is refused there', async () => {
    const raviToken = await signedIn(ravi)
    const ashaToken = await signedIn(asha, hostA2)
    await register(raviToken, phoneToken('both-stores'))
    expect((await register(ashaToken, phoneToken('both-stores'), { host: hostA2 })).data).toEqual({ registerPushDevice: true })
    expect((await devicesOf(ravi)).filter((d) => d.expo_token === phoneToken('both-stores'))).toEqual([{ store_id: t.storeA1, expo_token: phoneToken('both-stores'), platform: 'android' }])
    expect((await devicesOf(asha)).filter((d) => d.expo_token === phoneToken('both-stores'))).toEqual([{ store_id: t.storeA2, expo_token: phoneToken('both-stores'), platform: 'android' }])
    expect((await register(raviToken, phoneToken('ravi-on-a2'), { host: hostA2 })).code).toBe('UNAUTHENTICATED')
    expect(await db.sql`select 1 from push_device where expo_token = ${phoneToken('ravi-on-a2')}`).toHaveLength(0)
  })

  it('refuses a shopper’s session and a portal session on the Delivery API', async () => {
    const [customer] = await db.sql<{ id: string }[]>`insert into customer (store_id, phone, phone_verified_at, status) values (${t.storeA1}, '+919822200001', now(), 'active') returning id`
    const shopperToken = 'a'.repeat(64)
    await db.sql`insert into customer_session (id_hash, store_id, customer_id, expires_at) values (${await hashSessionId(shopperToken)}, ${t.storeA1}, ${customer?.id ?? ''}, now() + interval '1 day')`
    expect(await me(shopperToken)).toBeNull()
    expect((await delivery('{ me { id } }', { headers: { 'x-shop-session': shopperToken } })).data).toEqual({ me: null })
    expect((await delivery('{ me { id } }', { headers: { cookie: '__Host-portal_session=abc' } })).data).toEqual({ me: null })
  })

  it('refuses a rider token on the Shop and Store APIs', async () => {
    const token = await signedIn(ravi)
    const found = await resolveShopper(db.sql, new Request(`https://${hostA1}/shop-api`, { headers: { authorization: `Bearer ${token}`, 'x-shop-session': token } }), hostA1, shopDomain)
    if (found.kind !== 'found') throw new Error('no store')
    expect(found.shopper.context.caller).toMatchObject({ kind: 'shopper', customerId: null })
    const shop: ShopContext = { sql: db.sql, shopper: found.shopper, origin: `https://${hostA1}`, activity: activityLog, facts: { requestId: 'r', ip: '203.0.113.7', userAgent: null }, allowNewCart: async () => true, now }
    const shopMe = await graphql({ schema: shopSchema as GraphQLSchema, source: '{ me { id } }', contextValue: shop })
    expect(shopMe.data?.['me'] ?? null).toBeNull()
    expect((await w.bearer(token, '{ riders { nodes { id } } }', t.partnerA)).code).toMatch(/^(UNAUTHENTICATED|FORBIDDEN)$/)
  })
})

describe('the rows (DATA-MODEL §3.6, §5.3)', () => {
  const riderContext = async (phone: string): Promise<TenantContext> => ({
    caller: { kind: 'rider', riderId: (await riderRow(phone))?.id ?? '' },
    partnerId: t.partnerA,
    storeId: t.storeA1,
    sellerScope: { kind: 'all' },
    subscription: 'active',
  })

  it('lets app_rider read only its own row, and never a code or a session’s hash', async () => {
    const ctx = await riderContext(ravi)
    expect(await withScope(db.sql, ctx, (tx) => tx`select id from rider`)).toEqual([{ id: (await riderRow(ravi))?.id }])
    await expect(withScope(db.sql, ctx, (tx) => tx`select id from rider_code`)).rejects.toThrow()
    await expect(withScope(db.sql, ctx, (tx) => tx`select id_hash from rider_session`)).rejects.toThrow()
    await expect(withScope(db.sql, ctx, (tx) => tx`select id from customer`)).rejects.toThrow()
  })

  it('lets app_rider change no other rider, and never restore itself', async () => {
    const ctx = await riderContext(ravi)
    const meenaId = (await riderRow(meena))?.id ?? ''
    expect((await withScope(db.sql, ctx, (tx) => tx`update rider set name = 'X' where id = ${meenaId}`)).count).toBe(0)
    await expect(withScope(db.sql, ctx, (tx) => tx`update rider set status = 'suspended' where id = ${ctx.caller.kind === 'rider' ? ctx.caller.riderId : ''}`)).rejects.toThrow()
  })

  it('lets app_rider log only as itself, in its own store', async () => {
    const ctx = await riderContext(ravi)
    const write = (actorId: string) =>
      withScope(db.sql, ctx, (tx) => tx`insert into activity_log (category, action, result, actor_kind, actor_id, partner_id, store_id, api, visibility) values ('write', 'x', 'success', 'rider', ${actorId}, ${t.partnerA}, ${t.storeA1}, 'delivery', 'store')`)
    await expect(write((await riderRow(meena))?.id ?? '')).rejects.toThrow()
    await expect(write(ctx.caller.kind === 'rider' ? ctx.caller.riderId : '')).resolves.toBeDefined()
  })

  it('lets app_rider see and delete only its own phones, and register none itself', async () => {
    const ctx = await riderContext(ravi)
    const raviId = (await riderRow(ravi))?.id ?? ''
    const meenaId = (await riderRow(meena))?.id ?? ''
    await db.sql`insert into push_device (store_id, subject_kind, subject_id, expo_token, platform) values
      (${t.storeA1}, 'rider', ${raviId}, ${phoneToken('rows-ravi')}, 'android'), (${t.storeA1}, 'rider', ${meenaId}, ${phoneToken('rows-meena')}, 'ios'),
      (${t.storeA1}, 'customer', ${raviId}, ${phoneToken('rows-customer')}, 'ios')`
    const seen = await withScope(db.sql, ctx, (tx) => tx<{ subject_id: string; subject_kind: string }[]>`select subject_id, subject_kind from push_device`)
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((d) => d.subject_id === raviId && d.subject_kind === 'rider')).toBe(true)
    expect((await withScope(db.sql, ctx, (tx) => tx`delete from push_device where expo_token in (${phoneToken('rows-meena')}, ${phoneToken('rows-customer')})`)).count).toBe(0)
    expect((await withScope(db.sql, ctx, (tx) => tx`delete from push_device where expo_token = ${phoneToken('rows-ravi')}`)).count).toBe(1)
    await expect(withScope(db.sql, ctx, (tx) => tx`insert into push_device (store_id, subject_kind, subject_id, expo_token, platform) values (${t.storeA1}, 'rider', ${raviId}, ${phoneToken('rows-new')}, 'ios')`)).rejects.toThrow()
    await expect(withScope(db.sql, ctx, (tx) => tx`update push_device set subject_id = ${raviId}`)).rejects.toThrow()
  })

  it('sweeps codes a day past expiry and sessions a month after they end', async () => {
    await db.sql`update rider_code set expires_at = now() - interval '2 days' where phone = ${meena}`
    await db.sql`update rider_session set ended_at = now() - interval '31 days' where rider_id = ${(await riderRow(ravi))?.id ?? ''}`
    await withSystemScope(db.sql, (tx) => purgeRiderSignIns(tx, new Date(), 1000))
    expect(await codesFor(meena)).toBe(0)
    expect(await db.sql`select 1 from rider_session where rider_id = ${(await riderRow(ravi))?.id ?? ''}`).toHaveLength(0)
  })
})

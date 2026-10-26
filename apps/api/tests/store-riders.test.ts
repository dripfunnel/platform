import type postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hashSessionId } from '#auth/session'
import type { OutgoingSms, SmsSender } from '#core/sms'
import { withSystemScope } from '#db/scoped/index'
import { deliveryAppLink } from '#engine/modules/ownDelivery/index'
import { smsDeliverer } from '#jobs/queues/deliverers/sms'
import { defaultRelayOptions, relayDue } from '#jobs/queues/outbox-relay'
import { activityLog } from '#saas/activity/index'
import { smsMessages, type PartnerSmsAccounts } from '#saas/sms/index'
import { exchangeSupportHandoff } from '#saas/storeSupport/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'
import { seedStoreWorld, type StoreWorld, type Who } from './support/storeWorld'

// Card #838 (DL 1): Settings › Riders in the Store API, the Owner's; the plan's own_delivery and riders (DELIVERY §5, §8, §9).

let db: TestDatabase
let t: Tenants
let w: StoreWorld
const now = () => new Date()

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  w = await seedStoreWorld(db.sql, t, { now, secrets: null, lookup: null, extra: { domains: { edgeZone: 'dripfunnel.example', localHosts: false, shopDomain: 'shop.example' } } })
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

/** Own delivery on, with room for `riders`, on the store's plan; `null` takes the switch away again. */
const allow = async (storeId: string, riders: number | null) => {
  const [store] = await db.sql<{ plan_id: string; partner_id: string }[]>`select plan_id, partner_id from store where id = ${storeId}`
  await db.sql`delete from plan_entitlement where plan_id = ${store?.plan_id ?? ''} and key in ('own_delivery', 'riders')`
  if (riders === null) return
  await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, enabled, amount)
    values (${store?.plan_id ?? ''}, ${store?.partner_id ?? ''}, 1, 'own_delivery', true, null), (${store?.plan_id ?? ''}, ${store?.partner_id ?? ''}, 1, 'riders', null, ${riders})`
}

const invite = async (who: Who, name: string, phone: string) => {
  const r = await w.gql(who, 'mutation I($name: String!, $phone: String!) { inviteRider(name: $name, phone: $phone) { id name phone status online deliveriesDone currentDeliveryId } }', { name, phone })
  return { rider: r.data?.['inviteRider'] as { id: string; name: string; phone: string | null; status: string } | undefined, code: r.code, extensions: r.extensions }
}
const act = async (who: Who, field: 'resendRiderInvitation' | 'suspendRider' | 'restoreRider' | 'removeRider', id: string) => {
  const selection = field === 'suspendRider' || field === 'restoreRider' ? '{ status }' : ''
  return w.gql(who, `mutation A($id: ID!) { ${field}(id: $id) ${selection} }`, { id })
}
const list = async (who: Who, first?: number) => {
  const r = await w.gql(who, 'query L($first: Int) { riders(first: $first) { nodes { id name phone status } pageInfo { hasNextPage endCursor } } }', { first })
  return { page: r.data?.['riders'] as { nodes: { id: string; name: string; phone: string | null; status: string }[]; pageInfo: { hasNextPage: boolean } } | undefined, code: r.code }
}
const row = async (id: string) => (await db.sql<{ status: string; phone: string | null; photo_asset_id: string | null; removed_at: Date | null; name: string }[]>`select status, phone, photo_asset_id, removed_at, name from rider where id = ${id}`)[0]

describe('the plan', () => {
  it('refuses an invitation while the plan leaves own delivery off, every listed plan does (DELIVERY §9)', async () => {
    await allow(w.storeOf('owner'), null)
    const made = await invite('owner', 'Ravi K.', '+919800000011')
    expect(made.code).toBe('PLAN_LIMIT')
    expect(made.extensions).toMatchObject({ key: 'own_delivery', limit: null })
    expect(await db.sql`select 1 from rider where store_id = ${w.storeOf('owner')}`).toHaveLength(0)
  })

  it('refuses one past the riders limit, counting invited and active riders but not suspended or removed ones', async () => {
    await allow(w.storeOf('owner'), 2)
    const first = await invite('owner', 'Limit One', '+919800000101')
    const second = await invite('owner', 'Limit Two', '+919800000102')
    const third = await invite('owner', 'Limit Three', '+919800000103')
    expect(third.code).toBe('PLAN_LIMIT')
    expect(third.extensions).toMatchObject({ key: 'riders', limit: 2 })
    expect((await act('owner', 'removeRider', second.rider?.id ?? '')).code).toBeUndefined()
    await db.sql`update rider set status = 'active' where id = ${first.rider?.id ?? ''}`
    expect((await act('owner', 'suspendRider', first.rider?.id ?? '')).code).toBeUndefined()
    expect((await invite('owner', 'Limit Three', '+919800000103')).code).toBeUndefined()
    await db.sql`update rider set status = 'removed', phone = null, removed_at = now() where store_id = ${w.storeOf('owner')}`
  })
})

describe('inviting a rider', () => {
  beforeAll(async () => {
    await allow(w.storeOf('owner'), 10)
  })

  it('adds an invited rider and queues the text with the store’s name and its app link', async () => {
    const made = await invite('owner', '  Ravi K. ', '+919800000011')
    expect(made.code).toBeUndefined()
    expect(made.rider).toMatchObject({ name: 'Ravi K.', phone: '+919800000011', status: 'invited', online: false, deliveriesDone: 0, currentDeliveryId: null })
    const [text] = await db.sql<{ payload: { message: string; to: string; brand: string; vars: { link: string } }; store_id: string }[]>`select payload, store_id from outbox where kind = 'sms' and payload->>'to' = '+919800000011'`
    const [store] = await db.sql<{ slug: string }[]>`select slug from store where id = ${w.storeOf('owner')}`
    expect(text).toEqual({ payload: expect.objectContaining({ message: 'rider.invited', to: '+919800000011', brand: 'Store A1', vars: { link: deliveryAppLink(store?.slug ?? '', 'shop.example') } }), store_id: w.storeOf('owner') })
    const entries = await db.sql<{ target_label: string; actor_id: string; reason: string | null }[]>`select target_label, actor_id, reason from activity_log where action = 'rider.invited' and target_id = ${made.rider?.id ?? ''}`
    expect(entries).toEqual([{ target_label: 'Ravi K.', actor_id: w.people.owner, reason: null }])
  })

  it('sends that text through the partner’s SMS account, as the local stand-in does', async () => {
    const sent: OutgoingSms[] = []
    const sender: SmsSender = { send: async (sms) => (sent.push(sms), { providerId: 'local' }) }
    const local: PartnerSmsAccounts = { forPartner: async (_, __, provider) => (provider === 'msg91' ? { provider, authKey: 'local', templates: Object.fromEntries(smsMessages.map((m) => [m, 'local'])) } : null) }
    const at = new Date(((await db.sql<{ now: Date }[]>`select now() as now`)[0]?.now ?? new Date()).getTime() + 1000)
    await relayDue(db.sql, { sms: smsDeliverer(db.sql, local, { msg91: () => sender, twilio: () => sender }, () => at) }, { ...defaultRelayOptions, now: () => at, baseDelayMs: 0 })
    const text = sent.find((s) => s.to === '+919800000011')
    expect(text?.text).toMatch(/^Store A1: you're invited to deliver our orders\. Get the app and sign in with this number: https:\/\/.+\.shop\.example\/app\/delivery\.apk$/)
  })

  it('refuses a bad name or number, and a number already one of the store’s riders', async () => {
    expect((await invite('owner', ' ', '+919800000012')).code).toBe('INVALID_INPUT')
    expect((await invite('owner', 'Meena P.', '98000 00012')).code).toBe('INVALID_PHONE')
    expect((await invite('owner', 'Someone else', '+919800000011')).code).toBe('PHONE_TAKEN')
  })

  it('lists the store’s riders newest first, 50 a page unless asked, without removed ones', async () => {
    await invite('owner', 'Meena P.', '+919800000012')
    const all = await list('owner')
    expect(all.page?.nodes.map((r) => r.name)).toEqual(['Meena P.', 'Ravi K.'])
    const one = await list('owner', 1)
    expect(one.page?.nodes).toHaveLength(1)
    expect(one.page?.pageInfo.hasNextPage).toBe(true)
  })
})

describe('resending, suspending, restoring and removing', () => {
  const idOf = async (phone: string) => (await db.sql<{ id: string }[]>`select id from rider where phone = ${phone}`)[0]?.id ?? ''

  it('texts an invited rider three times a day, the invitation included, never one who has joined', async () => {
    const id = await idOf('+919800000012')
    for (let i = 0; i < 2; i++) expect((await act('owner', 'resendRiderInvitation', id)).code).toBeUndefined()
    expect((await act('owner', 'resendRiderInvitation', id)).code).toBe('RATE_LIMITED')
    expect(await db.sql`select 1 from outbox where kind = 'sms' and payload->>'to' = '+919800000012'`).toHaveLength(3)
    const joined = await idOf('+919800000011')
    await db.sql`update rider set status = 'active' where id = ${joined}`
    expect((await act('owner', 'resendRiderInvitation', joined)).code).toBe('NOT_INVITED')
  })

  it('sends no text once the plan no longer has own delivery', async () => {
    const id = await idOf('+919800000012')
    await allow(w.storeOf('owner'), null)
    const refused = await act('owner', 'resendRiderInvitation', id)
    await allow(w.storeOf('owner'), 10)
    expect(refused.code).toBe('PLAN_LIMIT')
    expect(refused.extensions?.['key']).toBe('own_delivery')
  })

  it('suspends an active rider, ending every session at once, and restores them', async () => {
    const id = await idOf('+919800000011')
    await db.sql`insert into rider_session (id_hash, store_id, rider_id, expires_at) values (${await hashSessionId('rider-a')}, ${w.storeOf('owner')}, ${id}, now() + interval '30 days'), (${await hashSessionId('rider-b')}, ${w.storeOf('owner')}, ${id}, now() + interval '30 days')`
    const suspended = await act('owner', 'suspendRider', id)
    expect(suspended.data?.['suspendRider']).toEqual({ status: 'suspended' })
    expect(await db.sql`select 1 from rider_session where rider_id = ${id} and ended_at is null`).toHaveLength(0)
    expect((await act('owner', 'suspendRider', id)).code).toBe('NOT_ACTIVE')
    expect((await act('owner', 'suspendRider', await idOf('+919800000012'))).code).toBe('NOT_ACTIVE')
    expect((await act('owner', 'restoreRider', id)).data?.['restoreRider']).toEqual({ status: 'active' })
    expect((await act('owner', 'restoreRider', id)).code).toBe('NOT_SUSPENDED')
    expect(await db.sql`select action from activity_log where target_id = ${id} and action in ('rider.suspended', 'rider.restored') order by occurred_at`).toEqual([{ action: 'rider.suspended' }, { action: 'rider.restored' }])
  })

  it('removes a rider: the phone and photo erased, the name kept, sessions ended, the number free again', async () => {
    const id = await idOf('+919800000011')
    await db.sql`insert into rider_session (id_hash, store_id, rider_id, expires_at) values (${await hashSessionId('rider-c')}, ${w.storeOf('owner')}, ${id}, now() + interval '30 days')`
    expect((await act('owner', 'removeRider', id)).data?.['removeRider']).toBe(true)
    expect(await row(id)).toMatchObject({ status: 'removed', phone: null, photo_asset_id: null, name: 'Ravi K.' })
    expect((await row(id))?.removed_at).not.toBeNull()
    expect(await db.sql`select 1 from rider_session where rider_id = ${id} and ended_at is null`).toHaveLength(0)
    expect((await list('owner')).page?.nodes.map((r) => r.id)).not.toContain(id)
    const entries = await db.sql<{ target_label: string; changes: unknown }[]>`select target_label, changes from activity_log where action = 'rider.removed' and target_id = ${id}`
    expect(entries.map((e) => e.target_label)).toEqual(['Ravi K.'])
    expect(JSON.stringify(await db.sql`select * from activity_log where target_type = 'rider'`)).not.toContain('+919800000011')
    expect((await act('owner', 'removeRider', id)).code).toBe('NOT_FOUND')
    expect((await invite('owner', 'Ravi K.', '+919800000011')).code).toBeUndefined()
  })

  it('deletes the rider’s phones for push with suspension and with removal, and no one else’s (#840)', async () => {
    const storeId = w.storeOf('owner')
    const phones = async (riderId: string) => (await db.sql`select 1 from push_device where subject_kind = 'rider' and subject_id = ${riderId}`).length
    const register = (riderId: string, name: string) =>
      db.sql`insert into push_device (store_id, subject_kind, subject_id, expo_token, platform) values (${storeId}, 'rider', ${riderId}, ${`ExponentPushToken[${name}]`}, 'android')`
    const suspended = (await invite('owner', 'Push One', '+919800000021')).rider?.id ?? ''
    const removed = (await invite('owner', 'Push Two', '+919800000022')).rider?.id ?? ''
    const bystander = crypto.randomUUID()
    await db.sql`update rider set status = 'active' where id = ${suspended}`
    await register(suspended, 'one-a')
    await register(suspended, 'one-b')
    await register(removed, 'two-a')
    await register(bystander, 'bystander')
    expect((await act('owner', 'suspendRider', suspended)).data?.['suspendRider']).toEqual({ status: 'suspended' })
    expect(await phones(suspended)).toBe(0)
    expect((await act('owner', 'removeRider', removed)).data?.['removeRider']).toBe(true)
    expect(await phones(removed)).toBe(0)
    expect(await phones(bystander)).toBe(1)
  })
})

describe('who may manage riders (ACCESS §11.1)', () => {
  let riderId = ''
  beforeAll(async () => {
    riderId = (await db.sql<{ id: string }[]>`select id from rider where store_id = ${w.storeOf('owner')} and status <> 'removed' limit 1`)[0]?.id ?? ''
    await allow(w.storeOf('a2Owner'), 10)
    await allow(w.storeOf('bOwner'), 10)
  })

  it('refuses the Manager, Staff and a supplier, for reading and for every write', async () => {
    for (const who of ['manager', 'staff', 'supplier'] as const) {
      expect((await list(who)).code).toBe('FORBIDDEN')
      expect((await invite(who, 'Not here', '+919800000099')).code).toBe('FORBIDDEN')
      for (const field of ['resendRiderInvitation', 'suspendRider', 'restoreRider', 'removeRider'] as const) expect((await act(who, field, riderId)).code).toBe('FORBIDDEN')
    }
  })

  it('shows another store’s Owner none of this store’s riders, and acts on none of them', async () => {
    for (const who of ['a2Owner', 'bOwner'] as const) {
      expect((await list(who)).page?.nodes).toEqual([])
      for (const field of ['resendRiderInvitation', 'suspendRider', 'restoreRider', 'removeRider'] as const) expect((await act(who, field, riderId)).code).toBe('NOT_FOUND')
    }
    expect((await row(riderId))?.status).not.toBe('removed')
  })

  it('refuses a partner’s support session, even one allowed to make changes, as the list holds riders’ phones', async () => {
    const [agent] = await db.sql<{ id: string }[]>`insert into partner_user (partner_id, email, name, role_key, status) values (${t.partnerA}, 'ravi@partner-a.example', 'Ravi', 'partner-support', 'active') returning id`
    const [seat] = await db.sql<{ id: string }[]>`select id from membership where user_id = ${w.people.owner}`
    const at = now()
    await db.sql`
      insert into support_session (partner_id, store_id, membership_id, partner_user_id, reason, started_at, expires_at, handoff_hash, handoff_expires_at, access, write_requested_at, write_decided_at)
      values (${t.partnerA}, ${t.storeA1}, ${seat?.id ?? ''}, ${agent?.id ?? ''}, 'Help', ${at}, ${new Date(at.getTime() + 30 * 60_000)}, ${await hashSessionId('tok-riders')}, ${new Date(at.getTime() + 5 * 60_000)}, 'write', ${at}, ${at})`
    const entered = await exchangeSupportHandoff({ sql: db.sql, partnerId: t.partnerA, activity: activityLog, facts: { requestId: 'r', ip: null, userAgent: null }, now }, 'tok-riders')
    const cookie = entered?.cookie ?? ''
    expect((await w.support(cookie, t.partnerA, '{ riders { nodes { phone } } }')).code).toBe('BLOCKED_FOR_SUPPORT')
    expect((await w.support(cookie, t.partnerA, `mutation { removeRider(id: "${riderId}") }`)).code).toBe('BLOCKED_FOR_SUPPORT')
  })

  it('refuses an API key, whatever its scopes', async () => {
    const made = await w.gql('owner', 'mutation { createApiKey(name: "Ledger", scopes: ["orders.read"]) { secret } }')
    const secret = (made.data?.['createApiKey'] as { secret: string } | undefined)?.secret ?? ''
    expect(secret).not.toBe('')
    expect((await w.bearer(secret, '{ riders { nodes { id } } }', t.partnerA)).code).toBe('FORBIDDEN')
  })
})

describe('the rows (DATA-MODEL §3.6)', () => {
  const as = (role: string, scope: string, work: (tx: postgres.TransactionSql) => Promise<unknown>, seller = '') =>
    db.sql.begin(async (tx: postgres.TransactionSql) => {
      await tx.unsafe(`set local role ${role}`)
      for (const [k, v] of [['app.scope', scope], ['app.partner_id', t.partnerA], ['app.store_id', t.storeA1], ['app.seller_id', seller], ['app.support', '']] as const) await tx`select set_config(${k}, ${v}, true)`
      return work(tx)
    })

  it('gives a supplier, a shopper, a partner and staff no rider row', async () => {
    await expect(as('app_supplier', 'store', (tx) => tx`select id from rider`, t.sellerA1First)).rejects.toThrow(/permission denied/)
    await expect(as('app_shop', 'shop', (tx) => tx`select id from rider`)).rejects.toThrow(/permission denied/)
    await expect(as('app_partner', 'partner', (tx) => tx`select id from rider`)).rejects.toThrow(/permission denied/)
    await expect(as('app_platform', 'platform', (tx) => tx`select id from rider`)).rejects.toThrow(/permission denied/)
  })

  it('never lets the merchant side read a session’s hash or a sign-in code', async () => {
    await expect(as('app_request', 'store', (tx) => tx`select id_hash from rider_session`)).rejects.toThrow(/permission denied/)
    await expect(as('app_request', 'store', (tx) => tx`select phone from rider_code`)).rejects.toThrow(/permission denied/)
  })

  it('never lets the merchant side read a phone’s push token, nor a supplier reach the phones at all (#840)', async () => {
    await expect(as('app_request', 'store', (tx) => tx`select expo_token from push_device`)).rejects.toThrow(/permission denied/)
    await expect(as('app_supplier', 'store', (tx) => tx`select subject_id from push_device`, t.sellerA1First)).rejects.toThrow(/permission denied/)
    await expect(as('app_request', 'store', (tx) => tx`update push_device set last_seen_at = now()`)).rejects.toThrow(/permission denied/)
  })

  it('shows the merchant side only its own store’s riders', async () => {
    await withSystemScope(db.sql, (tx) => tx`insert into rider (store_id, name, phone) values (${t.storeB1}, 'Bea’s rider', '+919800000201')`)
    const stores = (await as('app_request', 'store', (tx) => tx<{ store_id: string }[]>`select distinct store_id from rider`)) as { store_id: string }[]
    expect(stores.map((s) => s.store_id)).toEqual([t.storeA1])
  })
})

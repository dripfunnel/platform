import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { adminSchema, type AdminContext } from '#apis/admin/schema'
import { platformSchema } from '#apis/platform/schema'
import { factsOf } from '#auth/activity'
import { isAssigned } from '#auth/assignment'
import type { PartnerCaller } from '#auth/partnerCaller'
import { secretBox, type SecretBox } from '#auth/secretBox'
import type { StaffMember, StaffRole } from '#auth/staff'
import type { MapsKeyCheck } from '#core/mapsKey'
import { handleMapFrame, mapFramePathFor, mapFrameStoreOf } from '#hooks/mapFrame'
import { activityLog } from '#saas/activity/index'
import { storeMapsKey } from '#saas/mapsKey/index'
import { createPartnerMapsService } from '#saas/partnerCredentials/index'
import { createPlatformMessagingService } from '#saas/platformMessaging/index'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #1612: a partner's own Google Maps key, DripFunnel's key, DripFunnel's two switches and the partner's choice, through both
// real schemas, the services and the database; and which key a store's maps use.

let db: TestDatabase
let box: SecretBox
const now = new Date('2026-11-19T09:00:00Z')
const staffByRole = new Map<StaffRole, StaffMember>()
let manager: StaffMember
const ids = { ns: '', kl: '', nsStore: '', klStore: '' }
const request = new Request('https://admin.dripfunnel.ai/api', { headers: { 'cf-ray': 'ray-test', 'cf-connecting-ip': '203.0.113.5', 'user-agent': 'test' } })
const facts = { requestId: 'r', ip: '203.0.113.9', userAgent: 'test' }

let verdict: MapsKeyCheck = { status: 'ok' }
const ourKey = `AIza${'a'.repeat(31)}OURS`
const ownKey = `AIza${'b'.repeat(31)}OWN1`
const otherKey = `AIza${'c'.repeat(31)}KL02`
const why = { reason: 'Launch for the pilot partners' }

const adminContext = (staff: StaffMember): AdminContext => ({
  staff,
  isAssigned: (staffId, target) => isAssigned(db.sql, staffId, target),
  staffActivity: null,
  partners: null,
  stores: null,
  provisioning: null,
  staffSessions: null,
  customers: null,
  staffMembers: null,
  dashboard: null,
  messaging: createPlatformMessagingService({
    sql: db.sql,
    staff,
    facts: factsOf(request),
    activity: activityLog,
    secrets: box,
    checkSms: async () => 'ok',
    checkWhatsApp: async () => ({ status: 'ok' }),
    checkMaps: async () => verdict,
    now: () => now,
  }),
})

const admin = async <T = Record<string, unknown>>(source: string, staff: StaffMember, variables: Record<string, unknown> = {}) => {
  const result = await graphql({ schema: adminSchema as GraphQLSchema, source, variableValues: variables, contextValue: adminContext(staff) })
  const error = result.errors?.[0]
  if (error && error.extensions['code'] === undefined) throw error
  return { data: (result.data ?? null) as T | null, code: error?.extensions['code'] as string | undefined, text: JSON.stringify(result) }
}

const callerOf = (partnerId: string): PartnerCaller => ({
  role: 'partner-owner',
  user: { id: crypto.randomUUID(), name: 'Maya Chen', email: 'maya@northstar.example' },
  staff: null,
  partner: { id: partnerId, name: 'Partner', product: 'Partner Shops', host: null, state: 'live' },
})

const partner = async <T = Record<string, unknown>>(source: string, partnerId: string, variables: Record<string, unknown> = {}) => {
  const caller = callerOf(partnerId)
  const maps = createPartnerMapsService({ sql: db.sql, caller, facts, activity: activityLog, secrets: box, checkMaps: async () => verdict, now: () => now })
  const result = await graphql({ schema: platformSchema as GraphQLSchema, source, variableValues: variables, contextValue: { caller, maps } })
  const error = result.errors?.[0]
  if (error && error.extensions['code'] === undefined) throw error
  return { data: (result.data ?? null) as T | null, code: error?.extensions['code'] as string | undefined, text: JSON.stringify(result) }
}

const as = (role: StaffRole): StaffMember => {
  const s = staffByRole.get(role)
  if (!s) throw new Error(`no seeded staff with role ${role}`)
  return s
}
const sa = () => as('staff-super-admin')

const readOurs = `{ platformMapsKey { enabled key { hint status lastTestedAt } } }`
const saveOurs = `mutation($key: String!, $reason: String!) { savePlatformMapsKey(key: $key, reason: $reason) { ok reason status problem } }`
const testOurs = `mutation { testPlatformMapsKey { ok reason status problem } }`
const onOurs = `mutation($enabled: Boolean!, $reason: String!) { setPlatformMapsEnabled(enabled: $enabled, reason: $reason) { ok reason } }`
const removeOurs = `mutation($reason: String!) { removePlatformMapsKey(reason: $reason) { ok reason } }`
const setSwitch = `mutation($partnerId: ID!, $channel: String!, $enabled: Boolean!, $reason: String!) { setPartnerDfMessaging(partnerId: $partnerId, channel: $channel, enabled: $enabled, reason: $reason) { sms whatsapp maps } }`
const readSwitch = `query($partnerId: ID!) { partnerDfMessaging(partnerId: $partnerId) { sms whatsapp maps } }`

const readOwn = `{ mapsKey { key { hint status } dripfunnel choice sender } }`
const saveOwn = `mutation($key: String!) { saveMapsKey(key: $key) { ok reason status problem } }`
const testOwn = `mutation { testMapsKey { ok reason status problem } }`
const removeOwn = `mutation { removeMapsKey { ok reason } }`
const choose = `mutation($account: String!) { setMapsChoice(account: $account) { ok reason } }`

const keyFor = (storeId: string) => storeMapsKey(db.sql, box)(storeId)
/** DripFunnel's key usable for Northstar: saved and Working, on, and switched on for the partner. */
const giveOurs = async (partnerId: string) => {
  verdict = { status: 'ok' }
  await admin(saveOurs, sa(), { key: ourKey, ...why })
  await admin(onOurs, sa(), { enabled: true, ...why })
  await admin(setSwitch, sa(), { partnerId, channel: 'maps', enabled: true, ...why })
}

beforeAll(async () => {
  db = await createTestDatabase()
  box = await secretBox(Buffer.alloc(32, 7).toString('base64'))
  await seed(db.url, now)
  for (const role of ['staff-support', 'staff-finance', 'staff-engineer', 'staff-read-only'] as const) {
    await db.sql`insert into staff_user (sso_subject, email, name, role_key, status) select ${`sso-${role}`}, ${`${role}@dripfunnel.example`}, ${role}, ${role}, 'active' where not exists (select 1 from staff_user where role_key = ${role})`
  }
  for (const r of await db.sql<{ id: string; email: string; name: string; role_key: StaffRole }[]>`select id, email, name, role_key from staff_user order by created_at`) {
    const member = { id: r.id, email: r.email, name: r.name, role: r.role_key }
    if (!staffByRole.has(r.role_key)) staffByRole.set(r.role_key, member)
    if (r.email === 'priya@softobotics.example') manager = member
  }
  for (const [key, name] of [['ns', 'Northstar Commerce'], ['kl', 'Kaufladen Digital']] as const) ids[key] = (await db.sql<{ id: string }[]>`select id from partner where name = ${name}`)[0]?.id ?? ''
  for (const key of ['ns', 'kl'] as const) ids[`${key}Store`] = (await db.sql<{ id: string }[]>`select id from store where partner_id = ${ids[key]} order by created_at limit 1`)[0]?.id ?? ''
}, 120_000)

beforeEach(async () => {
  verdict = { status: 'ok' }
  await db.sql`delete from platform_credential where kind = 'maps'`
  await db.sql`delete from partner_credential where kind = 'maps'`
  await db.sql`update platform_messaging set maps_enabled = false`
  await db.sql`update partner set df_maps_enabled = false, maps_account = null`
})

afterAll(async () => {
  await db.drop()
})

describe('DripFunnel’s key in the admin console', () => {
  it('saves it sealed, shows only “AIza…abcd”, tests it and removes it, and no entry carries the key', async () => {
    expect((await admin(readOurs, sa())).data).toEqual({ platformMapsKey: { enabled: false, key: null } })
    expect((await admin(saveOurs, sa(), { key: ourKey, ...why })).data?.['savePlatformMapsKey']).toEqual({ ok: true, reason: null, status: 'ok', problem: null })
    const shown = await admin(readOurs, as('staff-read-only'))
    expect(shown.data?.['platformMapsKey']).toMatchObject({ enabled: false, key: { hint: 'AIza…OURS', status: 'ok' } })
    expect(shown.text).not.toContain(ourKey)
    const [row] = await db.sql<{ key_enc: string; key_prefix: string }[]>`select key_enc, key_prefix from platform_credential where kind = 'maps' and provider = 'google'`
    expect(row?.key_enc.startsWith('v1.')).toBe(true)
    expect(JSON.stringify(row)).not.toContain(ourKey)
    expect((await admin(testOurs, sa())).data?.['testPlatformMapsKey']).toMatchObject({ ok: true, status: 'ok' })
    expect((await admin(removeOurs, sa(), why)).data?.['removePlatformMapsKey']).toEqual({ ok: true, reason: null })
    expect((await admin(readOurs, sa())).data).toEqual({ platformMapsKey: { enabled: false, key: null } })
    const entries = await db.sql`select * from activity_log where action like 'platform.maps_%'`
    expect(entries.map((e) => e['action']).sort()).toEqual(['platform.maps_key_removed', 'platform.maps_key_saved', 'platform.maps_key_tested'])
    expect(JSON.stringify(entries)).not.toContain(ourKey)
  })

  it('refuses a key that isn’t one, a missing reason, Google’s refusal and an unreachable Google, and keeps what was saved', async () => {
    expect((await admin(saveOurs, sa(), { key: 'AIza-too-short', ...why })).data?.['savePlatformMapsKey']).toMatchObject({ ok: false, reason: 'INVALID_INPUT' })
    expect((await admin(saveOurs, sa(), { key: ourKey, reason: '' })).data?.['savePlatformMapsKey']).toMatchObject({ ok: false, reason: 'INVALID_INPUT' })
    verdict = { status: 'rejected', problem: 'geocoding_disabled' }
    expect((await admin(saveOurs, sa(), { key: ourKey, ...why })).data?.['savePlatformMapsKey']).toEqual({ ok: false, reason: 'KEY_REJECTED', status: null, problem: 'geocoding_disabled' })
    verdict = { status: 'unavailable' }
    expect((await admin(saveOurs, sa(), { key: ourKey, ...why })).data?.['savePlatformMapsKey']).toMatchObject({ ok: false, reason: 'PROVIDER_UNAVAILABLE' })
    expect((await admin(readOurs, sa())).data).toEqual({ platformMapsKey: { enabled: false, key: null } })
    verdict = { status: 'ok' }
    await admin(saveOurs, sa(), { key: ourKey, ...why })
    verdict = { status: 'rejected', problem: 'invalid' }
    expect((await admin(saveOurs, sa(), { key: `AIza${'d'.repeat(31)}NEW0`, ...why })).data?.['savePlatformMapsKey']).toMatchObject({ ok: false, reason: 'KEY_REJECTED' })
    expect((await admin(readOurs, sa())).data?.['platformMapsKey']).toMatchObject({ key: { hint: 'AIza…OURS' } })
  })

  it('turns on only a Working key, and a rejected test or a removal turns it off again', async () => {
    expect((await admin(onOurs, sa(), { enabled: true, ...why })).data?.['setPlatformMapsEnabled']).toEqual({ ok: false, reason: 'NO_KEY' })
    await admin(saveOurs, sa(), { key: ourKey, ...why })
    expect((await admin(onOurs, sa(), { enabled: true, ...why })).data?.['setPlatformMapsEnabled']).toEqual({ ok: true, reason: null })
    verdict = { status: 'rejected', problem: 'restricted' }
    expect((await admin(testOurs, sa())).data?.['testPlatformMapsKey']).toEqual({ ok: true, reason: null, status: 'rejected', problem: 'restricted' })
    expect((await admin(readOurs, sa())).data?.['platformMapsKey']).toMatchObject({ enabled: false, key: { status: 'rejected' } })
    expect((await admin(onOurs, sa(), { enabled: true, ...why })).data?.['setPlatformMapsEnabled']).toEqual({ ok: false, reason: 'NO_KEY' })
    verdict = { status: 'ok' }
    await admin(testOurs, sa())
    await admin(onOurs, sa(), { enabled: true, ...why })
    expect((await admin(removeOurs, sa(), why)).data?.['removePlatformMapsKey']).toEqual({ ok: true, reason: null })
    expect((await admin(readOurs, sa())).data).toEqual({ platformMapsKey: { enabled: false, key: null } })
  })

  it('lets every staff role read it and only a Super admin change it', async () => {
    await admin(saveOurs, sa(), { key: ourKey, ...why })
    for (const role of ['staff-super-admin', 'staff-partner-manager', 'staff-support', 'staff-finance', 'staff-engineer', 'staff-read-only'] as const) {
      expect((await admin(readOurs, as(role))).data?.['platformMapsKey'], role).toMatchObject({ key: { hint: 'AIza…OURS' } })
    }
    const writes = [
      [saveOurs, { key: ourKey, ...why }],
      [testOurs, {}],
      [onOurs, { enabled: true, ...why }],
      [removeOurs, why],
    ] as const
    for (const role of ['staff-partner-manager', 'staff-support', 'staff-finance', 'staff-engineer', 'staff-read-only'] as const) {
      for (const [source, variables] of writes) expect((await admin(source, as(role), variables)).code, `${role} ${source.slice(0, 40)}`).toBe('FORBIDDEN')
    }
  })

  it('lets a Super admin and an assigned Partner manager switch it for a partner, refusing an unassigned one and every other role', async () => {
    expect((await admin(setSwitch, sa(), { partnerId: ids.ns, channel: 'maps', enabled: true, ...why })).data).toEqual({ setPartnerDfMessaging: { sms: false, whatsapp: false, maps: true } })
    expect((await admin(setSwitch, manager, { partnerId: ids.kl, channel: 'maps', enabled: true, ...why })).data).toEqual({ setPartnerDfMessaging: { sms: false, whatsapp: false, maps: true } })
    expect((await admin(setSwitch, manager, { partnerId: ids.ns, channel: 'maps', enabled: false, ...why })).code).toBe('FORBIDDEN')
    for (const role of ['staff-support', 'staff-finance', 'staff-engineer', 'staff-read-only'] as const) {
      expect((await admin(setSwitch, as(role), { partnerId: ids.ns, channel: 'maps', enabled: false, ...why })).code, role).toBe('FORBIDDEN')
    }
    expect((await admin(setSwitch, sa(), { partnerId: ids.ns, channel: 'maps', enabled: true, reason: '' })).code).toBe('INVALID_INPUT')
    expect((await admin(readSwitch, as('staff-support'), { partnerId: ids.ns })).data).toEqual({ partnerDfMessaging: { sms: false, whatsapp: false, maps: true } })
    const entries = await db.sql<{ action: string; reason: string | null; partner_id: string | null; visibility: string }[]>`select action, reason, partner_id, visibility from activity_log where action = 'partner.df_maps_enabled' order by occurred_at`
    expect(entries).toEqual([
      { action: 'partner.df_maps_enabled', reason: why.reason, partner_id: ids.ns, visibility: 'partner' },
      { action: 'partner.df_maps_enabled', reason: why.reason, partner_id: ids.kl, visibility: 'partner' },
    ])
  })
})

describe('a partner’s own key', () => {
  it('saves, tests, replaces and removes it, shown only as “AIza…abcd”, and every change is audited without the key', async () => {
    expect((await partner(readOwn, ids.ns)).data).toEqual({ mapsKey: { key: null, dripfunnel: false, choice: null, sender: null } })
    expect((await partner(saveOwn, ids.ns, { key: ownKey })).data?.['saveMapsKey']).toEqual({ ok: true, reason: null, status: 'ok', problem: null })
    const shown = await partner(readOwn, ids.ns)
    expect(shown.data?.['mapsKey']).toEqual({ key: { hint: 'AIza…OWN1', status: 'ok' }, dripfunnel: false, choice: null, sender: 'own' })
    expect(shown.text).not.toContain(ownKey)
    const [row] = await db.sql<{ key_enc: string }[]>`select key_enc from partner_credential where partner_id = ${ids.ns} and kind = 'maps'`
    expect(row?.key_enc.startsWith('v1.')).toBe(true)
    expect((await partner(saveOwn, ids.ns, { key: `AIza${'e'.repeat(31)}OWN2` })).data?.['saveMapsKey']).toMatchObject({ ok: true })
    expect((await partner(readOwn, ids.ns)).data?.['mapsKey']).toMatchObject({ key: { hint: 'AIza…OWN2' } })
    verdict = { status: 'rejected', problem: 'invalid' }
    expect((await partner(testOwn, ids.ns)).data?.['testMapsKey']).toEqual({ ok: true, reason: null, status: 'rejected', problem: 'invalid' })
    expect((await partner(readOwn, ids.ns)).data?.['mapsKey']).toMatchObject({ key: { status: 'rejected' }, sender: null })
    expect((await partner(removeOwn, ids.ns)).data?.['removeMapsKey']).toEqual({ ok: true, reason: null })
    expect((await partner(removeOwn, ids.ns)).data?.['removeMapsKey']).toEqual({ ok: false, reason: 'NOT_FOUND' })
    const entries = await db.sql<{ action: string }[]>`select action from activity_log where action like 'partner.maps_%' and partner_id = ${ids.ns} order by occurred_at`
    expect(entries.map((e) => e.action)).toEqual(['partner.maps_key_saved', 'partner.maps_key_saved', 'partner.maps_key_tested', 'partner.maps_key_removed'])
    expect(JSON.stringify(await db.sql`select * from activity_log where action like 'partner.maps_%'`)).not.toContain(ownKey)
  })

  it('refuses a key that isn’t one, Google’s refusal and an unreachable Google, and saves nothing', async () => {
    expect((await partner(saveOwn, ids.ns, { key: 'not-a-key' })).data?.['saveMapsKey']).toMatchObject({ ok: false, reason: 'INVALID_INPUT' })
    verdict = { status: 'rejected', problem: 'restricted' }
    expect((await partner(saveOwn, ids.ns, { key: ownKey })).data?.['saveMapsKey']).toEqual({ ok: false, reason: 'KEY_REJECTED', status: null, problem: 'restricted' })
    verdict = { status: 'unavailable' }
    expect((await partner(saveOwn, ids.ns, { key: ownKey })).data?.['saveMapsKey']).toMatchObject({ ok: false, reason: 'PROVIDER_UNAVAILABLE' })
    expect((await partner(readOwn, ids.ns)).data?.['mapsKey']).toMatchObject({ key: null })
  })

  it('may choose DripFunnel’s key only while it is usable for the partner, and never sees another partner’s key', async () => {
    await partner(saveOwn, ids.ns, { key: ownKey })
    expect((await partner(choose, ids.ns, { account: 'dripfunnel' })).data?.['setMapsChoice']).toEqual({ ok: false, reason: 'DRIPFUNNEL_UNAVAILABLE' })
    expect((await partner(choose, ids.ns, { account: 'other' })).data?.['setMapsChoice']).toEqual({ ok: false, reason: 'INVALID_INPUT' })
    await giveOurs(ids.ns)
    expect((await partner(readOwn, ids.ns)).data?.['mapsKey']).toMatchObject({ dripfunnel: true, choice: null, sender: 'own' })
    expect((await partner(choose, ids.ns, { account: 'dripfunnel' })).data?.['setMapsChoice']).toEqual({ ok: true, reason: null })
    expect((await partner(readOwn, ids.ns)).data?.['mapsKey']).toMatchObject({ choice: 'dripfunnel', sender: 'dripfunnel' })
    // Kaufladen was never let in, so it sees neither DripFunnel's key being usable nor Northstar's own.
    const other = await partner(readOwn, ids.kl)
    expect(other.data?.['mapsKey']).toEqual({ key: null, dripfunnel: false, choice: null, sender: null })
    expect((await partner(choose, ids.kl, { account: 'dripfunnel' })).data?.['setMapsChoice']).toEqual({ ok: false, reason: 'DRIPFUNNEL_UNAVAILABLE' })
    expect(other.text).not.toContain(ownKey)
    expect(other.text).not.toContain(ourKey)
  })
})

describe('which key a store’s maps use', () => {
  it('is none without a usable key, so no map is drawn', async () => {
    expect(await keyFor(ids.nsStore)).toBeNull()
    expect(await keyFor(crypto.randomUUID())).toBeNull()
    expect(await keyFor('not-an-id')).toBeNull()
    await admin(saveOurs, sa(), { key: ourKey, ...why })
    expect(await keyFor(ids.nsStore), 'saved but off').toBeNull()
    await admin(onOurs, sa(), { enabled: true, ...why })
    expect(await keyFor(ids.nsStore), 'on, but not for the partner').toBeNull()
  })

  it('is the partner’s own, DripFunnel’s where the partner is let in, and the partner’s choice while both are usable', async () => {
    await partner(saveOwn, ids.ns, { key: ownKey })
    expect(await keyFor(ids.nsStore)).toBe(ownKey)
    await giveOurs(ids.ns)
    expect(await keyFor(ids.nsStore), 'both, no choice').toBe(ownKey)
    await partner(choose, ids.ns, { account: 'dripfunnel' })
    expect(await keyFor(ids.nsStore), 'both, chose DripFunnel’s').toBe(ourKey)
    await admin(setSwitch, sa(), { partnerId: ids.ns, channel: 'maps', enabled: false, ...why })
    expect(await keyFor(ids.nsStore), 'Admin stopped it for the partner: its own').toBe(ownKey)
    await admin(setSwitch, sa(), { partnerId: ids.ns, channel: 'maps', enabled: true, ...why })
    await admin(onOurs, sa(), { enabled: false, ...why })
    expect(await keyFor(ids.nsStore), 'Super admin turned it off: its own').toBe(ownKey)
    await admin(onOurs, sa(), { enabled: true, ...why })
    await partner(removeOwn, ids.ns)
    expect(await keyFor(ids.nsStore), 'no own key: DripFunnel’s, though the choice was its own default').toBe(ourKey)
  })

  it('falls to the other key when the chosen one is rejected, and never uses another partner’s key', async () => {
    await partner(saveOwn, ids.ns, { key: ownKey })
    await giveOurs(ids.ns)
    await partner(choose, ids.ns, { account: 'own' })
    verdict = { status: 'rejected', problem: 'invalid' }
    await partner(testOwn, ids.ns)
    expect(await keyFor(ids.nsStore), 'own rejected').toBe(ourKey)
    verdict = { status: 'ok' }
    await partner(saveOwn, ids.kl, { key: otherKey })
    expect(await keyFor(ids.klStore), 'Kaufladen’s own').toBe(otherKey)
    expect(await keyFor(ids.nsStore), 'Northstar never gets Kaufladen’s').toBe(ourKey)
    await admin(setSwitch, sa(), { partnerId: ids.ns, channel: 'maps', enabled: false, ...why })
    expect(await keyFor(ids.nsStore), 'Northstar: rejected own and no DripFunnel').toBeNull()
  })
})

describe('the frame', () => {
  const frame = (storeId: string, key: string | null) => handleMapFrame(new Request(`https://hooks.dripfunnel.ai${mapFramePathFor(storeId)}`), mapFramePathFor(storeId), { key, local: false })

  it('names the store in its address and answers 404 for a store with no usable key', async () => {
    expect(mapFrameStoreOf(mapFramePathFor(ids.nsStore))).toBe(ids.nsStore)
    await partner(saveOwn, ids.ns, { key: ownKey })
    const page = frame(ids.nsStore, await keyFor(ids.nsStore))
    expect(page.status).toBe(200)
    expect(await page.text()).toContain(`data-key="${ownKey}"`)
    const none = frame(ids.klStore, await keyFor(ids.klStore))
    expect(none.status).toBe(404)
    expect(await none.text()).not.toContain(ownKey)
  })
})

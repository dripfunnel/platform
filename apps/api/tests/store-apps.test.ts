import { createHmac } from 'node:crypto'
import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminSchema, type AdminContext } from '#apis/admin/schema'
import { isAssigned } from '#auth/assignment'
import { secretBox, type SecretBox } from '#auth/secretBox'
import type { StaffMember } from '#auth/staff'
import { appNoticeDeliverer } from '#jobs/queues/deliverers/appNotice'
import { defaultRelayOptions, relayDue } from '#jobs/queues/outbox-relay'
import { withScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import { appNoticeKind, createAppRegistryService } from '#saas/apps/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'
import { fakeEndpoint, fakeLookup, seedStoreWorld, type StoreWorld, type Who } from './support/storeWorld'

// Card #330 (SAPI 20), part 2: private apps (PLATFORM-PROMPT §5.5, ACCESS §5.6): staff register one, an Owner installs it
// with consent to its scopes, the app is told its token at its own address, and the token calls the Store API store-wide.

let db: TestDatabase
let t: Tenants
let w: StoreWorld
let secrets: SecretBox
const now = () => new Date(Date.now() + 1000)
const portal = 'store.partner-a.example'
const dns = new Map<string, string[]>([
  ['A ledger.example', ['93.184.216.50']],
  ['A inside.example', ['192.168.1.4']],
])
let appAnswers = 200
const app = fakeEndpoint(() => appAnswers)
const staff: Record<'superAdmin' | 'support', StaffMember> = {
  superAdmin: { id: '', email: 'sa@dripfunnel.com', name: 'Sara', role: 'staff-super-admin' } as StaffMember,
  support: { id: '', email: 'su@dripfunnel.com', name: 'Suki', role: 'staff-support' } as StaffMember,
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  secrets = await secretBox(btoa('k'.repeat(32)))
  w = await seedStoreWorld(db.sql, t, { now, secrets, lookup: fakeLookup(dns) })
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerA}, 'portal', ${portal}, 'live', 'CNAME', 'x')`
  for (const s of Object.values(staff)) {
    const [row] = await db.sql<{ id: string }[]>`insert into staff_user (email, name, role_key, status) values (${s.email}, ${s.name}, ${s.role}, 'active') returning id`
    s.id = row?.id ?? ''
  }
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const admin = async (who: keyof typeof staff, source: string, variables: Record<string, unknown> = {}) => {
  const s = staff[who]
  const contextValue: AdminContext = {
    staff: s,
    isAssigned: (staffId, target) => isAssigned(db.sql, staffId, target),
    staffActivity: null,
    partners: null,
    stores: null,
    provisioning: null,
    staffSessions: null,
    customers: null,
    staffMembers: null,
    dashboard: null,
    apps: createAppRegistryService({ sql: db.sql, staff: s, activity: activityLog, facts: { requestId: 'r', ip: null, userAgent: null }, secrets, lookup: fakeLookup(dns), now }),
  }
  const result = await graphql({ schema: adminSchema as GraphQLSchema, source, contextValue, variableValues: variables })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}
const register = async (name: string, scopes: string[], webhookUrl = 'https://ledger.example/hooks') => {
  const r = await admin('superAdmin', 'mutation R($name: String!, $scopes: [String!]!, $hook: String!) { registerApp(name: $name, developer: "Tally Bridges", siteUrl: "https://ledger.example", webhookUrl: $hook, scopes: $scopes) { id secret } }', { name, scopes, hook: webhookUrl })
  return { app: r.data?.['registerApp'] as { id: string; secret: string } | undefined, code: r.code }
}
const install = async (who: Who, appId: string, scopes: string[]) => {
  const r = await w.gql(who, 'mutation I($id: ID!, $scopes: [String!]!) { installApp(appId: $id, scopes: $scopes) }', { id: appId, scopes })
  return { grant: r.data?.['installApp'] as string | undefined, code: r.code }
}
const installed = async (who: Who) => {
  const r = await w.gql(who, '{ apps { nodes { id appId name developer siteUrl scopes suspended installedByName lastUsedAt connection } } }')
  return { list: (r.data?.['apps'] as { nodes: { id: string; appId: string; name: string; scopes: string[]; suspended: boolean; installedByName: string | null; lastUsedAt: string | null; connection: string }[] } | null)?.nodes, code: r.code }
}
const relay = (clock: () => Date = now) => relayDue(db.sql, { [appNoticeKind]: appNoticeDeliverer(db.sql, { lookup: fakeLookup(dns), secrets, fetchImpl: app.fetchImpl, now: clock }) }, { ...defaultRelayOptions, now: clock })
const products = (token: string, partnerId = t.partnerA) => w.bearer(token, '{ products { nodes { name } } }', partnerId)

describe('The registry', () => {
  it('is Super admins’ alone, checks the app’s addresses, and shows its secret once', async () => {
    expect((await admin('support', '{ registeredApps { items { id } } }')).code).toBe('FORBIDDEN')
    expect((await admin('support', 'mutation { registerApp(name: "x", developer: "y", siteUrl: "https://ledger.example", webhookUrl: "https://ledger.example/h", scopes: ["catalog.read"]) { id } }')).code).toBe('FORBIDDEN')
    expect((await register('Bad scope', ['settings'])).code).toBe('INVALID_SCOPES')
    expect((await register('Inside', ['catalog.read'], 'https://inside.example/h')).code).toBe('PRIVATE_ADDRESS')
    expect((await register('Plain', ['catalog.read'], 'http://ledger.example/h')).code).toBe('BAD_URL')
    const { app: made, code } = await register('Ledger Sync', ['catalog.read', 'orders.read'])
    expect(code).toBeUndefined()
    expect(made?.secret).toMatch(/^whsec_/)
    const listed = (await admin('superAdmin', '{ registeredApps { items { id name scopes status } } }')).data?.['registeredApps'] as { items: { id: string; name: string; scopes: string[]; status: string }[] }
    expect(listed.items.find((a) => a.id === made?.id)).toEqual({ id: made?.id, name: 'Ledger Sync', scopes: ['catalog.read', 'orders.read'], status: 'live' })
    expect(JSON.stringify(listed)).not.toContain(made?.secret ?? 'x')
    expect(await db.sql`select 1 from activity_log where action = 'app.registered' and target_id = ${made?.id ?? ''} and actor_id = ${staff.superAdmin.id} and visibility = 'staff'`).toHaveLength(1)
  })
})

describe('Installing', () => {
  it('shows a live app for consent, installs it once with exactly the scopes shown, and tells the app its token, signed', async () => {
    const { app: made } = await register('Feeds', ['catalog.read'])
    const appId = made?.id ?? ''
    const shown = await w.gql('owner', 'query A($id: ID!) { installableApp(id: $id) { name developer siteUrl scopes } }', { id: appId })
    expect(shown.data?.['installableApp']).toEqual({ name: 'Feeds', developer: 'Tally Bridges', siteUrl: 'https://ledger.example/', scopes: ['catalog.read'] })
    expect((await install('owner', appId, ['catalog.read', 'orders.read'])).code).toBe('SCOPES_CHANGED')
    const raced = await Promise.all([install('owner', appId, ['catalog.read']), install('owner', appId, ['catalog.read'])])
    expect(raced.filter((r) => r.grant).length).toBe(1)
    expect(raced.filter((r) => r.code === 'ALREADY_INSTALLED').length).toBe(1)
    const grant = raced.find((r) => r.grant)?.grant ?? ''
    expect((await installed('owner')).list?.find((g) => g.id === grant)).toMatchObject({ appId, name: 'Feeds', scopes: ['catalog.read'], suspended: false, installedByName: 'Olivia' })

    await relay()
    const told = app.sent.find((s) => s.headers['dripfunnel-event'] === 'app.installed' && JSON.parse(s.body).grant === grant)
    expect(told?.url).toBe('https://ledger.example/hooks')
    const body = JSON.parse(told?.body ?? '{}') as { token: string; api: string; store: { id: string } }
    expect(body).toMatchObject({ api: `https://${portal}/api`, store: { id: t.storeA1 } })
    expect(body.token).toMatch(/^dfa_[0-9A-Za-z]{48}$/)
    const [sigT, sigV] = (told?.headers['dripfunnel-signature'] ?? '').split(',').map((p) => p.split('=')[1] ?? '')
    expect(sigV).toBe(createHmac('sha256', made?.secret ?? '').update(`${sigT}.${told?.body ?? ''}`).digest('hex'))
    // Once sent, the token is gone from the outbox row, and only its hash is kept.
    const [row] = await db.sql<{ payload: Record<string, unknown> }[]>`select payload from outbox where kind = ${appNoticeKind} and payload->>'grantId' = ${grant ?? ''}`
    expect(row?.payload).toEqual({ grantId: grant, notice: 'installed' })
    expect((await installed('owner')).list?.find((g) => g.id === grant)).toMatchObject({ connection: 'sent' })
    expect(await db.sql`select 1 from app_grant where id = ${grant} and token_hash = encode(sha256(convert_to(${body.token}, 'UTF8')), 'hex')`).toHaveLength(1)

    // The token reads the store, store-wide (a supplier's product too), within its scopes.
    await w.gql('supplier', 'mutation S($input: ProductInput!) { saveProduct(input: $input) { id } }', { input: { name: 'Supplier tote', options: [], versions: [{ choices: [], prices: [{ currency: 'INR', amount: '100' }] }] } })
    const read = await products(body.token)
    expect(read.code).toBeUndefined()
    expect((read.data?.['products'] as { nodes: { name: string }[] }).nodes.map((n) => n.name)).toContain('Supplier tote')
    expect((await w.bearer(body.token, '{ orders { nodes { id } } }', t.partnerA)).code).toBe('FORBIDDEN')
    expect((await w.bearer(body.token, '{ apps { nodes { id } } }', t.partnerA)).code).toBe('FORBIDDEN')
    expect((await products(body.token, t.partnerB)).code).toBe('UNAUTHENTICATED')
    expect((await installed('owner')).list?.find((g) => g.id === grant)?.lastUsedAt).not.toBeNull()

    // Suspended by DripFunnel, it stops; live again, it works.
    expect((await admin('superAdmin', 'mutation S($id: ID!) { setAppStatus(id: $id, suspended: true) }', { id: appId })).code).toBeUndefined()
    expect((await products(body.token)).code).toBe('UNAUTHENTICATED')
    expect((await w.gql('owner', 'query A($id: ID!) { installableApp(id: $id) { name } }', { id: appId })).data?.['installableApp']).toBeNull()
    // The Owner still sees it, paused; a store holding no grant of it reads nothing of it.
    expect((await installed('owner')).list?.find((g) => g.id === grant)).toMatchObject({ name: 'Feeds', suspended: true })
    const appRows = (who: Who) =>
      withScope(db.sql, { caller: { kind: 'person', userId: w.people[who], sessionId: 's' }, partnerId: w.partnerOf(who), storeId: w.storeOf(who), sellerScope: { kind: 'all' }, subscription: 'active' }, (tx) => tx`select id from app where id = ${appId}`)
    expect(await appRows('owner')).toHaveLength(1)
    expect(await appRows('a2Owner')).toHaveLength(0)
    expect(await appRows('bOwner')).toHaveLength(0)
    await admin('superAdmin', 'mutation S($id: ID!) { setAppStatus(id: $id, suspended: false) }', { id: appId })
    expect((await products(body.token)).code).toBeUndefined()

    // Removed: its access ends at once, and the app hears so.
    expect((await w.gql('owner', 'mutation U($id: ID!) { uninstallApp(id: $id) }', { id: grant })).code).toBeUndefined()
    expect((await products(body.token)).code).toBe('UNAUTHENTICATED')
    await relay()
    expect(app.sent.some((s) => s.headers['dripfunnel-event'] === 'app.uninstalled' && JSON.parse(s.body).grant === grant && !('token' in JSON.parse(s.body)))).toBe(true)
    const actions = await db.sql<{ action: string }[]>`select action from activity_log where target_id = ${grant} order by occurred_at`
    expect(actions.map((a) => a.action)).toEqual(['app.installed', 'app.uninstalled'])
  })

  it('is the Owner’s alone, and another store neither sees nor removes the install', async () => {
    const { app: made } = await register('Private', ['catalog.read'])
    const { grant } = await install('owner', made?.id ?? '', ['catalog.read'])
    for (const who of ['manager', 'staff', 'supplier'] as const) {
      expect((await installed(who)).code, who).toBe('FORBIDDEN')
      expect((await install(who, made?.id ?? '', ['catalog.read'])).code, who).toBe('FORBIDDEN')
      expect((await w.gql(who, 'mutation U($id: ID!) { uninstallApp(id: $id) }', { id: grant })).code, who).toBe('FORBIDDEN')
    }
    for (const who of ['a2Owner', 'bOwner'] as const) {
      expect((await installed(who)).list?.map((g) => g.id), who).not.toContain(grant)
      expect((await w.gql(who, 'mutation U($id: ID!) { uninstallApp(id: $id) }', { id: grant })).code, who).toBe('NOT_FOUND')
    }
    // Another store installs the same app on its own grant.
    expect((await install('a2Owner', made?.id ?? '', ['catalog.read'])).code).toBeUndefined()
  })

  it('holds an install’s notice while the app is suspended and sends it once restored; one for a grant since removed goes nowhere', async () => {
    const { app: made } = await register('Held notice', ['catalog.read'])
    const { grant } = await install('owner', made?.id ?? '', ['catalog.read'])
    await admin('superAdmin', 'mutation S($id: ID!) { setAppStatus(id: $id, suspended: true) }', { id: made?.id })
    const sent = () => app.sent.filter((s) => JSON.parse(s.body).grant === grant)
    await relay()
    expect(sent()).toHaveLength(0)
    const row = async () => (await db.sql<{ attempts: number; delivered_at: Date | null; failed_at: Date | null; last_error: string | null }[]>`select attempts, delivered_at, failed_at, last_error from outbox where kind = ${appNoticeKind} and payload->>'grantId' = ${grant ?? ''} and payload->>'notice' = 'installed'`)[0]
    expect(await row()).toMatchObject({ attempts: 0, delivered_at: null, failed_at: null, last_error: 'app_suspended' })
    await admin('superAdmin', 'mutation S($id: ID!) { setAppStatus(id: $id, suspended: false) }', { id: made?.id })
    await db.sql`update outbox set next_attempt_at = now() - interval '1 second' where kind = ${appNoticeKind} and payload->>'grantId' = ${grant ?? ''}`
    await relay()
    expect(sent().map((s) => s.headers['dripfunnel-event'])).toEqual(['app.installed'])

    const { app: other } = await register('Gone before told', ['catalog.read'])
    const { grant: removed } = await install('owner', other?.id ?? '', ['catalog.read'])
    await w.gql('owner', 'mutation U($id: ID!) { uninstallApp(id: $id) }', { id: removed })
    await relay()
    const notices = await db.sql<{ notice: string; failed: boolean; last_error: string | null }[]>`select payload->>'notice' as notice, failed_at is not null as failed, last_error from outbox where kind = ${appNoticeKind} and payload->>'grantId' = ${removed ?? ''} order by created_at`
    expect(notices).toEqual([{ notice: 'installed', failed: true, last_error: 'grant_revoked' }, { notice: 'uninstalled', failed: false, last_error: null }])
    expect(app.sent.filter((s) => JSON.parse(s.body).grant === removed).map((s) => s.headers['dripfunnel-event'])).toEqual(['app.uninstalled'])
  })

  it('says an install never reached its app once the relay gives up, so the Owner can install it again', async () => {
    const { app: made } = await register('Unreachable', ['catalog.read'])
    const { grant } = await install('owner', made?.id ?? '', ['catalog.read'])
    expect((await installed('owner')).list?.find((g) => g.id === grant)).toMatchObject({ connection: 'waiting' })
    appAnswers = 500
    try {
      let clock = now()
      for (let i = 0; i < defaultRelayOptions.maxAttempts + 1; i++) {
        await relay(() => clock)
        clock = new Date(clock.getTime() + defaultRelayOptions.maxDelayMs + 1000)
      }
    } finally {
      appAnswers = 200
    }
    const [row] = await db.sql<{ payload: Record<string, unknown>; failed: boolean }[]>`select payload, failed_at is not null as failed from outbox where kind = ${appNoticeKind} and payload->>'grantId' = ${grant ?? ''}`
    expect(row).toEqual({ payload: { grantId: grant, notice: 'installed' }, failed: true })
    expect((await installed('owner')).list?.find((g) => g.id === grant)).toMatchObject({ connection: 'failed' })
    expect((await w.gql('owner', 'mutation U($id: ID!) { uninstallApp(id: $id) }', { id: grant })).code).toBeUndefined()
    expect((await install('owner', made?.id ?? '', ['catalog.read'])).code).toBeUndefined()
  })

  it('lets the Owner remove an app DripFunnel has suspended', async () => {
    const { app: made } = await register('Paused', ['catalog.read'])
    const { grant } = await install('owner', made?.id ?? '', ['catalog.read'])
    await admin('superAdmin', 'mutation S($id: ID!) { setAppStatus(id: $id, suspended: true) }', { id: made?.id })
    expect((await w.gql('owner', 'mutation U($id: ID!) { uninstallApp(id: $id) }', { id: grant })).code).toBeUndefined()
    expect((await installed('owner')).list?.map((g) => g.id)).not.toContain(grant)
    // Uninstalled, the suspended app is no longer the store's to read.
    expect((await w.gql('owner', 'query A($id: ID!) { installableApp(id: $id) { name } }', { id: made?.id })).data?.['installableApp']).toBeNull()
  })
})

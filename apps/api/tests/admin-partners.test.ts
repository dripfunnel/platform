import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminSchema, type AdminContext } from '#apis/admin/schema'
import { factsOf } from '#auth/activity'
import { isAssigned } from '#auth/assignment'
import type { StaffMember, StaffRole } from '#auth/staff'
import type { DnsLookup } from '#integrations/dns/doh'
import { domainRecheckDeliverer } from '#jobs/queues/deliverers/domainRecheck'
import { emailRecords } from '#saas/domains/index'
import { defaultRelayOptions, relayDue } from '#jobs/queues/outbox-relay'
import { activityLog, listActivity } from '#saas/activity/index'
import { createPartnersService, partnerAudit } from '#saas/partners/index'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #33 through the real schema: declarations, the policy, the service and the database.

let db: TestDatabase
const now = new Date('2026-10-02T12:00:00Z')
const staffByRole = new Map<StaffRole, StaffMember>()
let secondPm: StaffMember

const request = new Request('https://admin.dripfunnel.com/api', { headers: { 'cf-ray': 'ray-test', 'cf-connecting-ip': '203.0.113.5', 'user-agent': 'test' } })

const contextFor = (staff: StaffMember | null, reauthFresh = true): AdminContext => {
  const assigned = (staffId: string, target: Parameters<typeof isAssigned>[2]) => isAssigned(db.sql, staffId, target)
  return {
    staff,
    isAssigned: assigned,
    activity: async (filter, page) => listActivity(db.sql, { caller: { kind: 'staff', staffId: staff?.id ?? '' } }, filter, page),
    partners: staff ? createPartnersService({ sql: db.sql, staff, reauthFresh, facts: factsOf(request), activity: activityLog, isAssigned: assigned, now: () => now }) : null,
    stores: null,
    provisioning: null,
    staffMembers: null,
    dashboard: null,
  }
}

const run = async <T = Record<string, unknown>>(source: string, staff: StaffMember | null, variables: Record<string, unknown> = {}, reauthFresh = true): Promise<{ data: T | null; code: string | undefined }> => {
  const result = await graphql({ schema: adminSchema as GraphQLSchema, source, variableValues: variables, contextValue: contextFor(staff, reauthFresh) })
  const error = result.errors?.[0]
  // An error without a stable code is a bug, not an outcome: fail loudly with its words.
  if (error && error.extensions['code'] === undefined) throw error
  return { data: (result.data ?? null) as T | null, code: error?.extensions['code'] as string | undefined }
}

const as = (role: StaffRole): StaffMember => {
  const s = staffByRole.get(role)
  if (!s) throw new Error(`no seeded staff with role ${role}`)
  return s
}

const partnerIdOf = async (name: string): Promise<string> => {
  const [row] = await db.sql<{ id: string }[]>`select id from partner where name = ${name}`
  if (!row) throw new Error(`partner ${name} missing`)
  return row.id
}

const entriesFor = async (partnerId: string, action: string) =>
  db.sql<{ actor_label: string; reason: string | null; visibility: string }[]>`
    select actor_label, reason, visibility from activity_log where partner_id = ${partnerId} and action = ${action} order by occurred_at
  `

beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db.url, now)
  const rows = await db.sql<{ id: string; email: string; name: string; role_key: StaffRole }[]>`select id, email, name, role_key from staff_user order by created_at`
  for (const r of rows) {
    const member = { id: r.id, email: r.email, name: r.name, role: r.role_key }
    if (!staffByRole.has(r.role_key)) staffByRole.set(r.role_key, member)
    if (r.role_key === 'staff-partner-manager' && staffByRole.get(r.role_key)?.id !== r.id) secondPm = member
  }
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

const outcome = `ok code failingChecks state id approvals`

describe('declarations', () => {
  it('every partner mutation declares the action the service records', () => {
    const recorded = new Set<string>(Object.values(partnerAudit))
    const mutations = adminSchema.getMutationType()?.getFields() ?? {}
    const names = ['createPartner', 'approvePartner', 'sendBackPartner', 'pausePartner', 'resumePartner', 'sendPartnerOwnerInvite', 'resendPartnerOwnerInvite', 'startPartnerSetupSession', 'endStaffSession', 'recheckDomain', 'assignPartnerManager', 'unassignPartnerManager']
    for (const name of names) {
      const audit = mutations[name]?.extensions.access?.audit
      expect([name, audit !== undefined && recorded.has(audit)]).toEqual([name, true])
    }
  })
})

describe('partners(filter, after, before) (§4.1, §6)', () => {
  const list = `query($filter: PartnerFilter, $after: String, $first: Int) { partners(filter: $filter, after: $after, first: $first) {
    items { id name state stores portalHost { host status } setup { done total } owner { name email invitation } submittedAt checks { portalHost emailDomain pricedPlan legalPages testSignup } approval { setUpBy rule approvals } }
    pageInfo { hasNextPage endCursor } create { allowed reason } } }`

  interface Page {
    partners: { items: Record<string, unknown>[]; pageInfo: { hasNextPage: boolean; endCursor: string | null }; create: { allowed: boolean; reason: string | null } }
  }

  it('serves the columns, newest first, capped and paged by cursor', async () => {
    const first = await run<Page>(list, as('staff-super-admin'), { first: 4 })
    expect(first.code).toBeUndefined()
    expect(first.data?.partners.items).toHaveLength(4)
    expect(first.data?.partners.pageInfo.hasNextPage).toBe(true)
    const second = await run<Page>(list, as('staff-super-admin'), { first: 4, after: first.data?.partners.pageInfo.endCursor })
    const ids = [...(first.data?.partners.items ?? []), ...(second.data?.partners.items ?? [])].map((i) => i['id'])
    expect(new Set(ids).size).toBe(ids.length)
    const capped = await run<Page>(list, as('staff-super-admin'), { first: 500 })
    expect(capped.data?.partners.items.length).toBeLessThanOrEqual(25)
    const kaufladen = capped.data?.partners.items.find((i) => i['name'] === 'Kaufladen Digital')
    expect(kaufladen).toMatchObject({ state: 'awaiting', stores: 1, portalHost: { host: 'shop.kaufladen.example', status: 'live' }, setup: { done: 8, total: 10 }, owner: { invitation: 'active' } })
    expect(kaufladen?.['checks']).toEqual({ portalHost: true, emailDomain: true, pricedPlan: true, legalPages: true, testSignup: true })
    expect(kaufladen?.['approval']).toEqual({ setUpBy: 'Priya Shah', rule: 'second', approvals: 0 })
  })

  it('Approvals is the list filtered to awaiting, oldest submitted first, and the create button is the API answer', async () => {
    const queue = await run<Page>(list, as('staff-partner-manager'), { filter: { state: 'awaiting', sort: 'oldestSubmitted' } })
    expect(queue.data?.partners.items.map((i) => i['name'])).toEqual(['Kaufladen Digital'])
    expect(queue.data?.partners.create).toEqual({ allowed: true, reason: null })
    const support = await run<Page>(list, as('staff-support'), {})
    expect(support.data?.partners.create).toEqual({ allowed: false, reason: 'PARTNER_ADMINS_ONLY' })
  })

  it('refuses a bad filter with a code and a signed-out caller with UNAUTHENTICATED', async () => {
    expect((await run(list, as('staff-super-admin'), { filter: { state: 'bogus' } })).code).toBe('INVALID_INPUT')
    expect((await run(list, null)).code).toBe('UNAUTHENTICATED')
  })
})

describe('partner(id) (§4.2, §4.3)', () => {
  const detail = `query($id: ID!) { partner(id: $id) {
    name state country contacts { name role email } history { action by note } checklist { item status by { name org } }
    branding { productName poweredBy } domains { kind status record expected found } plans { name status stores } team { name role status }
    setupSessions { staff reason } actions { approve { allowed reason failingChecks } sendBack { allowed reason } pause { allowed reason } resume { allowed reason } setupSession { allowed reason } sendInvite { allowed reason } resendInvite { allowed reason } } } }`

  interface Detail {
    partner: Record<string, unknown> & { actions: Record<string, { allowed: boolean; reason: string | null; failingChecks?: string[] | null } | null> }
  }

  it('serves the seven tabs from real rows', async () => {
    const id = await partnerIdOf('Kaufladen Digital')
    const { data } = await run<Detail>(detail, as('staff-super-admin'), { id })
    const p = data?.partner
    expect(p).toMatchObject({ name: 'Kaufladen Digital', country: 'DE', branding: { productName: 'Kaufladen Shops', poweredBy: 'on' } })
    expect((p?.['contacts'] as unknown[]).length).toBe(2)
    expect((p?.['history'] as { action: string }[]).map((h) => h.action)).toEqual(['partner.created', 'partner.set_up', 'partner.submitted', 'partner.sent_back', 'partner.submitted'])
    expect((p?.['checklist'] as unknown[]).length).toBe(10)
    expect((p?.['domains'] as { kind: string; status: string }[]).find((d) => d.kind === 'email')).toMatchObject({ status: 'waiting', record: 'TXT' })
    expect((p?.['plans'] as { name: string; stores: number }[]).find((x) => x.name === 'Plus')?.stores).toBe(1)
    expect((p?.['team'] as unknown[]).length).toBe(2)
  })

  it('the permission block depends on the role and the record', async () => {
    const kaufladen = await partnerIdOf('Kaufladen Digital')
    const house = await partnerIdOf('DripFunnel')
    const paused = await partnerIdOf('Southwind Retail')
    const tallis = await partnerIdOf('Tallis Studio')
    const nordlicht = await partnerIdOf('Nordlicht Media')

    const sa = (await run<Detail>(detail, as('staff-super-admin'), { id: kaufladen })).data?.partner.actions
    expect(sa?.['approve']).toEqual({ allowed: true, reason: null, failingChecks: null })
    expect(sa?.['sendBack']).toEqual({ allowed: true, reason: null })
    expect(sa?.['setupSession']).toEqual({ allowed: true, reason: null })
    expect(sa?.['pause']).toBeNull()

    // Priya set Kaufladen up, so she may not approve it; another Partner manager may record the first approval.
    const priya = (await run<Detail>(detail, as('staff-partner-manager'), { id: kaufladen })).data?.partner.actions
    expect(priya?.['approve']).toEqual({ allowed: false, reason: 'SET_UP_BY_CALLER', failingChecks: null })

    const support = (await run<Detail>(detail, as('staff-support'), { id: kaufladen })).data?.partner.actions
    expect(support?.['approve']).toEqual({ allowed: false, reason: 'PARTNER_ADMINS_ONLY', failingChecks: null })
    expect(support?.['setupSession']).toBeNull()

    expect((await run<Detail>(detail, as('staff-super-admin'), { id: house })).data?.partner.actions['pause']).toEqual({ allowed: false, reason: 'HOUSE_PARTNER' })
    expect((await run<Detail>(detail, as('staff-engineer'), { id: paused })).data?.partner.actions['resume']).toEqual({ allowed: false, reason: 'SUPER_ADMIN_ONLY' })
    expect((await run<Detail>(detail, as('staff-super-admin'), { id: tallis })).data?.partner.actions['resendInvite']).toEqual({ allowed: true, reason: null })
    expect((await run<Detail>(detail, as('staff-read-only'), { id: nordlicht })).data?.partner.actions['sendInvite']).toEqual({ allowed: false, reason: 'PARTNER_ADMINS_ONLY' })
    expect((await run<Detail>(detail, as('staff-support'), { id: nordlicht })).data?.partner.actions['sendInvite']).toEqual({ allowed: false, reason: 'PARTNER_ADMINS_ONLY' })
    expect((await run<Detail>(detail, as('staff-support'), { id: tallis })).data?.partner.actions['resendInvite']).toEqual({ allowed: true, reason: null })
  })

  it('a Partner manager reads only the partners assigned to them, in the list as well (#14, #60)', async () => {
    // Priya is assigned to Kaufladen, Nordlicht and Tallis; Northstar is Maya's.
    const northstar = await partnerIdOf('Northstar Commerce')
    expect((await run(detail, as('staff-partner-manager'), { id: northstar })).code).toBe('FORBIDDEN')
    expect((await run(detail, as('staff-partner-manager'), { id: await partnerIdOf('Kaufladen Digital') })).code).toBeUndefined()
    const mine = await run<{ partners: { items: { name: string }[] } }>(`{ partners { items { name } } }`, as('staff-partner-manager'))
    expect(mine.data?.partners.items.map((i) => i.name).sort()).toEqual(['Kaufladen Digital', 'Nordlicht Media', 'Tallis Studio'])
  })

  it('setup sessions are read by the roles that may see them, with what each may do; others read null', async () => {
    const kaufladen = await partnerIdOf('Kaufladen Digital')
    const q = `query($id: ID!) { partner(id: $id) { setupSessions { staff status end { allowed reason } } } }`
    type Sessions = { partner: { setupSessions: { staff: string; status: string; end: { allowed: boolean; reason: string | null } }[] | null } }
    const sa = await run<Sessions>(q, as('staff-super-admin'), { id: kaufladen })
    expect(sa.data?.partner.setupSessions).toEqual([{ staff: 'Priya Shah', status: 'ended', end: { allowed: false, reason: 'SESSION_ENDED' } }])
    expect((await run<Sessions>(q, as('staff-engineer'), { id: kaufladen })).data?.partner.setupSessions).toBeNull()
    expect((await run<Sessions>(q, as('staff-read-only'), { id: kaufladen })).data?.partner.setupSessions).toBeNull()
  })
})

describe('approval (§4.3, two staff unless a Super admin counts for both)', () => {
  const approve = `mutation($id: ID!, $reason: String!) { approvePartner(id: $id, reason: $reason) { ${outcome} } }`
  interface Approved {
    approvePartner: { ok: boolean; code: string | null; state: string | null; approvals: number | null; failingChecks: string[] | null }
  }

  it('refuses an empty reason, the wrong state, failing checks, the setter, and a repeat', async () => {
    const kaufladen = await partnerIdOf('Kaufladen Digital')
    expect((await run<Approved>(approve, as('staff-super-admin'), { id: kaufladen, reason: '  ' })).data?.approvePartner).toMatchObject({ ok: false, code: 'REASON_REQUIRED' })
    expect((await run<Approved>(approve, as('staff-super-admin'), { id: await partnerIdOf('Northstar Commerce'), reason: 'x' })).data?.approvePartner).toMatchObject({ ok: false, code: 'INVALID_STATE' })
    expect((await run<Approved>(approve, as('staff-partner-manager'), { id: kaufladen, reason: 'Looks good' })).data?.approvePartner).toMatchObject({ ok: false, code: 'SET_UP_BY_CALLER' })
    expect((await run(approve, as('staff-support'), { id: kaufladen, reason: 'x' })).code).toBe('FORBIDDEN')

    // Tallis: submitted by itself with every check failing.
    await db.sql`update partner set state = 'awaiting', submitted_at = ${now}, submitted_by_kind = 'partner_user', submitted_by_label = 'Ben Tallis' where name = 'Tallis Studio'`
    const tallis = await partnerIdOf('Tallis Studio')
    const failing = (await run<Approved>(approve, as('staff-super-admin'), { id: tallis, reason: 'x' })).data?.approvePartner
    expect(failing).toMatchObject({ ok: false, code: 'GO_LIVE_CHECKS_FAILING' })
    expect(failing?.failingChecks).toEqual(['portalHost', 'emailDomain', 'pricedPlan', 'legalPages', 'testSignup'])
  })

  it('a partner set up by a Partner manager needs a second, different staff member; the first approval is recorded, not applied', async () => {
    const kaufladen = await partnerIdOf('Kaufladen Digital')
    // Maya (the second PM) is not assigned to Kaufladen, so assign her for this test.
    await db.sql`insert into staff_partner_assignment (staff_user_id, partner_id) values (${secondPm.id}, ${kaufladen}) on conflict do nothing`
    const first = (await run<Approved>(approve, secondPm, { id: kaufladen, reason: 'Contract and KYC fine' })).data?.approvePartner
    expect(first).toMatchObject({ ok: true, state: 'awaiting', approvals: 1 })
    expect((await db.sql<{ state: string }[]>`select state from partner where id = ${kaufladen}`)[0]?.state).toBe('awaiting')
    expect(await entriesFor(kaufladen, partnerAudit.approvalRecorded)).toHaveLength(1)
    expect((await run<Approved>(approve, secondPm, { id: kaufladen, reason: 'Again' })).data?.approvePartner).toMatchObject({ ok: false, code: 'ALREADY_APPROVED_BY_CALLER' })

    const second = (await run<Approved>(approve, as('staff-super-admin'), { id: kaufladen, reason: 'Second approval' })).data?.approvePartner
    expect(second).toMatchObject({ ok: true, state: 'live', approvals: 2 })
    expect((await db.sql<{ state: string; approved_at: Date | null }[]>`select state, approved_at from partner where id = ${kaufladen}`)[0]).toMatchObject({ state: 'live' })
    // The partner sees that it was approved, never the note on its contract and KYC.
    const entries = await entriesFor(kaufladen, partnerAudit.approvePartner)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ reason: null, visibility: 'partner' })
    const notes = await entriesFor(kaufladen, partnerAudit.approvalRecorded)
    expect(notes.map((n) => [n.reason, n.visibility])).toEqual([['Contract and KYC fine', 'staff'], ['Second approval', 'staff']])
    const [purge] = await db.sql<{ kind: string }[]>`select kind from outbox where partner_id = ${kaufladen} and kind = 'cache.purge'`
    expect(purge).toBeTruthy()
  })

  it('a Super admin who ran the setup approves alone; a self-served partner needs two', async () => {
    const nordlicht = await partnerIdOf('Nordlicht Media')
    await db.sql`update partner set state = 'awaiting', submitted_at = ${now}, submitted_by_kind = 'partner_user', submitted_by_label = 'Freya Lind' where id = ${nordlicht}`
    await db.sql`update partner_domain set status = 'live', found = expected where partner_id = ${nordlicht}`
    await db.sql`update partner_setup_item set status = 'done', done_at = now(), done_by_kind = 'staff', done_by_label = 'DripFunnel' where partner_id = ${nordlicht}`
    // A priced plan (its version 1 is the table's trigger's): the go-live check reads the price.
    await db.sql`
      with p as (insert into plan (partner_id, name, status) values (${nordlicht}, 'Standard', 'live') returning id, partner_id)
      insert into plan_price (plan_id, partner_id, version, currency, monthly_amount) select id, partner_id, 1, 'EUR', 2900 from p
    `
    const sa = as('staff-super-admin')
    await db.sql`insert into partner_setup_session (staff_user_id, partner_id, reason, started_at, expires_at, ended_at) values (${sa.id}, ${nordlicht}, 'set up', ${new Date(now.getTime() - 3600_000)}, ${now}, ${now})`
    const alone = (await run<Approved>(approve, sa, { id: nordlicht, reason: 'All set' })).data?.approvePartner
    expect(alone).toMatchObject({ ok: true, state: 'live', approvals: 1 })

    const southwind = await partnerIdOf('Southwind Retail')
    await db.sql`update partner set state = 'awaiting', submitted_at = ${now}, submitted_by_kind = 'partner_user', submitted_by_label = 'Thandi Nkosi', paused_at = null, pause_reason = null where id = ${southwind}`
    await db.sql`insert into staff_partner_assignment (staff_user_id, partner_id) values (${as('staff-partner-manager').id}, ${southwind}), (${secondPm.id}, ${southwind}) on conflict do nothing`
    expect((await run<Approved>(approve, as('staff-partner-manager'), { id: southwind, reason: 'ok' })).data?.approvePartner).toMatchObject({ ok: true, state: 'awaiting', approvals: 1 })
    expect((await run<Approved>(approve, secondPm, { id: southwind, reason: 'ok too' })).data?.approvePartner).toMatchObject({ ok: true, state: 'live', approvals: 2 })
  })
})

describe('send back, pause and resume (§4.3)', () => {
  const sendBack = `mutation($id: ID!, $reason: String!) { sendBackPartner(id: $id, reason: $reason) { ${outcome} } }`
  const pause = `mutation($id: ID!, $reason: String!) { pausePartner(id: $id, reason: $reason) { ${outcome} } }`
  const resume = `mutation($id: ID!, $reason: String!) { resumePartner(id: $id, reason: $reason) { ${outcome} } }`
  type Out = Record<string, { ok: boolean; code: string | null; state: string | null }>

  it('all three reject an empty reason, and Pause and Resume refuse a Partner manager', async () => {
    const tallis = await partnerIdOf('Tallis Studio')
    expect((await run<Out>(sendBack, as('staff-super-admin'), { id: tallis, reason: '' })).data?.['sendBackPartner']).toMatchObject({ ok: false, code: 'REASON_REQUIRED' })
    const northstar = await partnerIdOf('Northstar Commerce')
    expect((await run<Out>(pause, as('staff-super-admin'), { id: northstar, reason: ' ' })).data?.['pausePartner']).toMatchObject({ ok: false, code: 'REASON_REQUIRED' })
    expect((await run(pause, as('staff-partner-manager'), { id: northstar, reason: 'x' })).code).toBe('FORBIDDEN')
    expect((await run(resume, as('staff-partner-manager'), { id: await partnerIdOf('Southwind Retail'), reason: 'x' })).code).toBe('FORBIDDEN')
  })

  it('send back returns to Draft with the reason the partner sees; pause and resume carry theirs; the house partner is never paused', async () => {
    const tallis = await partnerIdOf('Tallis Studio')
    expect((await run<Out>(sendBack, as('staff-super-admin'), { id: tallis, reason: 'Legal pages missing' })).data?.['sendBackPartner']).toMatchObject({ ok: true, state: 'draft' })
    expect((await db.sql<{ state: string; sent_back_reason: string }[]>`select state, sent_back_reason from partner where id = ${tallis}`)[0]).toEqual({ state: 'draft', sent_back_reason: 'Legal pages missing' })
    expect((await entriesFor(tallis, partnerAudit.sendBackPartner))[0]).toMatchObject({ reason: 'Legal pages missing' })

    const northstar = await partnerIdOf('Northstar Commerce')
    expect((await run<Out>(pause, as('staff-super-admin'), { id: northstar, reason: 'Unpaid invoice' })).data?.['pausePartner']).toMatchObject({ ok: true, state: 'paused' })
    expect((await run<Out>(resume, as('staff-super-admin'), { id: northstar, reason: 'Paid' })).data?.['resumePartner']).toMatchObject({ ok: true, state: 'live' })
    expect((await db.sql<{ paused_at: Date | null }[]>`select paused_at from partner where id = ${northstar}`)[0]?.paused_at).toBeNull()
    expect(await entriesFor(northstar, partnerAudit.resumePartner)).toHaveLength(1)
    expect((await run<Out>(pause, as('staff-super-admin'), { id: await partnerIdOf('DripFunnel'), reason: 'x' })).data?.['pausePartner']).toMatchObject({ ok: false, code: 'HOUSE_PARTNER' })
  })
})

describe('createPartner and the Owner invitation (§4.3)', () => {
  const create = `mutation($input: CreatePartnerInput!) { createPartner(input: $input) { ${outcome} } }`
  const send = `mutation($id: ID!) { sendPartnerOwnerInvite(id: $id) { ${outcome} } }`
  const resend = `mutation($id: ID!) { resendPartnerOwnerInvite(id: $id) { ${outcome} } }`
  type Out = Record<string, { ok: boolean; code: string | null; id: string | null }>

  it('creates a Draft partner with its Owner, held or sent, through the outbox and never in the request', async () => {
    const held = (await run<Out>(create, as('staff-partner-manager'), { input: { name: 'Held Partner', ownerEmail: 'owner@held.example', country: 'FR', sendInvitation: false } })).data?.['createPartner']
    expect(held).toMatchObject({ ok: true })
    const heldId = held?.id ?? ''
    expect((await db.sql<{ state: string; country: string }[]>`select state, country from partner where id = ${heldId}`)[0]).toEqual({ state: 'draft', country: 'FR' })
    expect((await db.sql<{ sent_at: Date | null }[]>`select sent_at from partner_invitation where partner_id = ${heldId}`)[0]?.sent_at).toBeNull()
    expect(await db.sql`select 1 from outbox where partner_id = ${heldId}`).toHaveLength(0)
    expect(await entriesFor(heldId, partnerAudit.createPartner)).toHaveLength(1)

    const sent = (await run<Out>(create, as('staff-super-admin'), { input: { name: 'Sent Partner', ownerEmail: 'owner@sent.example', ownerName: 'Sam Sent', country: 'NL', sendInvitation: true } })).data?.['createPartner']
    const sentId = sent?.id ?? ''
    expect((await db.sql<{ sent_at: Date | null }[]>`select sent_at from partner_invitation where partner_id = ${sentId}`)[0]?.sent_at).not.toBeNull()
    const [email] = await db.sql<{ kind: string; payload: { template: string; to: string } }[]>`select kind, payload from outbox where partner_id = ${sentId}`
    expect(email).toMatchObject({ kind: 'email', payload: { template: 'partner-owner-invitation', to: 'owner@sent.example' } })
    expect(JSON.stringify(email?.payload)).not.toContain('token')

    expect((await run<Out>(create, as('staff-super-admin'), { input: { name: '', ownerEmail: 'not-an-email', country: 'France', sendInvitation: true } })).data?.['createPartner']).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect((await run(create, as('staff-support'), { input: { name: 'X', ownerEmail: 'x@x.example', country: 'FR', sendInvitation: false } })).code).toBe('FORBIDDEN')
  })

  it('sends a held invitation once, resends a sent one with the old link revoked, and refuses an accepted one', async () => {
    const nordlicht = await partnerIdOf('Nordlicht Media')
    expect((await run<Out>(resend, as('staff-super-admin'), { id: nordlicht })).data?.['resendPartnerOwnerInvite']).toMatchObject({ ok: false, code: 'INVITATION_HELD' })
    // Sending a held invitation is Super admin and Partner manager; Support may only resend (§4.3).
    expect((await run(send, as('staff-support'), { id: nordlicht })).code).toBe('FORBIDDEN')
    expect((await run<Out>(send, as('staff-partner-manager'), { id: nordlicht })).data?.['sendPartnerOwnerInvite']).toMatchObject({ ok: true })
    expect((await run<Out>(send, as('staff-partner-manager'), { id: nordlicht })).data?.['sendPartnerOwnerInvite']).toMatchObject({ ok: false, code: 'INVITATION_NOT_HELD' })
    const before = await db.sql<{ id: string; revoked_at: Date | null }[]>`select id, revoked_at from partner_invitation where partner_id = ${nordlicht} order by created_at`
    expect((await run<Out>(resend, as('staff-support'), { id: nordlicht })).data?.['resendPartnerOwnerInvite']).toMatchObject({ ok: true })
    const after = await db.sql<{ id: string; revoked_at: Date | null; sent_at: Date | null }[]>`select id, revoked_at, sent_at from partner_invitation where partner_id = ${nordlicht} order by created_at`
    expect(after).toHaveLength(before.length + 1)
    expect(after[0]?.revoked_at).not.toBeNull()
    expect(after.at(-1)).toMatchObject({ revoked_at: null })
    expect(await db.sql`select 1 from outbox where partner_id = ${nordlicht} and kind = 'email'`).toHaveLength(2)
    expect((await run<Out>(resend, as('staff-super-admin'), { id: await partnerIdOf('Northstar Commerce') })).data?.['resendPartnerOwnerInvite']).toMatchObject({ ok: false, code: 'INVITATION_ACCEPTED' })
    expect((await run(send, as('staff-read-only'), { id: nordlicht })).code).toBe('FORBIDDEN')
  })
})

describe('setup sessions (ACCESS.md §8.2, §8.3)', () => {
  const start = `mutation($id: ID!, $reason: String!) { startPartnerSetupSession(id: $id, reason: $reason) { ok code sessionId expiresAt handoff } }`
  const end = `mutation($id: ID!) { endStaffSession(id: $id) { ${outcome} } }`
  interface Started {
    startPartnerSetupSession: { ok: boolean; code: string | null; sessionId: string | null; expiresAt: string | null; handoff: string | null }
  }
  type Ended = Record<string, { ok: boolean; code: string | null }>

  it('needs a fresh re-authentication, a reason, an open partner and no other open session; Support is refused', async () => {
    const tallis = await partnerIdOf('Tallis Studio')
    expect((await run(start, as('staff-support'), { id: tallis, reason: 'help' })).code).toBe('FORBIDDEN')
    expect((await run<Started>(start, as('staff-super-admin'), { id: tallis, reason: 'help' }, false)).data?.startPartnerSetupSession).toMatchObject({ ok: false, code: 'REAUTH_REQUIRED' })
    expect((await run<Started>(start, as('staff-super-admin'), { id: tallis, reason: ' ' })).data?.startPartnerSetupSession).toMatchObject({ ok: false, code: 'REASON_REQUIRED' })
    expect((await run<Started>(start, as('staff-super-admin'), { id: await partnerIdOf('Blue Fern'), reason: 'x' })).data?.startPartnerSetupSession).toMatchObject({ ok: false, code: 'PARTNER_CLOSED' })

    const started = (await run<Started>(start, as('staff-super-admin'), { id: tallis, reason: 'Finish the checklist' })).data?.startPartnerSetupSession
    expect(started).toMatchObject({ ok: true, code: null })
    expect(started?.handoff).toMatch(/^[0-9a-f]{64}$/)
    expect(started?.expiresAt).toBe(new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString())
    // The token is nowhere but the answer: the row holds a hash, which no request may even read.
    const [row] = await db.sql<{ handoff_hash: string }[]>`select handoff_hash from partner_setup_session where id = ${started?.sessionId ?? ''}`
    expect(row?.handoff_hash).not.toBe(started?.handoff)
    await expect(db.sql.begin(async (tx) => {
      await tx`set local role app_platform`
      await tx`select set_config('app.scope', 'platform', true)`
      return tx`select handoff_hash from partner_setup_session`
    })).rejects.toThrow(/permission denied/i)
    expect(JSON.stringify(await db.sql`select * from activity_log where action = ${partnerAudit.startPartnerSetupSession}`)).not.toContain(started?.handoff ?? 'nothing')

    expect((await run<Started>(start, as('staff-super-admin'), { id: tallis, reason: 'again' })).data?.startPartnerSetupSession).toMatchObject({ ok: false, code: 'SETUP_SESSION_ALREADY_OPEN' })

    // A session that ran its two hours without being ended no longer blocks a new one, and reads as expired.
    const id = started?.sessionId ?? ''
    await db.sql`update partner_setup_session set expires_at = ${new Date(now.getTime() - 1000)} where id = ${id}`
    const sessions = await run<{ partner: { setupSessions: { status: string; endedAt: string | null }[] } }>(`query($id: ID!) { partner(id: $id) { setupSessions { status endedAt } } }`, as('staff-super-admin'), { id: tallis })
    expect(sessions.data?.partner.setupSessions[0]).toMatchObject({ status: 'expired' })
    expect(sessions.data?.partner.setupSessions[0]?.endedAt).not.toBeNull()
    const again = (await run<Started>(start, as('staff-super-admin'), { id: tallis, reason: 'again' })).data?.startPartnerSetupSession
    expect(again).toMatchObject({ ok: true })
    expect((await db.sql<{ ended_at: Date | null }[]>`select ended_at from partner_setup_session where id = ${id}`)[0]?.ended_at).not.toBeNull()
    const second = again?.sessionId ?? ''
    expect((await run<Ended>(end, as('staff-super-admin'), { id: second })).data?.['endStaffSession']).toMatchObject({ ok: true })
    await db.sql`update partner_setup_session set ended_at = null, expires_at = ${new Date(now.getTime() + 3600_000)} where id = ${id}`

    // Ending: the owner or a Super admin, once. A manager not assigned to the partner learns nothing, not even that it exists.
    expect((await run<Ended>(end, secondPm, { id })).data?.['endStaffSession']).toMatchObject({ ok: false, code: 'NOT_FOUND' })
    expect((await run<Ended>(end, as('staff-partner-manager'), { id })).data?.['endStaffSession']).toMatchObject({ ok: false, code: 'NOT_SESSION_OWNER' })
    expect((await run<Ended>(end, as('staff-super-admin'), { id })).data?.['endStaffSession']).toMatchObject({ ok: true })
    expect((await run<Ended>(end, as('staff-super-admin'), { id })).data?.['endStaffSession']).toMatchObject({ ok: false, code: 'SESSION_ENDED' })
    // Two sessions were ended by hand above; the one that expired wrote no entry of its own.
    expect(await entriesFor(tallis, partnerAudit.endStaffSession)).toHaveLength(2)
  })
})

describe('recheckDomain (SAAS.md §8; no lookup inside the request)', () => {
  const recheck = `mutation($id: ID!, $kind: String!) { recheckDomain(id: $id, kind: $kind) { ${outcome} } }`
  type Out = Record<string, { ok: boolean; code: string | null }>

  it('queues the check, refuses an unknown kind, and the deliverer updates the row after commit', async () => {
    const kaufladen = await partnerIdOf('Kaufladen Digital')
    expect((await run<Out>(recheck, as('staff-super-admin'), { id: kaufladen, kind: 'rubbish' })).data?.['recheckDomain']).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect((await run(recheck, as('staff-partner-manager'), { id: kaufladen, kind: 'email' })).code).toBe('FORBIDDEN')

    const looked: string[] = []
    const lookup: DnsLookup = {
      resolve: async (host, type) => {
        looked.push(`${type} ${host}`)
        // The email sender's three records (SAAS §3.6), each answered as expected.
        if (host.startsWith('_dmarc.')) return [emailRecords.dmarc]
        return type === 'TXT' ? [emailRecords.spf] : [emailRecords.dkim]
      },
    }
    expect((await run<Out>(recheck, as('staff-super-admin'), { id: kaufladen, kind: 'email' })).data?.['recheckDomain']).toMatchObject({ ok: true })
    expect(looked).toEqual([])
    expect((await db.sql<{ status: string }[]>`select status from partner_domain where partner_id = ${kaufladen} and kind = 'email'`)[0]?.status).toBe('waiting')

    const counts = await relayDue(db.sql, { 'domain.recheck': domainRecheckDeliverer(db.sql, lookup, () => now) }, { ...defaultRelayOptions, now: () => new Date(Date.now() + 1000) })
    expect(counts.delivered).toBe(1)
    expect(looked).toEqual(['TXT mail.kaufladen.example', 'CNAME df1._domainkey.mail.kaufladen.example', 'TXT _dmarc.mail.kaufladen.example'])
    expect((await db.sql<{ status: string; found: string }[]>`select status, found from partner_domain where partner_id = ${kaufladen} and kind = 'email'`)[0]).toEqual({ status: 'live', found: emailRecords.spf })
    expect(await db.sql`select 1 from activity_log where partner_id = ${kaufladen} and action = 'partner.domain_status_changed'`).toHaveLength(1)
    // Within the same minute a second request folds into the first.
    expect((await run<Out>(recheck, as('staff-super-admin'), { id: kaufladen, kind: 'email' })).data?.['recheckDomain']).toMatchObject({ ok: true })
    expect(await db.sql`select 1 from outbox where partner_id = ${kaufladen} and kind = 'domain.recheck'`).toHaveLength(1)
  })

  it('refuses a stored host that is an address or a local name before any lookup', async () => {
    const kaufladen = await partnerIdOf('Kaufladen Digital')
    for (const host of ['10.0.0.1', '169.254.169.254', '[fe80::1]', 'db.localhost']) {
      await db.sql`update partner_domain set host = ${host} where partner_id = ${kaufladen} and kind = 'preview'`
      expect([host, (await run<Out>(recheck, as('staff-super-admin'), { id: kaufladen, kind: 'preview' })).data?.['recheckDomain']]).toEqual([host, { ok: false, code: 'INVALID_HOSTNAME', failingChecks: null, state: null, id: null, approvals: null }])
    }
  })
})

describe('malformed ids', () => {
  // Every partner operation that takes an id (saas/partners/service.ts), with the arguments its schema requires.
  const operations = [
    ['approvePartner', '(id: $id, reason: "KYC passed")'],
    ['sendBackPartner', '(id: $id, reason: "Impressum")'],
    ['pausePartner', '(id: $id, reason: "Contract")'],
    ['resumePartner', '(id: $id, reason: "Contract renewed")'],
    ['sendPartnerOwnerInvite', '(id: $id)'],
    ['resendPartnerOwnerInvite', '(id: $id)'],
    ['startPartnerSetupSession', '(id: $id, reason: "cover")'],
    ['endStaffSession', '(id: $id)'],
    ['recheckDomain', '(id: $id, kind: "portal")'],
    ['assignPartnerManager', '(id: $id, staffId: $staffId, reason: "cover")'],
    ['unassignPartnerManager', '(id: $id, staffId: $staffId, reason: "cover")'],
  ] as const

  const call = (field: string, args: string, staff: StaffMember) => {
    const declared = args.includes('$staffId') ? '($id: ID!, $staffId: ID!)' : '($id: ID!)'
    return run<Record<string, { ok: boolean; code: string | null }>>(`mutation${declared} { ${field}${args} { ok code } }`, staff, { id: 'abc', staffId: as('staff-partner-manager').id })
  }

  it('answer null or NOT_FOUND to a Super admin, never a database error', async () => {
    const sa = as('staff-super-admin')
    expect((await run<{ partner: unknown }>(`query($id: ID!) { partner(id: $id) { id } }`, sa, { id: 'abc' })).data?.partner).toBeNull()
    for (const [field, args] of operations) expect((await call(field, args, sa)).data?.[field], field).toMatchObject({ ok: false, code: 'NOT_FOUND' })
  })

  it('answer a Partner manager with NOT_FOUND or a plain refusal, and a role without the permission with FORBIDDEN', async () => {
    // The target guard refuses a malformed id as "not assigned" before the service sees it (auth/assignment.ts).
    const pm = as('staff-partner-manager')
    expect((await run<{ partner: unknown }>(`query($id: ID!) { partner(id: $id) { id } }`, pm, { id: 'abc' })).code).toBe('FORBIDDEN')
    for (const [field, args] of operations) {
      const result = await call(field, args, pm)
      const code = result.code ?? result.data?.[field]?.code
      expect(['NOT_FOUND', 'FORBIDDEN'], field).toContain(code)
    }
    for (const [field, args] of operations) expect((await call(field, args, as('staff-read-only'))).code, field).toBe('FORBIDDEN')
  })
})

describe('the service enforces the assignment itself (ACCESS.md §5.4)', () => {
  it('answers an unassigned Partner manager with null or NOT_FOUND without a resolver in front', async () => {
    // Northstar is assigned to the second manager only; Priya reaches the service directly, as a job or script would.
    const northstar = await partnerIdOf('Northstar Commerce')
    const service = createPartnersService({
      sql: db.sql,
      staff: as('staff-partner-manager'),
      reauthFresh: true,
      facts: factsOf(request),
      activity: activityLog,
      isAssigned: (staffId, target) => isAssigned(db.sql, staffId, target),
      now: () => now,
    })
    expect(await service.get(northstar)).toBeNull()
    expect(await service.sendBackPartner(northstar, 'not mine')).toMatchObject({ ok: false, code: 'NOT_FOUND' })
    expect(await service.resendPartnerOwnerInvite(northstar)).toMatchObject({ ok: false, code: 'NOT_FOUND' })
    expect(await service.recheckDomain(northstar, 'portal')).toMatchObject({ ok: false, code: 'NOT_FOUND' })
    expect(await service.startSetupSession(northstar, 'help', null)).toMatchObject({ ok: false, code: 'NOT_FOUND' })
  })
})

describe('partner managers (ACCESS.md §5.4, #60)', () => {
  const assign = `mutation($id: ID!, $staffId: ID!, $reason: String!) { assignPartnerManager(id: $id, staffId: $staffId, reason: $reason) { ${outcome} } }`
  const unassign = `mutation($id: ID!, $staffId: ID!, $reason: String!) { unassignPartnerManager(id: $id, staffId: $staffId, reason: $reason) { ${outcome} } }`
  const managers = `query($id: ID!) { partner(id: $id) { managers { id name } } }`
  type Out = Record<string, { ok: boolean; code: string | null }>
  type Managers = { partner: { managers: { id: string; name: string }[] } }

  it('only a Super admin assigns, with a reason, to an active Partner manager, once', async () => {
    const northstar = await partnerIdOf('Northstar Commerce')
    const priya = as('staff-partner-manager')
    expect((await run(assign, as('staff-partner-manager'), { id: northstar, staffId: priya.id, reason: 'cover' })).code).toBe('FORBIDDEN')
    expect((await run(assign, as('staff-support'), { id: northstar, staffId: priya.id, reason: 'cover' })).code).toBe('FORBIDDEN')
    expect((await run<Out>(assign, as('staff-super-admin'), { id: northstar, staffId: priya.id, reason: ' ' })).data?.['assignPartnerManager']).toMatchObject({ ok: false, code: 'REASON_REQUIRED' })
    expect((await run<Out>(assign, as('staff-super-admin'), { id: northstar, staffId: as('staff-support').id, reason: 'cover' })).data?.['assignPartnerManager']).toMatchObject({ ok: false, code: 'NOT_A_PARTNER_MANAGER' })
    expect((await run<Out>(assign, as('staff-super-admin'), { id: 'not-an-id', staffId: priya.id, reason: 'cover' })).data?.['assignPartnerManager']).toMatchObject({ ok: false, code: 'NOT_FOUND' })
    await db.sql`update staff_user set status = 'suspended' where id = ${secondPm.id}`
    expect((await run<Out>(assign, as('staff-super-admin'), { id: northstar, staffId: secondPm.id, reason: 'cover' })).data?.['assignPartnerManager']).toMatchObject({ ok: false, code: 'STAFF_NOT_ACTIVE' })
    await db.sql`update staff_user set status = 'active' where id = ${secondPm.id}`
    expect((await run<Out>(assign, as('staff-super-admin'), { id: northstar, staffId: priya.id, reason: 'Maya is away this week' })).data?.['assignPartnerManager']).toMatchObject({ ok: true })
    expect((await run<Out>(assign, as('staff-super-admin'), { id: northstar, staffId: priya.id, reason: 'again' })).data?.['assignPartnerManager']).toMatchObject({ ok: false, code: 'ALREADY_ASSIGNED' })
    const names = (await run<Managers>(managers, as('staff-super-admin'), { id: northstar })).data?.partner.managers.map((m) => m.name)
    expect(names).toEqual(['Maya Ortiz', 'Priya Shah'])
    // The assignment is a staff matter: the entry is not the partner's to see, and it names the manager.
    const [recorded] = await db.sql<{ visibility: string; target_label: string }[]>`select visibility, target_label from activity_log where action = ${partnerAudit.assignPartnerManager} and partner_id = ${northstar}`
    expect(recorded).toEqual({ visibility: 'staff', target_label: 'Priya Shah <priya@softobotics.example>' })
  })

  it('an assigned manager reaches the partner, an unassigned one is refused on the server, a Super admin always may', async () => {
    const northstar = await partnerIdOf('Northstar Commerce')
    const priya = as('staff-partner-manager')
    const detail = `query($id: ID!) { partner(id: $id) { name } }`
    expect((await run(detail, priya, { id: northstar })).code).toBeUndefined()
    expect((await run<{ partners: { items: { name: string }[] } }>(`{ partners { items { name } } }`, priya)).data?.partners.items.map((i) => i.name)).toContain('Northstar Commerce')

    expect((await run<Out>(unassign, as('staff-super-admin'), { id: northstar, staffId: priya.id, reason: 'Maya is back' })).data?.['unassignPartnerManager']).toMatchObject({ ok: true })
    expect((await run<Out>(unassign, as('staff-super-admin'), { id: northstar, staffId: priya.id, reason: 'again' })).data?.['unassignPartnerManager']).toMatchObject({ ok: false, code: 'NOT_ASSIGNED' })
    expect((await run(detail, priya, { id: northstar })).code).toBe('FORBIDDEN')
    expect((await run<{ partners: { items: { name: string }[] } }>(`{ partners { items { name } } }`, priya)).data?.partners.items.map((i) => i.name)).not.toContain('Northstar Commerce')
    expect((await run(`mutation($id: ID!, $reason: String!) { sendBackPartner(id: $id, reason: $reason) { ok } }`, priya, { id: northstar, reason: 'x' })).code).toBe('FORBIDDEN')
    // The activity log is scoped the same way: an unassigned partner's entries are not hers.
    const entries = await listActivity(db.sql, { caller: { kind: 'staff', staffId: priya.id } }, {}, {}, { assignedTo: priya.id })
    expect(entries.ok && entries.page.items.every((e) => e.partner_id !== northstar)).toBe(true)
    expect(entries.ok && entries.page.items.length).toBeGreaterThan(0)
    expect((await run(detail, as('staff-super-admin'), { id: northstar })).code).toBeUndefined()
    // Never deleted: the row stays with removed_at, and the pair may be assigned again.
    const rows = await db.sql<{ removed_at: Date | null }[]>`select removed_at from staff_partner_assignment where partner_id = ${northstar} and staff_user_id = ${priya.id} order by created_at`
    expect(rows).toHaveLength(1)
    expect(rows[0]?.removed_at).not.toBeNull()
    expect((await run<Out>(assign, as('staff-super-admin'), { id: northstar, staffId: priya.id, reason: 'cover again' })).data?.['assignPartnerManager']).toMatchObject({ ok: true })
  })

})

describe('every mutation records exactly one entry in its own transaction', () => {
  it('a refused mutation leaves no entry', async () => {
    const house = await partnerIdOf('DripFunnel')
    const before = await db.sql<{ n: string }[]>`select count(*)::text as n from activity_log where partner_id = ${house}`
    await run(`mutation($id: ID!, $reason: String!) { pausePartner(id: $id, reason: $reason) { ok } }`, as('staff-super-admin'), { id: house, reason: 'x' })
    const after = await db.sql<{ n: string }[]>`select count(*)::text as n from activity_log where partner_id = ${house}`
    expect(after[0]?.n).toBe(before[0]?.n)
  })
})

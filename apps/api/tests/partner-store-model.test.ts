import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CallerContext } from '#core/tenancy'
import type { PartnerRow, StoreRow } from '#db/schema/saas'
import { pgArray, withScope } from '#db/scoped/index'
import { insertPartner, insertPartnerUser, insertPlan, selectPartner, selectPartners, selectPlans, selectPlansFor, upsertPartnerDomain, upsertSetupItem } from '#db/scoped/partners'
import { insertJob, insertMembership, insertStore, insertUser, selectJobDetail, selectStore, selectStorePeople, selectStores } from '#db/scoped/stores'
import { canTransitionPartner, transitionPartner } from '#saas/partners/states'
import { setupStateOf, stuckAfterMinutes } from '#saas/provisioning/stuck'
import { canTransitionStore, extendTrial, transitionStore } from '#saas/stores/states'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #32: every field the admin console shows (FIRST-RELEASE §4.1, §4.2, §5.1, §5.2) exists
// and is reachable through db/scoped, every state is representable, the seed is believable
// and local-only, and the new tables join the isolation matrix.

let db: TestDatabase
const now = new Date('2026-10-02T12:00:00Z')

const staff: CallerContext = { caller: { kind: 'staff', staffId: 'st' } }
const partner = (partnerId: string): CallerContext => ({ caller: { kind: 'partner-user', partnerUserId: 'pu' }, partnerId })
const merchant = (partnerId: string, storeId: string): CallerContext => ({
  caller: { kind: 'person', userId: 'u', sessionId: 's' },
  partnerId,
  storeId,
  sellerScope: { kind: 'all' },
  subscription: 'active',
})
const supplier = (partnerId: string, storeId: string, sellerId: string): CallerContext => ({ ...merchant(partnerId, storeId), sellerScope: { kind: 'seller', sellerId } })
const shopper = (partnerId: string, storeId: string): CallerContext => ({ caller: { kind: 'shopper', customerId: null }, partnerId, storeId, sellerScope: { kind: 'all' }, subscription: 'active' })

const as = <T>(context: CallerContext, work: Parameters<typeof withScope<T>>[2]) => withScope(db.sql, context, work)

const idOf = async (table: string, where: string): Promise<string> => {
  const [row] = await db.sql<{ id: string }[]>`select id from ${db.sql(table)} where name = ${where}`
  if (!row) throw new Error(`${table} ${where} missing`)
  return row.id
}

beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db.url, now)
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('the seed', () => {
  it('builds a believable platform: every partner and store state, a failed and a stuck signup, a past-due store', async () => {
    const states = await db.sql<{ state: string; n: string }[]>`select state, count(*)::text as n from partner group by state order by state`
    expect(states.map((r) => r.state)).toEqual(['awaiting', 'closed', 'draft', 'live', 'offboarding', 'paused'])
    const statuses = await db.sql<{ status: string }[]>`select distinct status from store order by status`
    expect(statuses.map((r) => r.status)).toEqual(['active', 'cancelled', 'past_due', 'suspended', 'trial'])
    const [house] = await db.sql<{ name: string }[]>`select name from partner where is_house`
    expect(house?.name).toBe('DripFunnel')
    const jobs = await db.sql<{ state: string; step: string }[]>`select state, step from job where state <> 'done' order by step`
    expect(jobs).toEqual([
      { state: 'running', step: 'firstBuild' },
      { state: 'running', step: 'hostnames' },
      { state: 'failed', step: 'repo' },
    ])
    const [stores] = await db.sql<{ n: string }[]>`select count(*)::text as n from store`
    expect(Number(stores?.n)).toBeGreaterThan(100)
  })

  it('refuses any host that is not loopback, with no CI opt-in', async () => {
    await expect(seed('postgres://u:p@dbpg01.softobotics.org:5432/dripfunnel')).rejects.toThrow(/Refusing/)
    process.env['ALLOW_REMOTE_MIGRATIONS'] = '1'
    process.env['CI'] = 'true'
    process.env['ALLOWED_MIGRATION_HOST'] = 'dbpg01.softobotics.org'
    try {
      await expect(seed('postgres://u:p@dbpg01.softobotics.org:5432/dripfunnel')).rejects.toThrow(/Refusing/)
    } finally {
      delete process.env['ALLOW_REMOTE_MIGRATIONS']
      delete process.env['CI']
      delete process.env['ALLOWED_MIGRATION_HOST']
    }
  })

  it('is repeatable: running it again replaces, never duplicates', async () => {
    const before = await db.sql<{ n: string }[]>`select count(*)::text as n from store`
    await seed(db.url, now)
    const after = await db.sql<{ n: string }[]>`select count(*)::text as n from store`
    expect(after[0]?.n).toBe(before[0]?.n)
  })
})

describe('the fields the admin console shows', () => {
  it('Partners list (§4.1): state, store count, portal host and status, setup progress, owner and invitation, created', async () => {
    const rows = await as(staff, (tx) => selectPartners(tx, {}, {}, 25))
    const kaufladen = rows.find((r) => r.name === 'Kaufladen Digital')
    expect(kaufladen).toMatchObject({
      state: 'awaiting',
      store_count: 1,
      portal_host: 'shop.kaufladen.example',
      portal_status: 'live',
      setup_done: 8,
      setup_total: 10,
      owner_name: 'Jonas Weber',
      owner_email: 'jonas@kaufladen.example',
      owner_invitation: 'active',
      is_house: false,
    })
    expect(kaufladen?.submitted_at).not.toBeNull()
    expect(kaufladen?.submitted_by_label).toBe('Jonas Weber')
    const tallis = rows.find((r) => r.name === 'Tallis Studio')
    expect(tallis).toMatchObject({ portal_status: 'waiting', owner_invitation: 'sent', setup_done: 1 })
    expect(rows.find((r) => r.name === 'Nordlicht Media')?.owner_invitation).toBe('held')
  })

  it('Partner detail (§4.2): branding, domains with records, plans with store counts, team, checklist with who did it', async () => {
    const id = await idOf('partner', 'Kaufladen Digital')
    const row = await as(staff, (tx) => selectPartner(tx, id))
    expect(row).toMatchObject({ product_name: 'Kaufladen Shops', primary_color: '#2A2F8F', powered_by: 'on', country: 'DE', fallback_sender_accepted: true })
    const domains = await as(staff, (tx) => tx`select kind, status, record_type, expected, found from partner_domain where partner_id = ${id} order by kind`)
    expect(domains).toHaveLength(4)
    expect(domains.find((d) => d['kind'] === 'email')).toMatchObject({ status: 'waiting', record_type: 'TXT', found: null })
    const plans = await as(staff, (tx) => selectPlans(tx, id))
    expect(plans.map((p) => [p.name, p.status, p.store_count])).toEqual([
      ['Basis', 'live', 0],
      ['Plus', 'live', 1],
      ['Enterprise', 'draft', 0],
    ])
    const items = await as(staff, (tx) => tx<{ item: string; status: string; done_by_label: string | null }[]>`select item, status, done_by_label from partner_setup_item where partner_id = ${id} order by item`)
    expect(items).toHaveLength(10)
    expect(items.find((i) => i.item === 'branding')).toMatchObject({ status: 'done', done_by_label: 'DripFunnel' })
    expect(items.find((i) => i.item === 'payoutDetails')).toMatchObject({ status: 'missing', done_by_label: null })
  })

  it('Stores list (§5.1): partner, owner, plan, status facts, storefront, domain and status, signup state, created', async () => {
    // Asking for 200 gets the maximum, 100, and one more as the "is there another page" row.
    const rows = await as(staff, (tx) => selectStores(tx, {}, {}, 200, stuckAfterMinutes, now))
    expect(rows).toHaveLength(101)
    const all = [...rows, ...(await as(staff, (tx) => selectStores(tx, {}, { after: { occurredAt: rows[99]?.created_at ?? now, id: rows[99]?.id ?? '' } }, 100, stuckAfterMinutes, now)))]
    const byName = new Map(all.map((r) => [r.name, r]))
    expect(byName.get('Kiko Kids')).toMatchObject({ partner_name: 'Bazaar Cloud', owner_name: 'Fatima Al Nuaimi', plan_name: 'Growth UAE', status: 'past_due', domain_host: 'kikokids.example', domain_status: 'live', build_state: 'live' })
    expect(byName.get('Kiko Kids')?.past_due_since).not.toBeNull()
    expect(byName.get('Redline Moto Parts')).toMatchObject({ status: 'suspended', suspended_reason: 'Chargeback', suspended_by_label: 'Arjun Menon', suspended_previous_status: 'active' })
    expect(byName.get('Atelier Nove')).toMatchObject({ storefront_kind: 'own', build_state: null, support_access_allowed: false })
    expect(byName.get('Maple & Pine Home')).toMatchObject({ domain_host: 'shop.mapleandpine.example', domain_status: 'waiting' })
    const fjord = byName.get('Fjord Outdoor')
    expect(fjord).toMatchObject({ build_state: 'building', job_state: 'running', job_step: 'firstBuild', job_attempts: 2 })
    expect(fjord?.job_steps).toHaveLength(8)
    expect(setupStateOf(fjord && fjord.job_state && fjord.job_step && fjord.job_step_started_at ? { state: fjord.job_state, step: fjord.job_step, step_started_at: fjord.job_step_started_at } : null, now)).toBe('stuck')
    const tidewater = byName.get('Tidewater Surf')
    expect(tidewater?.job_steps).toHaveLength(3)
    expect(byName.get('Harbor Coffee Co.')?.trial_ends_at?.getTime()).toBe(now.getTime() + 24 * 60 * 60 * 1000)
  })

  it('Store detail (§5.2): people with roles and suppliers, custom domain records, the signup job, staff notes', async () => {
    const id = await idOf('store', 'Mehta Textiles')
    const people = await as(staff, (tx) => selectStorePeople(tx, id))
    expect(people.map((p) => [p.role_key, p.name, p.status])).toEqual([
      ['owner', 'Priya Mehta', 'active'],
      ['manager', 'Rohan Verma', 'active'],
      ['staff', 'Aisha Khan', 'invited'],
      ['staff', 'Dev Patel', 'active'],
      ['supplier-admin', 'Lakshmi Iyer', 'active'],
    ])
    expect(people[4]?.seller_name).toBe('Kaveri Weaves')
    const [domain] = await as(staff, (tx) => tx<{ host: string; expected_cname: string; ownership_token: string }[]>`select host, expected_cname, ownership_token from custom_domain where store_id = ${id}`)
    expect(domain).toEqual({ host: 'mehtatextiles.example', expected_cname: 'shops.edge.dripfunnel.example', ownership_token: 'df-verify=mehta-textiles' })
    const kiko = await idOf('store', 'Kiko Kids')
    const notes = await as(staff, (tx) => tx<{ text: string; by_name: string }[]>`select n.text, s.name as by_name from store_note n join staff_user s on s.id = n.staff_user_id where n.store_id = ${kiko}`)
    expect(notes[0]).toMatchObject({ by_name: 'Priya Shah' })
    const peak = await idOf('store', 'Peak Supply Co.')
    const [job] = await as(staff, (tx) => tx<{ id: string; state: string; step: string; last_error: string }[]>`select id, state, step, last_error from job where store_id = ${peak}`)
    expect(job).toMatchObject({ state: 'failed', step: 'repo', last_error: 'GitHub didn’t respond while creating the storefront.' })
    const detail = await as(staff, (tx) => selectJobDetail(tx, job?.id ?? ''))
    expect(detail?.details).toContain('502')
  })

  it('state history is the activity log, not a table', async () => {
    const id = await idOf('partner', 'Kaufladen Digital')
    const history = await as(staff, (tx) => tx<{ action: string; reason: string | null }[]>`select action, reason from activity_log where target_type = 'partner' and target_id = ${id} order by occurred_at`)
    expect(history.map((h) => h.action)).toEqual(['partner.created', 'partner.set_up', 'partner.submitted', 'partner.sent_back', 'partner.submitted'])
    expect(history[3]?.reason).toBe('Legal pages missing an Impressum')
  })
})

describe('filters, sort and paging (§4.1, §5.1)', () => {
  it('partners: by state, by setup, by search over name, host and owner email; Approvals oldest first', async () => {
    const awaiting = await as(staff, (tx) => selectPartners(tx, { state: 'awaiting' }, {}, 25))
    expect(awaiting.map((r) => r.name)).toEqual(['Kaufladen Digital'])
    const incomplete = await as(staff, (tx) => selectPartners(tx, { setup: 'incomplete' }, {}, 25))
    expect(incomplete.map((r) => r.name).sort()).toEqual(['Kaufladen Digital', 'Nordlicht Media', 'Tallis Studio'])
    const complete = await as(staff, (tx) => selectPartners(tx, { setup: 'complete' }, {}, 25))
    expect(complete.map((r) => r.name)).not.toContain('Tallis Studio')
    expect((await as(staff, (tx) => selectPartners(tx, { q: 'kaufladen.example' }, {}, 25))).map((r) => r.name)).toEqual(['Kaufladen Digital'])
    expect((await as(staff, (tx) => selectPartners(tx, { q: 'vikram@' }, {}, 25))).map((r) => r.name)).toEqual(['Bazaar Cloud'])
    const queue = await as(staff, (tx) => selectPartners(tx, { state: 'awaiting' }, {}, 25, 'oldestSubmitted'))
    expect(queue).toHaveLength(1)
  })

  it('stores: by partner, status, storefront, signup state, created window and search, newest first, by cursor', async () => {
    const ns = await idOf('partner', 'Northstar Commerce')
    const page1 = await as(staff, (tx) => selectStores(tx, { partnerId: ns }, {}, 10, stuckAfterMinutes, now))
    expect(page1).toHaveLength(11)
    const last = page1[9]
    if (!last) throw new Error('no row')
    const page2 = await as(staff, (tx) => selectStores(tx, { partnerId: ns }, { after: { occurredAt: last.created_at, id: last.id } }, 10, stuckAfterMinutes, now))
    expect(new Set([...page1.slice(0, 10), ...page2].map((r) => r.id)).size).toBe(10 + page2.length)
    const times = page1.map((r) => r.created_at.getTime())
    expect(times).toEqual([...times].sort((a, b) => b - a))

    const own = await as(staff, (tx) => selectStores(tx, { storefront: 'own' }, {}, 50, stuckAfterMinutes, now))
    expect(own.map((r) => r.name).sort()).toEqual(['Atelier Nove', 'Tidewater Surf'])
    expect((await as(staff, (tx) => selectStores(tx, { storefront: 'failed' }, {}, 50, stuckAfterMinutes, now))).map((r) => r.name)).toEqual(['Peak Supply Co.'])
    expect((await as(staff, (tx) => selectStores(tx, { setup: 'stuck' }, {}, 50, stuckAfterMinutes, now))).map((r) => r.name)).toEqual(['Fjord Outdoor'])
    expect((await as(staff, (tx) => selectStores(tx, { setup: 'running' }, {}, 50, stuckAfterMinutes, now))).map((r) => r.name)).toEqual(['Tidewater Surf'])
    expect((await as(staff, (tx) => selectStores(tx, { setup: 'failed' }, {}, 50, stuckAfterMinutes, now))).map((r) => r.name)).toEqual(['Peak Supply Co.'])
    expect((await as(staff, (tx) => selectStores(tx, { status: 'suspended' }, {}, 50, stuckAfterMinutes, now))).map((r) => r.name)).toEqual(['Redline Moto Parts'])
    const week = await as(staff, (tx) => selectStores(tx, { createdAfter: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) }, {}, 50, stuckAfterMinutes, now))
    expect(week.map((r) => r.name).sort()).toEqual(['Fjord Outdoor', 'Grünwerk', 'Peak Supply Co.', 'Saffron Street', 'Tidewater Surf'])
    expect((await as(staff, (tx) => selectStores(tx, { q: 'kikokids.example' }, {}, 50, stuckAfterMinutes, now))).map((r) => r.name)).toEqual(['Kiko Kids'])
    expect((await as(staff, (tx) => selectStores(tx, { q: 'jenna@' }, {}, 50, stuckAfterMinutes, now))).map((r) => r.name)).toEqual(['Harbor Coffee Co.'])
    // A wildcard in the term matches itself, not everything.
    expect(await as(staff, (tx) => selectStores(tx, { q: '%' }, {}, 50, stuckAfterMinutes, now))).toEqual([])
  })

  it('reads a filtered page through its index', async () => {
    const ns = await idOf('partner', 'Northstar Commerce')
    const plan = await as(staff, async (tx) => {
      await tx`analyze store`
      const rows = await tx<{ 'QUERY PLAN': string }[]>`
        explain select id from store where partner_id = ${ns} and status = 'active' order by created_at desc, id desc limit 26
      `
      return rows.map((r) => r['QUERY PLAN']).join('\n')
    })
    expect(plan).toMatch(/Index Scan using store_\w+_idx|Bitmap Index Scan on store_\w+_idx/)
    expect(plan).not.toMatch(/Seq Scan/)
  })

  it('caps a batched read per partner, so one partner cannot crowd out another', async () => {
    const [ts, kl] = await Promise.all([idOf('partner', 'Tallis Studio'), idOf('partner', 'Kaufladen Digital')])
    const inserted = await as(staff, (tx) => Promise.all(Array.from({ length: 101 }, (_, i) => insertPlan(tx, { partnerId: ts, name: `Draft ${i}`, status: 'draft' }))))
    try {
      const rows = await as(staff, (tx) => selectPlansFor(tx, [ts, kl]))
      expect(rows.filter((r) => r.partner_id === ts)).toHaveLength(100)
      expect(rows.filter((r) => r.partner_id === kl)).toHaveLength(3)
    } finally {
      // A plan's versions go with it, in one transaction: the current-version key is checked at commit.
      await db.sql.begin(async (tx) => {
        await tx`delete from plan_version where plan_id = any(${pgArray(inserted)}::uuid[])`
        await tx`delete from plan where id = any(${pgArray(inserted)}::uuid[])`
      })
    }
  })
})

describe('states (SAAS.md §3.1, §4.2)', () => {
  it('the partner map', () => {
    expect(canTransitionPartner('draft', 'awaiting')).toBe(true)
    expect(canTransitionPartner('awaiting', 'draft')).toBe(true)
    expect(canTransitionPartner('draft', 'live')).toBe(false)
    expect(canTransitionPartner('closed', 'live')).toBe(false)
    expect(canTransitionPartner('paused', 'live')).toBe(true)
  })

  it('writes the facts with the state and refuses what the map or the house rule forbids', async () => {
    const row = async (id: string): Promise<PartnerRow> => {
      const r = await as(staff, (tx) => selectPartner(tx, id))
      if (!r) throw new Error('partner missing')
      return r
    }
    const id = await idOf('partner', 'Tallis Studio')
    expect(await as(staff, async (tx) => transitionPartner(tx, await row(id), { to: 'live' }, now))).toEqual({ ok: false, code: 'INVALID_TRANSITION' })
    expect(await as(staff, async (tx) => transitionPartner(tx, await row(id), { to: 'awaiting', by: { kind: 'partner_user', label: 'Ben Tallis' } }, now))).toEqual({ ok: true })
    expect(await row(id)).toMatchObject({ state: 'awaiting', submitted_by_label: 'Ben Tallis', submitted_at: now })
    expect(await as(staff, async (tx) => transitionPartner(tx, await row(id), { to: 'draft', reason: '   ' }, now))).toEqual({ ok: false, code: 'REASON_REQUIRED' })
    expect(await as(staff, async (tx) => transitionPartner(tx, await row(id), { to: 'draft', reason: 'Impressum missing' }, now))).toEqual({ ok: true })
    expect(await row(id)).toMatchObject({ state: 'draft', sent_back_reason: 'Impressum missing' })

    const house = await idOf('partner', 'DripFunnel')
    expect(await as(staff, async (tx) => transitionPartner(tx, await row(house), { to: 'paused', reason: 'x' }, now))).toEqual({ ok: false, code: 'HOUSE_PARTNER' })
    await expect(db.sql`insert into partner (name, is_house) values ('Second house', true)`).rejects.toThrow(/partner_house_key/)
  })

  it('the store map, suspend remembering the previous status, restore returning to it, extend trial', async () => {
    expect(canTransitionStore('trial', 'active')).toBe(true)
    expect(canTransitionStore('cancelled', 'active')).toBe(false)
    expect(canTransitionStore('closed', 'active')).toBe(false)
    const row = async (id: string): Promise<StoreRow> => {
      const r = await as(staff, (tx) => selectStore(tx, id))
      if (!r) throw new Error('store missing')
      return r
    }
    const id = await idOf('store', 'Kiko Kids')
    expect(await as(staff, async (tx) => transitionStore(tx, await row(id), { to: 'restored' }, now))).toEqual({ ok: false, code: 'NOT_SUSPENDED' })
    expect(await as(staff, async (tx) => transitionStore(tx, await row(id), { to: 'suspended', reason: '', by: 'Arjun Menon' }, now))).toEqual({ ok: false, code: 'REASON_REQUIRED' })
    expect(await as(staff, async (tx) => transitionStore(tx, await row(id), { to: 'suspended', reason: 'Fraud review', by: 'Arjun Menon' }, now))).toEqual({ ok: true, status: 'suspended' })
    expect(await row(id)).toMatchObject({ status: 'suspended', suspended_previous_status: 'past_due', suspended_reason: 'Fraud review' })
    expect(await as(staff, async (tx) => transitionStore(tx, await row(id), { to: 'suspended', reason: 'Again', by: 'x' }, now))).toEqual({ ok: false, code: 'INVALID_TRANSITION' })
    // Out of suspension only by restore or cancellation: a direct move would leave the facts behind.
    expect(await as(staff, async (tx) => transitionStore(tx, await row(id), { to: 'active' }, now))).toEqual({ ok: false, code: 'INVALID_TRANSITION' })
    expect(await as(staff, async (tx) => transitionStore(tx, await row(id), { to: 'restored' }, now))).toEqual({ ok: true, status: 'past_due' })
    expect(await row(id)).toMatchObject({ status: 'past_due', suspended_at: null, suspended_reason: null })

    const trial = await idOf('store', 'Harbor Coffee Co.')
    const later = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000)
    expect(await as(staff, async (tx) => extendTrial(tx, await row(trial), later))).toEqual({ ok: true, status: 'trial' })
    expect((await row(trial)).trial_ends_at?.getTime()).toBe(later.getTime())
    expect(await as(staff, async (tx) => extendTrial(tx, await row(id), later))).toEqual({ ok: false, code: 'INVALID_TRANSITION' })
    await expect(db.sql`update store set status = 'suspended' where id = ${trial}`).rejects.toThrow(/store_suspended/)
  })
})

describe('isolation (ACCESS.md §11.1)', () => {
  let a: string
  let b: string
  let storeA: string
  let storeB: string
  let sellerA: string

  beforeAll(async () => {
    a = await idOf('partner', 'Northstar Commerce')
    b = await idOf('partner', 'Bazaar Cloud')
    storeA = await idOf('store', 'Juniper & Co.')
    storeB = await idOf('store', 'Mehta Textiles')
    sellerA = await idOf('seller', 'Loomcraft')
  })

  const count = (context: CallerContext, table: string) =>
    as(context, async (tx) => Number((await tx<{ n: string }[]>`select count(*)::text as n from ${tx(table)}`)[0]?.n))

  it('a partner sees only its own users, plans, domains, checklist and invitations', async () => {
    for (const table of ['partner_user', 'plan', 'partner_domain', 'partner_setup_item', 'partner_invitation']) {
      const mine = await as(partner(a), (tx) => tx<{ partner_id: string }[]>`select partner_id from ${tx(table)}`)
      expect(mine.length).toBeGreaterThan(0)
      expect(mine.every((r) => r.partner_id === a)).toBe(true)
    }
    const plansA = await as(partner(a), (tx) => selectPlans(tx, b))
    expect(plansA).toEqual([])
  })

  it('a partner reads its stores people at account level, never another partner stores', async () => {
    const people = await as(partner(a), (tx) => selectStorePeople(tx, storeA))
    expect(people.length).toBe(3)
    expect(await as(partner(a), (tx) => selectStorePeople(tx, storeB))).toEqual([])
    const users = await as(partner(a), (tx) => tx<{ partner_id: string }[]>`select partner_id from "user"`)
    expect(users.every((u) => u.partner_id === a)).toBe(true)
    // Staff notes are not granted to app_partner at all (#155). Invitations are, and a partner
    // reads only its own stores' owner invitations: what the Stores list shows.
    await expect(count(partner(a), 'store_note')).rejects.toThrow(/permission denied/i)
    await db.sql`insert into invitation (store_id, email, role_key, expires_at, invited_by_label) values (${storeA}, 'owner-to-be@juniper.example', 'owner', now() + interval '7 days', 'Maya Chen')`
    const seen = await as(partner(a), (tx) => tx<{ store_id: string; role_key: string; seller_id: string | null }[]>`select store_id, role_key, seller_id from invitation`)
    const [owned] = await db.sql<{ n: string }[]>`
      select count(*)::text as n from invitation i join store s on s.id = i.store_id
      where s.partner_id = ${a} and i.seller_id is null and i.role_key = 'owner'
    `
    expect(seen.length).toBe(Number(owned?.n))
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((i) => i.role_key === 'owner' && i.seller_id === null)).toBe(true)
    expect(await as(partner(a), (tx) => tx`select id from invitation where store_id = ${storeB}`)).toEqual([])
  })

  it('a partner may not write a plan or a user under another partner, nor list another store', async () => {
    await expect(as(partner(a), (tx) => insertPlan(tx, { partnerId: b, name: 'Forged' }))).rejects.toThrow(/row-level security/i)
    await expect(as(partner(a), (tx) => insertPartnerUser(tx, { partnerId: b, email: 'x@b', name: 'X', role: 'partner-admin', status: 'invited' }))).rejects.toThrow(/row-level security/i)
    expect((await as(partner(a), (tx) => selectStores(tx, {}, {}, 100, stuckAfterMinutes, now))).every((s) => s.partner_id === a)).toBe(true)
    expect((await as(partner(a), (tx) => selectPartners(tx, {}, {}, 25))).map((p) => p.id)).toEqual([a])
  })

  it('a merchant may not write its signup job, and a supplier touches only its own invitations', async () => {
    await expect(as(merchant(a, storeA), (tx) => tx`update job set state = 'done' where store_id = ${storeA}`)).resolves.toHaveLength(0)
    await expect(as(merchant(a, storeA), (tx) => insertJob(tx, { storeId: storeA, state: 'done', steps: ['done'], step: 'done' }))).rejects.toThrow(/row-level security/i)
    await as(staff, (tx) => tx`insert into invitation (store_id, email, role_key, expires_at, invited_by_label) values (${storeA}, 'new-manager@juniper.example', 'manager', now() + interval '7 days', 'Anjali Nair')`)
    const revoked = await as(supplier(a, storeA, sellerA), (tx) => tx`update invitation set revoked_at = now() where store_id = ${storeA} returning id`)
    expect(revoked).toHaveLength(0)
    const [still] = await db.sql<{ revoked_at: Date | null }[]>`select revoked_at from invitation where store_id = ${storeA}`
    expect(still?.revoked_at).toBeNull()
  })

  it('no request scope reads a credential column, and the raw job detail is staff alone', async () => {
    // `phone` is personal data no screen reads yet (DATA-MODEL §2.1), so it is granted like a credential.
    for (const [table, column] of [['"user"', 'password_hash'], ['"user"', 'two_factor_secret_enc'], ['"user"', 'phone'], ['partner_user', 'password_hash'], ['partner_user', 'two_factor_secret_enc'], ['partner_invitation', 'token_hash'], ['invitation', 'token_hash']] as const) {
      await expect(as(staff, (tx) => tx.unsafe(`select ${column} from ${table}`))).rejects.toThrow(/permission denied/i)
      await expect(as(partner(a), (tx) => tx.unsafe(`select ${column} from ${table}`))).rejects.toThrow(/permission denied/i)
    }
    // The row is still readable without them.
    expect((await as(partner(a), (tx) => tx`select id, email from partner_user`)).length).toBeGreaterThan(0)
    const peak = await idOf('store', 'Peak Supply Co.')
    const df = await idOf('partner', 'DripFunnel')
    expect(await count(merchant(df, peak), 'job_detail')).toBe(0)
    await expect(count(partner(df), 'job_detail')).rejects.toThrow(/permission denied/i)
    expect(await count(staff, 'job_detail')).toBeGreaterThan(0)
  })

  it('a merchant sees its own people, plan, domain and job and nothing of another store', async () => {
    expect((await as(merchant(a, storeA), (tx) => selectStorePeople(tx, storeA))).length).toBe(3)
    expect(await as(merchant(a, storeA), (tx) => selectStorePeople(tx, storeB))).toEqual([])
    expect(await count(merchant(a, storeA), 'plan')).toBe(1)
    expect(await count(merchant(a, storeA), 'custom_domain')).toBe(1)
    expect(await count(merchant(a, storeA), 'job')).toBe(1)
    expect(await count(merchant(a, storeA), 'partner_user')).toBe(0)
    expect(await count(merchant(a, storeA), 'store_note')).toBe(0)
    await expect(as(merchant(a, storeA), (tx) => tx`select id from store_note`)).resolves.toEqual([])
  })

  it('a supplier sees only its own team', async () => {
    const team = await as(supplier(a, storeA, sellerA), (tx) => selectStorePeople(tx, storeA))
    expect(team.map((p) => p.role_key).sort()).toEqual(['supplier-admin', 'supplier-member'])
    // The supplier role holds no grant on the store's plan or domains (#295).
    await expect(count(supplier(a, storeA, sellerA), 'plan')).rejects.toThrow(/permission denied/i)
    await expect(count(supplier(a, storeA, sellerA), 'custom_domain')).rejects.toThrow(/permission denied/i)
  })

  it('a shopper sees none of it', async () => {
    for (const table of ['membership', 'user', 'plan', 'custom_domain', 'job', 'partner_user']) {
      expect(await count(shopper(a, storeA), table)).toBe(0)
    }
  })

  it('staff see everything, and only staff see notes', async () => {
    expect(await count(staff, 'store_note')).toBe(2)
    expect(await count(staff, 'partner_user')).toBeGreaterThan(10)
  })

  it('nobody is both the merchant staff and a supplier in one store', async () => {
    const user = await as(staff, (tx) => insertUser(tx, { partnerId: a, email: 'both@juniper.example', name: 'Both', status: 'active' }))
    await as(staff, (tx) => insertMembership(tx, { userId: user, storeId: storeA, role: 'staff', status: 'active' }))
    await expect(as(staff, (tx) => insertMembership(tx, { userId: user, storeId: storeA, sellerId: sellerA, role: 'supplier-member', status: 'active' }))).rejects.toThrow(/never both/)
  })

  it('an address is one account whatever its case', async () => {
    await expect(as(staff, (tx) => insertUser(tx, { partnerId: a, email: 'ANJALI@juniperco.example', name: 'Dup', status: 'active' }))).rejects.toThrow(/user_email_key/)
    await expect(as(staff, (tx) => insertPartnerUser(tx, { partnerId: a, email: 'MAYA@northstar.example', name: 'Dup', role: 'partner-admin', status: 'invited' }))).rejects.toThrow(/partner_user_email_key/)
  })

  it('a membership never crosses partners or stores', async () => {
    const userB = await as(staff, (tx) => insertUser(tx, { partnerId: b, email: 'cross@example.com', name: 'Cross', status: 'active' }))
    await expect(as(staff, (tx) => insertMembership(tx, { userId: userB, storeId: storeA, role: 'staff', status: 'active' }))).rejects.toThrow(/another partner/)
    const sellerB = await idOf('seller', 'Kaveri Weaves')
    const userA = await as(staff, (tx) => insertUser(tx, { partnerId: a, email: 'cross-a@example.com', name: 'Cross A', status: 'active' }))
    await expect(as(staff, (tx) => insertMembership(tx, { userId: userA, storeId: storeA, sellerId: sellerB, role: 'supplier-member', status: 'active' }))).rejects.toThrow(/another store/)
  })

  it('a store code is unique per partner, not globally', async () => {
    const plan = (await as(staff, (tx) => selectPlans(tx, b)))[0]
    await expect(as(staff, (tx) => insertStore(tx, { partnerId: b, name: 'Juniper copy', code: 'juniper-co', planId: plan?.id ?? null }))).resolves.toBeTruthy()
    await expect(as(staff, (tx) => insertStore(tx, { partnerId: a, name: 'Juniper copy', code: 'juniper-co' }))).rejects.toThrow(/store_code_key/)
  })

  it('a partner-scope insert of its own partner data works, through the same helpers the seed uses', async () => {
    await expect(as(partner(a), (tx) => upsertSetupItem(tx, { partnerId: a, item: 'legal', status: 'done', doneAt: now, doneByKind: 'partner_user', doneByLabel: 'Maya Chen' }))).resolves.toBeUndefined()
    // A partner adds an address but never writes its status (0020): only the check does.
    await expect(as(partner(a), (tx) => upsertPartnerDomain(tx, { partnerId: a, kind: 'email', host: 'mail.northstar.example', status: 'live', recordType: 'TXT', expected: 'x' }))).rejects.toThrow(/permission denied/i)
    await expect(as(partner(a), (tx) => insertPartner(tx, { name: 'Another' }))).rejects.toThrow(/permission denied/i)
  })
})

import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { platformSchema } from '#apis/platform/schema'
import type { PartnerCaller } from '#auth/partnerCaller'
import type { PartnerRole } from '#auth/partnerPermissions'
import { activityLog } from '#saas/activity/index'
import { createPartnerBrandingService, type BrandingInput } from '#saas/partnerBranding/index'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #162: Branding on the Platform API over the seeded Northstar (published) and Kaufladen (draft).

let db: TestDatabase
const now = new Date('2026-10-03T09:00:00Z')
const ids = { ns: '', kl: '' }
const facts = { requestId: 'r', ip: '203.0.113.9', userAgent: 'test' }

const callerOf = (partnerId: string, role: PartnerRole, name = 'Maya Chen'): PartnerCaller => ({
  user: { id: crypto.randomUUID(), name, email: 'maya@northstar.example', role },
  partner: { id: partnerId, name: 'Partner', product: 'Shops', host: null, state: 'live' },
})
const serviceFor = (caller: PartnerCaller) => createPartnerBrandingService({ sql: db.sql, caller, facts, activity: activityLog, now: () => now })

const run = async <T>(source: string, caller: PartnerCaller, variables: Record<string, unknown> = {}) => {
  const result = await graphql({ schema: platformSchema as GraphQLSchema, source, variableValues: variables, contextValue: { caller, console: null, plans: null, branding: serviceFor(caller) } })
  const error = result.errors?.[0]
  if (error && error.extensions['code'] === undefined) throw error
  return { data: (result.data ?? null) as T | null, code: error?.extensions['code'] as string | undefined }
}

const brandingQuery = `{ branding { look { productName primary accent font corner background files { logoLight logoDark mark favicon } }
  words { supportEmail supportUrl helpUrl termsUrl privacyUrl dpaUrl impressum poweredBy }
  published affects contrast { passes fix pairs { key ratio passes } } poweredByRule impressumRequired dpaRequired permission { allowed reason } } }`
type B = { branding: BrandingInput & { published: boolean; affects: number; contrast: { passes: boolean }; poweredByRule: string; impressumRequired: boolean; dpaRequired: boolean; permission: { allowed: boolean } } }

const current = async (partnerId: string): Promise<BrandingInput> => {
  const b = (await run<B>(brandingQuery, callerOf(partnerId, 'partner-owner'))).data?.branding
  if (!b) throw new Error('no branding')
  return { look: b.look, words: b.words }
}

beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db.url, now)
  ids.ns = (await db.sql<{ id: string }[]>`select id from partner where name = 'Northstar Commerce'`)[0]?.id ?? ''
  ids.kl = (await db.sql<{ id: string }[]>`select id from partner where name = 'Kaufladen Digital'`)[0]?.id ?? ''
  // The seed's keys are the prototype's names; publish takes keys under the partner's own prefix.
  for (const id of [ids.ns, ids.kl]) {
    await db.sql`
      update partner_branding set logo_light_key = 'partners/' || partner_id || '/brand/logo.svg', logo_dark_key = 'partners/' || partner_id || '/brand/logo-dark.svg',
        mark_key = 'partners/' || partner_id || '/brand/mark.svg', favicon_key = 'partners/' || partner_id || '/brand/favicon.png'
      where partner_id = ${id}
    `
  }
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('branding', () => {
  it('shows Northstar its live look, how many stores a publish affects, and that it may remove "Powered by"', async () => {
    const b = (await run<B>(brandingQuery, callerOf(ids.ns, 'partner-read-only'))).data?.branding
    const [stores] = await db.sql<{ n: number }[]>`select count(*)::int as n from store where partner_id = ${ids.ns} and status <> 'closed'`
    expect(b).toMatchObject({ published: true, affects: stores?.n, contrast: { passes: true }, poweredByRule: 'choice', impressumRequired: false, dpaRequired: false, permission: { allowed: false } })
    expect(b?.look.primary).toBe('#0F5E63')
  })

  it('shows Kaufladen its draft, "Powered by" fixed on by contract, and the Impressum and DPA still needed', async () => {
    const b = (await run<B>(brandingQuery, callerOf(ids.kl, 'partner-owner'))).data?.branding
    expect(b).toMatchObject({ published: false, poweredByRule: 'fixedOn', impressumRequired: true, dpaRequired: true, permission: { allowed: true } })
  })

  it('checks contrast with the same function the publish uses', async () => {
    const check = async (primary: string, accent: string) =>
      (await run<{ checkContrast: { passes: boolean; fix: string | null; pairs: { ratio: string }[] } }>('query($p: String!, $a: String!) { checkContrast(primary: $p, accent: $a) { passes fix pairs { ratio } } }', callerOf(ids.ns, 'partner-owner'), { p: primary, a: accent })).data?.checkContrast
    expect(await check('#0F5E63', '#E8C9A0')).toMatchObject({ passes: true, fix: null, pairs: [{ ratio: '7.5:1' }, {}] })
    expect((await check('#9ACDD6', '#E8C9A0'))?.fix).toMatch(/try a darker primary/)
  })
})

describe('publishBranding refusals', () => {
  it('refuses each with its own code', async () => {
    const ns = await current(ids.ns)
    const kl = await current(ids.kl)
    const owner = serviceFor(callerOf(ids.ns, 'partner-owner'))
    expect(await serviceFor(callerOf(ids.ns, 'partner-finance')).publishBranding(ns)).toEqual({ ok: false, reason: 'OWNERS_AND_ADMINS_ONLY' })
    expect(await owner.publishBranding({ ...ns, words: { ...ns.words, supportEmail: 'not an email' } })).toEqual({ ok: false, reason: 'INVALID_INPUT', field: 'words.supportEmail' })
    expect(await owner.publishBranding({ ...ns, look: { ...ns.look, files: { ...ns.look.files, logoLight: `partners/${ids.kl}/brand/logo.svg` } } })).toEqual({ ok: false, reason: 'INVALID_INPUT', field: 'look.files.logoLight' })
    expect(await owner.publishBranding({ ...ns, look: { ...ns.look, files: { ...ns.look.files, mark: 'https://evil.example/mark.svg' } } })).toMatchObject({ ok: false, reason: 'INVALID_INPUT', field: 'look.files.mark' })
    expect(await owner.publishBranding({ ...ns, look: { ...ns.look, primary: '#9ACDD6' } })).toMatchObject({ ok: false, reason: 'CONTRAST_FAILS', fix: expect.stringContaining('try a darker primary') })
    for (const link of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'http://northstar.example/terms']) {
      expect(await owner.publishBranding({ ...ns, words: { ...ns.words, termsUrl: link } })).toEqual({ ok: false, reason: 'INVALID_INPUT', field: 'words.termsUrl' })
    }
    expect(await owner.publishBranding({ ...ns, look: { ...ns.look, files: { ...ns.look.files, logoDark: `partners/${ids.ns}/../${ids.kl}/brand/logo.svg` } } })).toMatchObject({ ok: false, reason: 'INVALID_INPUT', field: 'look.files.logoDark' })
    const kaufladen = serviceFor(callerOf(ids.kl, 'partner-owner', 'Jonas Weber'))
    expect(await kaufladen.publishBranding({ ...kl, words: { ...kl.words, poweredBy: false, impressum: 'Kaufladen Digital GmbH, Berlin' } })).toEqual({ ok: false, reason: 'POWERED_BY_FIXED_BY_CONTRACT' })
    expect(await kaufladen.publishBranding(kl)).toEqual({ ok: false, reason: 'IMPRESSUM_REQUIRED' })
    expect((await run('mutation($i: BrandingInput!) { publishBranding(input: $i) { ok } }', callerOf(ids.ns, 'partner-support'), { i: ns })).code).toBe('FORBIDDEN')
  })
})

describe('publishing', () => {
  it('publishes what it read back, files not uploaded yet included, and two first publishes at once both answer', async () => {
    const [p] = await db.sql<{ id: string }[]>`insert into partner (name, country) values ('Fresh Partner', 'US') returning id`
    const pid = p?.id ?? ''
    const base = await current(ids.ns)
    // No contract yet, so "Powered by" stays on.
    const input = { look: { ...base.look, files: { logoLight: '', logoDark: '', mark: '', favicon: '' } }, words: { ...base.words, poweredBy: true } }
    const fresh = serviceFor(callerOf(pid, 'partner-owner'))
    const results = await Promise.all([fresh.publishBranding(input), fresh.publishBranding(input)])
    expect(results.map((r) => r.ok)).toEqual([true, true])
    const back = await serviceFor(callerOf(pid, 'partner-owner')).branding()
    expect(back?.look.files).toEqual({ logoLight: '', logoDark: '', mark: '', favicon: '' })
    expect(await fresh.publishBranding({ look: back?.look ?? input.look, words: back?.words ?? input.words })).toMatchObject({ ok: true })
  })

  it('puts Legal pages back to missing when a publish drops a page', async () => {
    const ns = await current(ids.ns)
    expect(await serviceFor(callerOf(ids.ns, 'partner-owner')).publishBranding({ ...ns, words: { ...ns.words, dpaUrl: '' } })).toMatchObject({ ok: true })
    expect(await db.sql`select status, detail from partner_setup_item where partner_id = ${ids.ns} and item = 'legal'`).toEqual([{ status: 'missing', detail: 'Data-processing agreement missing' }])
    expect(await serviceFor(callerOf(ids.ns, 'partner-owner')).publishBranding(ns)).toMatchObject({ ok: true })
  })

  it('adds a version with who and when, keeps the last readable, marks the checklist, mirrors the partner, queues the purge and logs once', async () => {
    const ns = await current(ids.ns)
    const result = await serviceFor(callerOf(ids.ns, 'partner-admin', 'Diego Alvarez')).publishBranding({ ...ns, look: { ...ns.look, productName: 'Northstar Stores', accent: '#E0C090' }, words: { ...ns.words, poweredBy: true } })
    expect(result).toMatchObject({ ok: true })
    const versions = await db.sql<{ product_name: string; published_by_label: string }[]>`select product_name, published_by_label from partner_branding where partner_id = ${ids.ns} and state = 'published' order by published_at desc limit 1`
    expect(versions).toEqual([{ product_name: 'Northstar Stores', published_by_label: 'Diego Alvarez' }])
    expect((await db.sql`select 1 from partner_branding where partner_id = ${ids.ns} and state = 'published' and product_name = 'Northstar Shops'`).length).toBeGreaterThan(0)
    expect(await db.sql`select product_name, accent_color, powered_by from partner where id = ${ids.ns}`).toEqual([{ product_name: 'Northstar Stores', accent_color: '#E0C090', powered_by: 'on' }])
    expect(await db.sql`select status, done_by_label from partner_setup_item where partner_id = ${ids.ns} and item = 'branding'`).toEqual([{ status: 'done', done_by_label: 'Diego Alvarez' }])
    expect((await db.sql`select 1 from outbox where kind = 'cache.purge' and partner_id = ${ids.ns} and payload->>'reason' = 'branding' and payload->>'partnerId' = ${ids.ns}`).length).toBeGreaterThan(0)
    expect((await db.sql`select 1 from activity_log where action = 'branding.published' and actor_label like 'Diego Alvarez%'`).length).toBe(1)
  })

  it('publishes Kaufladen with its Impressum and DPA, marks Legal pages, and leaves Northstar untouched', async () => {
    const before = await db.sql`select id, product_name from partner_branding where partner_id = ${ids.ns} order by id`
    const kl = await current(ids.kl)
    const words = { ...kl.words, impressum: 'Kaufladen Digital GmbH, Torstraße 140, 10119 Berlin', dpaUrl: 'https://kaufladen.example/avv' }
    expect(await serviceFor(callerOf(ids.kl, 'partner-owner', 'Jonas Weber')).publishBranding({ ...kl, words })).toMatchObject({ ok: true })
    expect(await db.sql`select status from partner_setup_item where partner_id = ${ids.kl} and item = 'legal'`).toEqual([{ status: 'done' }])
    expect((await run<B>(brandingQuery, callerOf(ids.kl, 'partner-owner'))).data?.branding).toMatchObject({ published: true, dpaRequired: false })
    expect(await db.sql`select id, product_name from partner_branding where partner_id = ${ids.ns} order by id`).toEqual(before)
  })
})

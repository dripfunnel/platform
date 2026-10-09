import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { platformSchema } from '#apis/platform/schema'
import type { PartnerCaller } from '#auth/partnerCaller'
import type { PartnerRole } from '#auth/partnerPermissions'
import { withScope } from '#db/scoped/index'
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
  role,
  user: { id: crypto.randomUUID(), name, email: 'maya@northstar.example' },
  staff: null,
  partner: { id: partnerId, name: 'Partner', product: 'Shops', host: null, state: 'live' },
})
const serviceFor = (caller: PartnerCaller) => createPartnerBrandingService({ sql: db.sql, caller, facts, activity: activityLog })

const run = async <T>(source: string, caller: PartnerCaller, variables: Record<string, unknown> = {}) => {
  const result = await graphql({ schema: platformSchema as GraphQLSchema, source, variableValues: variables, contextValue: { caller, console: null, plans: null, branding: serviceFor(caller) } })
  const error = result.errors?.[0]
  if (error && error.extensions['code'] === undefined) throw error
  return { data: (result.data ?? null) as T | null, code: error?.extensions['code'] as string | undefined }
}

const brandingQuery = `{ branding { look { productName primary accent font corner background files { logoLight logoDark mark favicon appIcon appIconForeground splash } }
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
}, 120_000)

describe('the seed', () => {
  // Publish refuses a key outside the partner's own prefix, so the seed's must already be inside it.
  it('keys every brand file under its partner', async () => {
    for (const id of [ids.ns, ids.kl]) {
      const { appIcon, appIconForeground, splash, ...logos } = (await current(id)).look.files
      for (const key of Object.values(logos)) expect(key.startsWith(`partners/${id}/`)).toBe(true)
      expect([appIcon, appIconForeground, splash]).toEqual(['', '', ''])
    }
  })
})

describe('a partner that has never saved a look', () => {
  it('reads a first draft from its own name and colours, unpublished, with its rules and permission', async () => {
    const [p] = await db.sql<{ id: string }[]>`insert into partner (name, country, product_name, primary_color, accent_color) values ('Neuer Partner', 'DE', 'Neu Shops', '#123456', '#FEDCBA') returning id`
    const pid = p?.id ?? ''
    const first = (await run<B>(brandingQuery, callerOf(pid, 'partner-owner'))).data?.branding
    expect(first).toMatchObject({ published: false, impressumRequired: true, poweredByRule: 'fixedOn', permission: { allowed: true } })
    expect(first?.look).toMatchObject({ productName: 'Neu Shops', primary: '#123456', accent: '#FEDCBA', files: { logoLight: '', logoDark: '', mark: '', favicon: '' } })
    expect(first?.words.poweredBy).toBe(true)
    expect((await run<B>(brandingQuery, callerOf(pid, 'partner-finance'))).data?.branding.permission).toEqual({ allowed: false, reason: 'OWNERS_AND_ADMINS_ONLY' })
  })

  it('starts from DripFunnel’s colours, which pass the contrast check, when the partner has none', async () => {
    const [p] = await db.sql<{ id: string }[]>`insert into partner (name, country) values ('Plain Partner', 'US') returning id`
    const first = (await run<B>(brandingQuery, callerOf(p?.id ?? '', 'partner-owner'))).data?.branding
    expect(first?.look).toMatchObject({ productName: 'Plain Partner', primary: '#4A1B0C', accent: '#EC844F' })
    expect(first?.contrast.passes).toBe(true)
  })
})

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
    expect(await owner.publishBranding({ ...ns, look: { ...ns.look, files: { ...ns.look.files, appIcon: `partners/${ids.kl}/brand/icon.png` } } })).toEqual({ ok: false, reason: 'INVALID_INPUT', field: 'look.files.appIcon' })
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
    const input = { look: { ...base.look, files: { logoLight: '', logoDark: '', mark: '', favicon: '', appIcon: '', appIconForeground: '', splash: '' } }, words: { ...base.words, poweredBy: true } }
    const fresh = serviceFor(callerOf(pid, 'partner-owner'))
    const results = await Promise.all([fresh.publishBranding(input), fresh.publishBranding(input)])
    expect(results.map((r) => r.ok)).toEqual([true, true])
    const back = await serviceFor(callerOf(pid, 'partner-owner')).branding()
    expect(back?.look.files).toEqual({ logoLight: '', logoDark: '', mark: '', favicon: '', appIcon: '', appIconForeground: '', splash: '' })
    expect(await fresh.publishBranding({ look: back?.look ?? input.look, words: back?.words ?? input.words })).toMatchObject({ ok: true })
  })

  it('publishes the mobile app images with the draft, keeps the version before them, and leaves them as they were when a publish is refused', async () => {
    const ns = await current(ids.ns)
    const app = { appIcon: `partners/${ids.ns}/brand/icon.png`, appIconForeground: `partners/${ids.ns}/brand/fg.png`, splash: `partners/${ids.ns}/brand/splash.png` }
    const owner = serviceFor(callerOf(ids.ns, 'partner-owner'))
    expect(await owner.publishBranding({ ...ns, look: { ...ns.look, files: { ...ns.look.files, ...app } } })).toMatchObject({ ok: true })
    expect((await current(ids.ns)).look.files).toMatchObject(app)
    const live = db.sql`select app_icon_key, app_icon_foreground_key, splash_key from partner_branding where partner_id = ${ids.ns} and state = 'published' order by published_at desc, id desc`
    const [newest, before] = await live
    expect(newest).toEqual({ app_icon_key: app.appIcon, app_icon_foreground_key: app.appIconForeground, splash_key: app.splash })
    expect(before).toEqual({ app_icon_key: null, app_icon_foreground_key: null, splash_key: null })

    const refused = { ...ns, look: { ...ns.look, primary: '#9ACDD6', files: { ...ns.look.files, appIcon: '', splash: '' } } }
    expect(await owner.publishBranding(refused)).toMatchObject({ ok: false, reason: 'CONTRAST_FAILS' })
    expect((await current(ids.ns)).look.files).toMatchObject(app)
    expect(await owner.publishBranding(ns)).toMatchObject({ ok: true })
    expect((await current(ids.ns)).look.files).toMatchObject({ appIcon: '', appIconForeground: '', splash: '' })
  })

  it('takes a publish from a console that sends no mobile app images, and leaves them empty', async () => {
    const { look, words } = await current(ids.ns)
    const files = { logoLight: look.files.logoLight, logoDark: look.files.logoDark, mark: look.files.mark, favicon: look.files.favicon }
    const { data } = await run<{ publishBranding: { ok: boolean } }>('mutation($i: BrandingInput!) { publishBranding(input: $i) { ok } }', callerOf(ids.ns, 'partner-owner'), { i: { look: { ...look, files }, words } })
    expect(data?.publishBranding.ok).toBe(true)
    expect((await current(ids.ns)).look.files).toMatchObject({ appIcon: '', appIconForeground: '', splash: '' })
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

  it('holds "Powered by" to the contract at the database, whoever writes it', async () => {
    const as = (partnerId: string, value: string) =>
      withScope(db.sql, { caller: { kind: 'partner-user', partnerUserId: 'pu' }, partnerId }, (tx) => tx`update partner set powered_by = ${value} where id = ${partnerId} returning powered_by`)
    await expect(as(ids.kl, 'off')).rejects.toThrow(/fixed by the contract/)
    const [house] = await db.sql<{ id: string }[]>`select id from partner where powered_by = 'house' limit 1`
    if (house) await expect(as(house.id, 'on')).rejects.toThrow(/fixed by the contract/)
    await expect(as(ids.ns, 'house')).rejects.toThrow(/fixed by the contract/)
    expect(await as(ids.ns, 'off')).toEqual([{ powered_by: 'off' }])
    await db.sql`update partner set powered_by = 'on' where id = ${ids.ns}`
  })

  it('holds a published version’s "Powered by" to the contract at the database', async () => {
    const scope = { caller: { kind: 'partner-user' as const, partnerUserId: 'pu' }, partnerId: ids.kl }
    const [draft] = await db.sql<{ id: string }[]>`
      insert into partner_branding
      select (jsonb_populate_record(null::partner_branding, to_jsonb(b) || jsonb_build_object('id', gen_random_uuid(), 'state', 'draft', 'published_at', null, 'published_by_label', null))).*
      from partner_branding b where b.partner_id = ${ids.kl} and b.state = 'published' order by b.published_at desc limit 1
      returning id`
    await withScope(db.sql, scope, (tx) => tx`update partner_branding set powered_by = false where id = ${draft?.id ?? ''}`)
    await expect(
      withScope(db.sql, scope, (tx) => tx`update partner_branding set state = 'published', published_at = now() + interval '1 minute', published_by_label = 'x' where id = ${draft?.id ?? ''}`),
    ).rejects.toThrow(/fixed by the contract/)
    await db.sql`update partner_branding set powered_by = true where id = ${draft?.id ?? ''}`
  })
})

describe('isolation and access', () => {
  it('answers a signed-out caller UNAUTHENTICATED and each partner with only its own branding', async () => {
    const signedOut = await graphql({ schema: platformSchema as GraphQLSchema, source: brandingQuery, contextValue: { caller: null, console: null, plans: null, branding: null } })
    expect(signedOut.errors?.[0]?.extensions['code']).toBe('UNAUTHENTICATED')
    const ns = (await run<B>(brandingQuery, callerOf(ids.ns, 'partner-read-only'))).data?.branding
    const kl = (await run<B>(brandingQuery, callerOf(ids.kl, 'partner-read-only'))).data?.branding
    expect(ns?.look.productName).toMatch(/^Northstar/)
    expect(kl?.look.productName).toMatch(/^Kaufladen/)
    expect(JSON.stringify(kl)).not.toContain('northstar')
  })

  it('refuses every role without branding.write at the policy, and a partner’s publish never writes another’s rows', async () => {
    const ns = (await run<B>(brandingQuery, callerOf(ids.ns, 'partner-owner'))).data?.branding
    const input = { look: ns?.look, words: ns?.words }
    for (const role of ['partner-support', 'partner-finance', 'partner-read-only'] as const) {
      expect((await run('mutation($i: BrandingInput!) { publishBranding(input: $i) { ok } }', callerOf(ids.ns, role), { i: input })).code, role).toBe('FORBIDDEN')
    }
    const before = await db.sql`select id, state, product_name from partner_branding where partner_id = ${ids.ns} order by id`
    await run('mutation($i: BrandingInput!) { publishBranding(input: $i) { ok } }', callerOf(ids.kl, 'partner-owner'), { i: input })
    expect(await db.sql`select id, state, product_name from partner_branding where partner_id = ${ids.ns} order by id`).toEqual(before)
  })
})

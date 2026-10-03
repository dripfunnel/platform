import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CallerContext } from '#core/tenancy'
import { insertBranding, selectBranding, type BrandingFields } from '#db/scoped/branding'
import { withScope, type ScopedSql } from '#db/scoped/index'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #211: the partner's look and words, a draft and published versions.

let db: TestDatabase
const now = new Date('2026-10-03T09:00:00Z')
const ids = { ns: '', kl: '', store: '' }

const partner = (partnerId: string): CallerContext => ({ caller: { kind: 'partner-user', partnerUserId: 'pu' }, partnerId })
const staff: CallerContext = { caller: { kind: 'staff', staffId: 'st' } }
const as = <T>(context: CallerContext, work: (tx: ScopedSql) => Promise<T>) => withScope(db.sql, context, work)

const look: BrandingFields = {
  product_name: 'Northstar Shops', primary_color: '#0F5E63', accent_color: '#E8C9A0', font: 'Nunito', corner: 'rounded', background: 'sand',
  logo_light_key: null, logo_dark_key: null, mark_key: null, favicon_key: null, support_email: 'help@northstar.example', support_url: null,
  help_url: null, terms_url: null, privacy_url: null, dpa_url: null, impressum: null, powered_by: false,
}

beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db.url, now)
  ids.ns = (await db.sql<{ id: string }[]>`select id from partner where name = 'Northstar Commerce'`)[0]?.id ?? ''
  ids.kl = (await db.sql<{ id: string }[]>`select id from partner where name = 'Kaufladen Digital'`)[0]?.id ?? ''
  ids.store = (await db.sql<{ id: string }[]>`select id from store where partner_id = ${ids.ns} limit 1`)[0]?.id ?? ''
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('the seeded branding', () => {
  it('has Northstar’s look published and Kaufladen’s only as a draft with no Impressum', async () => {
    const ns = await as(partner(ids.ns), (tx) => selectBranding(tx, ids.ns, now))
    expect(ns.live).toMatchObject({ product_name: 'Northstar Shops', primary_color: '#0F5E63', font: 'Nunito', powered_by: false })
    expect(ns.draft).toBeNull()
    const kl = await as(partner(ids.kl), (tx) => selectBranding(tx, ids.kl, now))
    expect(kl.live).toBeNull()
    expect(kl.draft).toMatchObject({ product_name: 'Kaufladen Shops', impressum: null, powered_by: true })
  })
})

describe('who reads and writes it', () => {
  it('shows a partner only its own, a merchant none, staff every partner’s', async () => {
    expect(await as(partner(ids.kl), (tx) => selectBranding(tx, ids.ns, now))).toEqual({ live: null, draft: null })
    const merchant: CallerContext = { caller: { kind: 'person', userId: 'u', sessionId: 's' }, partnerId: ids.ns, storeId: ids.store, sellerScope: { kind: 'all' }, subscription: 'active' }
    await expect(as(merchant, (tx) => tx`select id from partner_branding`)).rejects.toThrow(/permission denied/i)
    const partners = await as(staff, (tx) => tx<{ n: number }[]>`select count(distinct partner_id)::int as n from partner_branding`)
    expect(partners[0]?.n).toBe(2)
  })

  it('keeps one draft per partner, publishes it once, and never rewrites a published version', async () => {
    const draft = await as(partner(ids.ns), (tx) => insertBranding(tx, { ...look, product_name: 'Northstar Stores', partnerId: ids.ns, state: 'draft', by: { kind: 'partner_user', label: 'Maya Chen' } }))
    await expect(as(partner(ids.ns), (tx) => insertBranding(tx, { ...look, partnerId: ids.ns, state: 'draft', by: { kind: 'partner_user', label: 'Maya Chen' } }))).rejects.toThrow(/partner_branding_draft_key/)
    const published = await as(partner(ids.ns), (tx) => tx`update partner_branding set state = 'published', published_at = now(), published_by_label = 'Maya Chen' where id = ${draft} returning id`)
    expect(published).toHaveLength(1)
    for (const context of [partner(ids.ns), staff]) {
      expect(await as(context, (tx) => tx`update partner_branding set product_name = 'Rewritten' where id = ${draft} returning id`)).toEqual([])
    }
    expect((await as(partner(ids.ns), (tx) => selectBranding(tx, ids.ns, new Date()))).live?.product_name).toBe('Northstar Stores')
  })

  it('lets a partner write only its own, under its own name, and never another partner’s', async () => {
    await expect(as(partner(ids.ns), (tx) => insertBranding(tx, { ...look, partnerId: ids.kl, state: 'draft', by: { kind: 'partner_user', label: 'x' } }))).rejects.toThrow(/row-level security/i)
    await expect(as(partner(ids.kl), (tx) => insertBranding(tx, { ...look, partnerId: ids.kl, state: 'draft', by: { kind: 'staff', label: 'DripFunnel' } }))).rejects.toThrow(/row-level security/i)
    expect(await as(partner(ids.ns), (tx) => tx`update partner_branding set impressum = 'x' where partner_id = ${ids.kl} returning id`)).toEqual([])
  })
})

describe('publishing, scheduling and cancelling', () => {
  it('lets no request insert a published version, back-date a publish, or change a live one', async () => {
    await expect(as(partner(ids.kl), (tx) => insertBranding(tx, { ...look, partnerId: ids.kl, state: 'published', publishedAt: new Date(Date.now() + 86_400_000), by: { kind: 'partner_user', label: 'x' } }))).rejects.toThrow(/starts as a draft/)
    await expect(as(partner(ids.kl), (tx) => tx`update partner_branding set state = 'published', published_at = now() - interval '1 day', published_by_label = 'x' where partner_id = ${ids.kl} and state = 'draft'`)).rejects.toThrow(/published now or later/)
  })

  it('cancels a scheduled version, and only that', async () => {
    const later = new Date(Date.now() + 7 * 86_400_000)
    const scheduled = await as(partner(ids.kl), async (tx) => {
      await tx`update partner_branding set state = 'published', published_at = ${later}, published_by_label = 'Jonas Weber' where partner_id = ${ids.kl} and state = 'draft'`
      return (await tx<{ id: string }[]>`select id from partner_branding where partner_id = ${ids.kl} and published_at = ${later}`)[0]?.id ?? ''
    })
    expect((await as(partner(ids.kl), (tx) => selectBranding(tx, ids.kl, new Date()))).live).toBeNull()
    await expect(as(partner(ids.kl), (tx) => tx`update partner_branding set product_name = 'Changed', state = 'cancelled' where id = ${scheduled}`)).rejects.toThrow(/never changed, only a scheduled one cancelled/)
    expect(await as(partner(ids.kl), (tx) => tx`update partner_branding set state = 'cancelled' where id = ${scheduled} returning state`)).toEqual([{ state: 'cancelled' }])
    expect(await as(partner(ids.kl), (tx) => tx`update partner_branding set state = 'published' where id = ${scheduled} returning id`)).toEqual([])
  })
})

describe('what a version holds', () => {
  it('refuses a colour that is not a hex value, a font outside the list, and a published row without who and when', async () => {
    const [draft] = await db.sql<{ id: string }[]>`
      insert into partner_branding (partner_id, state, product_name, primary_color, accent_color, font, corner, background, created_by_kind, created_by_label)
      values (${ids.kl}, 'draft', 'Kaufladen Shops', '#1F3A5F', '#F2B134', 'Nunito', 'soft', 'plain', 'staff', 'x') returning id
    `
    const raw = (set: string) => db.sql.unsafe(`update partner_branding set ${set} where id = '${draft?.id ?? ''}'`)
    await expect(raw(`primary_color = 'teal'`)).rejects.toThrow(/partner_branding_primary_color_check/)
    await expect(raw(`font = 'Comic Sans'`)).rejects.toThrow(/partner_branding_font_check/)
    await expect(raw(`state = 'cancelled'`)).rejects.toThrow(/partner_branding_published/)
  })
})

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { withSystemScope } from '#db/scoped/index'
import { storeContentPaths } from '#engine/modules/content/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'
import { seedStoreWorld, type StoreWorld, type Who } from './support/storeWorld'

// Card #338 (SAPI 24), part 1: content pages and blog posts on the Store API, the one namespace of a store's paths
// (storefront ARCHITECTURE §3.1), the redirect a rename leaves, and the paths service the validator's context reads.

let db: TestDatabase
let t: Tenants
let w: StoreWorld
// A second passes with every reading, so each save is later than the last and lists sort as written.
let clock = new Date('2026-10-11T09:00:00.000Z')
const now = () => (clock = new Date(clock.getTime() + 1000))

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  w = await seedStoreWorld(db.sql, t, { now, secrets: null, lookup: null })
  await db.sql`insert into store_language (store_id, language) values (${t.storeA1}, 'hi-IN')`
  await db.sql`update storefront set custom_paths = '{/our-story,/lookbook-spring}' where store_id = ${t.storeA1}`
  await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, enabled) select plan_id, partner_id, 1, 'blog', true from store_subscription where store_id = ${t.storeA1}`
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

interface Entry {
  id: string
  kind: string
  title: string
  slug: string
  path: string
  status: string
  publishAt: string | null
  waitingForPublish: boolean
  revision: number
  body: { kind: string; text: string | null; assetId: string | null; items: { question: string; answer: string }[] | null; productIds: string[] | null }[]
}
const fields = 'id kind title slug path status publishAt waitingForPublish revision body { kind text assetId items { question answer } productIds }'

const savePage = async (who: Who, input: Record<string, unknown>, id?: string, revision?: number) => {
  const r = await w.gql(who, `mutation S($id: ID, $revision: Int, $input: ContentPageInput!) { saveContentPage(id: $id, revision: $revision, input: $input) { ${fields} } }`, { id, revision, input: { body: [], publish: true, ...input } })
  return { entry: r.data?.['saveContentPage'] as Entry | undefined, code: r.code, r }
}
const savePost = async (who: Who, input: Record<string, unknown>, id?: string, revision?: number) => {
  const r = await w.gql(who, `mutation S($id: ID, $revision: Int, $input: BlogPostInput!) { saveBlogPost(id: $id, revision: $revision, input: $input) { ${fields} } }`, { id, revision, input: { body: [], publish: true, ...input } })
  return { entry: r.data?.['saveBlogPost'] as Entry | undefined, code: r.code }
}
const refusal = async (who: Who, input: Record<string, unknown>, id?: string, revision?: number) => {
  const r = await w.gql(who, `mutation S($id: ID, $revision: Int, $input: ContentPageInput!) { saveContentPage(id: $id, revision: $revision, input: $input) { id } }`, { id, revision, input: { body: [], publish: true, ...input } })
  return r.code
}
const pathTaken = async (input: Record<string, unknown>) => {
  const r = await w.gql('owner', 'mutation S($input: ContentPageInput!) { saveContentPage(input: $input) { id } }', { input: { body: [], publish: false, ...input } })
  return { code: r.code, path: r.extensions?.['path'], heldBy: r.extensions?.['heldBy'] }
}
const redirects = async (storeId: string) =>
  db.sql<{ from_path: string; to_path: string; reason: string }[]>`select from_path, to_path, reason from storefront_redirect where store_id = ${storeId} order by from_path`

describe('content pages', () => {
  it('the Owner writes a page; the Manager reads it; Staff, a supplier and the Manager writing are refused', async () => {
    const saved = await savePage('owner', {
      title: 'Questions we get asked',
      slug: 'faq',
      inMenu: true,
      body: [{ kind: 'heading', text: 'Questions' }, { kind: 'faq', items: [{ question: 'Do you gift-wrap?', answer: 'Yes.' }] }, { kind: 'form' }],
    })
    expect(saved.code).toBeUndefined()
    expect(saved.entry).toMatchObject({ kind: 'page', slug: 'faq', path: '/faq', status: 'published', publishAt: null, revision: 1, waitingForPublish: true })
    expect(saved.entry?.body.map((b) => b.kind)).toEqual(['heading', 'faq', 'form'])
    const list = await w.gql('manager', '{ contentPages { nodes { slug } } }')
    expect(list.data?.['contentPages']).toEqual({ nodes: [{ slug: 'faq' }] })
    expect((await w.gql('manager', '{ customPagePaths }')).data?.['customPagePaths']).toEqual(['/lookbook-spring', '/our-story'])
    for (const who of ['staff', 'supplier'] as const) {
      expect((await w.gql(who, '{ contentPages { nodes { slug } } }')).code).toBe('FORBIDDEN')
      expect((await w.gql(who, '{ customPagePaths }')).code).toBe('FORBIDDEN')
    }
    for (const who of ['manager', 'staff', 'supplier'] as const) expect(await refusal(who, { title: 'Mine', slug: 'mine' })).toBe('FORBIDDEN')
    const logged = await db.sql<{ action: string; target_label: string; reason: string }[]>`select action, target_label, reason from activity_log where store_id = ${t.storeA1} and action like 'content_page.%'`
    expect(logged).toEqual([{ action: 'content_page.saved', target_label: 'Questions we get asked', reason: 'published' }])
  })

  it('makes the address from the title, and keeps a draft off the shop with nothing waiting', async () => {
    const saved = await savePage('owner', { title: 'Caring for Linen!', publish: false })
    expect(saved.entry).toMatchObject({ slug: 'caring-for-linen', status: 'draft', waitingForPublish: false })
  })

  it('refuses an address a core route, a language, a market or the theme’s own page uses, naming what holds it', async () => {
    await db.sql`insert into market (store_id, name, countries, currency, language, web_mode, path_prefix) values (${t.storeA1}, 'US', '["US"]', 'INR', 'en-IN', 'path', 'us')`
    const cases: [string, string][] = [['cart', 'core'], ['blog', 'core'], ['products', 'core'], ['hi', 'language'], ['en-us', 'language'], ['en', 'language'], ['us', 'market'], ['our-story', 'custom_page']]
    for (const [slug, heldBy] of cases) expect(await pathTaken({ title: 'Taken', slug })).toEqual({ code: 'PATH_TAKEN', path: `/${slug}`, heldBy })
    // Another page of the store holds it too, whatever its state.
    expect(await pathTaken({ title: 'Again', slug: 'faq' })).toEqual({ code: 'PATH_TAKEN', path: '/faq', heldBy: 'content_page' })
    // So does a rename onto it.
    const other = await savePage('owner', { title: 'Shipping', slug: 'shipping' })
    const renamed = await w.gql('owner', 'mutation S($id: ID, $input: ContentPageInput!) { saveContentPage(id: $id, revision: 1, input: $input) { id } }', { id: other.entry?.id, input: { title: 'Shipping', slug: 'our-story', body: [], publish: true } })
    expect({ code: renamed.code, heldBy: renamed.extensions?.['heldBy'] }).toEqual({ code: 'PATH_TAKEN', heldBy: 'custom_page' })
    await w.gql('owner', `mutation { deleteContentPage(id: "${other.entry?.id}") }`)
    // Another store's page never does.
    expect((await savePage('bOwner', { title: 'FAQ', slug: 'faq' })).code).toBeUndefined()
  })

  it('leaves a redirect when a live page is renamed, and none for a draft', async () => {
    const live = await savePage('owner', { title: 'Lookbook', slug: 'lookbook' })
    const id = live.entry?.id ?? ''
    const renamed = await savePage('owner', { title: 'Lookbook', slug: 'autumn-lookbook' }, id, 1)
    expect(renamed.entry).toMatchObject({ path: '/autumn-lookbook', revision: 2 })
    expect(await redirects(t.storeA1)).toEqual([{ from_path: '/lookbook', to_path: '/autumn-lookbook', reason: 'renamed' }])
    // A second rename points the first redirect straight at the new address, and moving back takes the old one over.
    await savePage('owner', { title: 'Lookbook', slug: 'lookbook' }, id, 2)
    expect(await redirects(t.storeA1)).toEqual([{ from_path: '/autumn-lookbook', to_path: '/lookbook', reason: 'renamed' }])
    const draft = await savePage('owner', { title: 'Plans', slug: 'plans', publish: false })
    await savePage('owner', { title: 'Plans', slug: 'next-plans', publish: false }, draft.entry?.id, 1)
    expect((await redirects(t.storeA1)).map((r) => r.from_path)).toEqual(['/autumn-lookbook'])
    expect(await redirects(t.storeB1)).toEqual([])
  })

  it('refuses a stale revision, another store’s page, and a file or product that isn’t this store’s', async () => {
    const page = await savePage('owner', { title: 'About us', slug: 'about' })
    const id = page.entry?.id ?? ''
    expect(await refusal('owner', { title: 'About' }, id, 7)).toBe('STALE_REVISION')
    expect(await refusal('bOwner', { title: 'Mine now', slug: 'about' }, id, 1)).toBe('NOT_FOUND')
    expect((await w.gql('bOwner', `{ contentEntry(id: "${id}") { id } }`)).data?.['contentEntry']).toBeNull()
    expect((await w.gql('a2Owner', `mutation { deleteContentPage(id: "${id}") }`)).code).toBe('NOT_FOUND')
    const bFile = (await db.sql<{ id: string }[]>`insert into asset (store_id, r2_key, kind, mime, bytes, checksum) values (${t.storeB1}, ${`stores/${t.storeB1}/assets/00000000-0000-4000-8000-000000000001.png`}, 'image', 'image/png', 1, ${'0'.repeat(64)}) returning id`)[0]?.id
    expect(await refusal('owner', { title: 'About', body: [{ kind: 'image', assetId: bFile, alt: 'x' }] }, id, 1)).toBe('INVALID_INPUT')
    expect(await refusal('owner', { title: 'About', body: [{ kind: 'products', productIds: ['00000000-0000-4000-8000-000000000123'] }] }, id, 1)).toBe('INVALID_INPUT')
    expect(await refusal('owner', { title: 'About', body: [{ kind: 'heading', text: 'x', alt: 'not a heading’s' }] }, id, 1)).toBe('INVALID_INPUT')
    expect(await refusal('owner', { title: '   ' }, id, 1)).toBe('INVALID_INPUT')
  })

  it('deletes a page, freeing its address', async () => {
    const page = await savePage('owner', { title: 'Old sale', slug: 'old-sale' })
    expect((await w.gql('owner', `mutation { deleteContentPage(id: "${page.entry?.id}") }`)).data?.['deleteContentPage']).toBe(true)
    expect((await savePage('owner', { title: 'New sale', slug: 'old-sale' })).code).toBeUndefined()
  })

  it('refuses every write while the store is past due, and keeps reading', async () => {
    await db.sql`update store set status = 'past_due' where id = ${t.storeA1}`
    try {
      expect(await refusal('owner', { title: 'Late', slug: 'late' })).toBe('READ_ONLY')
      expect((await w.gql('owner', '{ contentPages(first: 1) { nodes { id } } }')).code).toBeUndefined()
    } finally {
      await db.sql`update store set status = 'active' where id = ${t.storeA1}`
    }
  })

  it('pages through the list newest first, at most 50 a page', async () => {
    const first = await w.gql('owner', '{ contentPages(first: 2) { nodes { slug } pageInfo { endCursor hasNextPage } } }')
    const page = first.data?.['contentPages'] as { nodes: { slug: string }[]; pageInfo: { endCursor: string; hasNextPage: boolean } }
    expect(page.nodes.map((n) => n.slug)).toEqual(['old-sale', 'about'])
    expect(page.pageInfo.hasNextPage).toBe(true)
    const next = await w.gql('owner', `{ contentPages(first: 2, after: "${page.pageInfo.endCursor}") { nodes { slug } } }`)
    expect((next.data?.['contentPages'] as { nodes: { slug: string }[] }).nodes.map((n) => n.slug)).toEqual(['next-plans', 'lookbook'])
    expect((await w.gql('owner', '{ contentPages(after: "nonsense") { nodes { slug } } }')).code).toBe('INVALID_CURSOR')
  })
})

describe('blog posts', () => {
  it('writes, schedules and publishes a post, by the plan’s blog switch', async () => {
    const later = new Date(clock.getTime() + 86_400_000).toISOString()
    const scheduled = await savePost('owner', { title: 'A capsule for fall', publishAt: later, author: 'Priya Shah', tags: ['fall', 'fall', 'capsule'], body: [{ kind: 'text', text: 'Five looks.' }] })
    expect(scheduled.entry).toMatchObject({ kind: 'post', slug: 'a-capsule-for-fall', path: '/blog/a-capsule-for-fall', status: 'scheduled', publishAt: later, waitingForPublish: false })
    const now = await savePost('owner', { title: 'Caring for linen' })
    expect(now.entry).toMatchObject({ status: 'published', waitingForPublish: true })
    expect(new Date(now.entry?.publishAt ?? '') <= clock).toBe(true)
    expect((await w.gql('owner', '{ blogPosts { nodes { slug } } }')).data?.['blogPosts']).toEqual({ nodes: [{ slug: 'a-capsule-for-fall' }, { slug: 'caring-for-linen' }] })
    // A post shares the store's paths with its pages, never another post's.
    expect((await savePost('owner', { title: 'Caring for linen' })).code).toBe('PATH_TAKEN')
    expect((await savePost('owner', { title: 'Contact', body: [{ kind: 'form' }] })).code).toBe('INVALID_INPUT')
    const [plan] = await db.sql<{ plan_id: string }[]>`select plan_id from store_subscription where store_id = ${t.storeA1}`
    await db.sql`update plan_entitlement set enabled = false where plan_id = ${plan?.plan_id ?? ''} and key = 'blog'`
    try {
      expect((await savePost('owner', { title: 'No blog' })).code).toBe('PLAN_LIMIT')
      expect((await w.gql('owner', `mutation { deleteBlogPost(id: "${now.entry?.id}") }`)).data?.['deleteBlogPost']).toBe(true)
    } finally {
      await db.sql`update plan_entitlement set enabled = true where plan_id = ${plan?.plan_id ?? ''} and key = 'blog'`
    }
    const logged = await db.sql<{ action: string }[]>`select action from activity_log where store_id = ${t.storeA1} and action like 'blog_post.%' order by occurred_at`
    expect(logged.map((l) => l.action)).toEqual(['blog_post.saved', 'blog_post.saved', 'blog_post.deleted'])
  })
})

describe('the paths service', () => {
  it('answers the store’s content and post paths, drafts included, and only that store’s', async () => {
    const a1 = await withSystemScope(db.sql, (tx) => storeContentPaths(tx, t.storeA1))
    expect(a1).toEqual(['/about', '/caring-for-linen', '/faq', '/lookbook', '/next-plans', '/old-sale', '/blog/a-capsule-for-fall'])
    expect(await withSystemScope(db.sql, (tx) => storeContentPaths(tx, t.storeB1))).toEqual(['/faq'])
    expect(await withSystemScope(db.sql, (tx) => storeContentPaths(tx, t.storeA2))).toEqual([])
  })
})

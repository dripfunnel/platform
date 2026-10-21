import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import { resolveShopper, shopLanguageHeader } from '#auth/shopCaller'
import { withScope } from '#db/scoped/index'
import { publishScheduledPosts } from '#engine/modules/content/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'
import { seedStoreWorld, type StoreWorld } from './support/storeWorld'

// Card #338 (SAPI 24), part 2: the Shop API's read of content pages and the blog (live only, per language, paged and
// cached with the catalogue), a scheduled post going live by the job, and a page's other languages on the Store API.

let db: TestDatabase
let t: Tenants
let w: StoreWorld
const keys = { a1: '', b1: '' }
const ids = { kurta: '', hidden: '', photo: '', draftPhoto: '' }

const asset = async (storeId: string) =>
  (await db.sql<{ id: string }[]>`insert into asset (store_id, r2_key, kind, mime, bytes, checksum) values (${storeId}, ${`stores/${storeId}/assets/${crypto.randomUUID()}.png`}, 'image', 'image/png', 10, ${'0'.repeat(64)}) returning id`)[0]?.id ?? ''

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  w = await seedStoreWorld(db.sql, t, { now: () => new Date(), secrets: null, lookup: null })
  await db.sql`update store set status = 'active' where id in (${t.storeA1}, ${t.storeB1})`
  await db.sql`update partner set state = 'live' where id in (${t.partnerA}, ${t.partnerB})`
  await db.sql`insert into store_language (store_id, language, status, position) values (${t.storeA1}, 'hi-IN', 'active', 1)`
  await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, enabled) select plan_id, partner_id, 1, 'blog', true from store_subscription where store_id in (${t.storeA1}, ${t.storeB1})`
  for (const [k, id] of [['a1', t.storeA1], ['b1', t.storeB1]] as const) keys[k] = (await db.sql<{ k: string }[]>`select public_store_key as k from storefront where store_id = ${id}`)[0]?.k ?? ''
  ids.kurta = (await db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility) values (${t.storeA1}, 'Kurta', 'kurta', 'visible') returning id`)[0]?.id ?? ''
  ids.hidden = (await db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility) values (${t.storeA1}, 'Hidden', 'hidden-kurta', 'hidden') returning id`)[0]?.id ?? ''
  ids.photo = await asset(t.storeA1)
  ids.draftPhoto = await asset(t.storeA1)
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const shop = async (key: string, source: string, language?: string) => {
  const found = await resolveShopper(db.sql, new Request('https://api.example/shop-api', { headers: { 'x-shop-key': key, ...(language ? { [shopLanguageHeader]: language } : {}) } }), 'api.example')
  if (found.kind !== 'found') throw new Error('no store')
  const contextValue: ShopContext = { sql: db.sql, shopper: found.shopper, origin: 'https://api.example', activity: activityLog, facts: { requestId: 'r', ip: null, userAgent: null }, allowNewCart: async () => true, now: () => new Date() }
  const result = await graphql({ schema: shopSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}

const save = async (mutation: 'saveContentPage' | 'saveBlogPost', input: Record<string, unknown>, id?: string, revision?: number) => {
  const type = mutation === 'saveContentPage' ? 'ContentPageInput' : 'BlogPostInput'
  const r = await w.gql('owner', `mutation S($id: ID, $revision: Int, $input: ${type}!) { ${mutation}(id: $id, revision: $revision, input: $input) { id revision status } }`, { id, revision, input: { body: [], publish: true, ...input } })
  if (r.code) throw new Error(`${mutation}: ${r.code}`)
  return r.data?.[mutation] as { id: string; revision: number; status: string }
}
const version = async () => Number((await db.sql<{ v: string }[]>`select catalog_version::text as v from storefront where store_id = ${t.storeA1}`)[0]?.v)

describe('a post through the Shop API', () => {
  it('is written, scheduled, published by the job and read', async () => {
    const before = await version()
    const later = new Date(Date.now() + 3_600_000).toISOString()
    const post = await save('saveBlogPost', { title: 'A capsule for fall', publishAt: later, author: 'Priya', tags: ['fall'], coverAssetId: ids.photo, body: [{ kind: 'text', text: 'Five looks.' }, { kind: 'products', productIds: [ids.kurta, ids.hidden] }] })
    expect(post.status).toBe('scheduled')
    expect(await version()).toBeGreaterThan(before)
    expect((await shop(keys.a1, '{ blogPost(slug: "a-capsule-for-fall") { id } }')).data?.['blogPost']).toBeNull()
    // Its time comes: the shop shows it at once, and the job marks it published.
    await db.sql`update storefront_content set publish_at = now() - interval '1 minute' where id = ${post.id}`
    const read = await shop(keys.a1, '{ blogPost(slug: "a-capsule-for-fall") { title path author tags publishedAt cover { id url } body { kind text productSlugs } } }')
    expect(read.data?.['blogPost']).toMatchObject({ title: 'A capsule for fall', path: '/blog/a-capsule-for-fall', author: 'Priya', tags: ['fall'], cover: { id: ids.photo, url: `https://api.example/shop-api/assets/${ids.photo}` } })
    // A hidden product is never named to a shopper.
    expect((read.data?.['blogPost'] as { body: unknown[] }).body).toEqual([{ kind: 'text', text: 'Five looks.', productSlugs: null }, { kind: 'products', text: null, productSlugs: ['kurta'] }])
    expect(await publishScheduledPosts(db.sql, activityLog, new Date())).toBe(1)
    expect(await publishScheduledPosts(db.sql, activityLog, new Date())).toBe(0)
    expect((await db.sql<{ status: string; published_at: Date | null }[]>`select status, published_at from storefront_content where id = ${post.id}`)[0]).toMatchObject({ status: 'published' })
    const logged = await db.sql<{ actor_kind: string; target_label: string }[]>`select actor_kind, target_label from activity_log where store_id = ${t.storeA1} and action = 'blog_post.published'`
    expect(logged).toEqual([{ actor_kind: 'job', target_label: 'A capsule for fall' }])
    const listed = await w.gql('owner', '{ blogPosts { nodes { status waitingForPublish } } }')
    expect(listed.data?.['blogPosts']).toEqual({ nodes: [{ status: 'published', waitingForPublish: true }] })
  })

  it('pages the blog newest first, filters by tag, and pauses it while the plan has no blog', async () => {
    await save('saveBlogPost', { title: 'Caring for linen', publishAt: new Date(Date.now() - 86_400_000).toISOString(), tags: ['care'] })
    await save('saveBlogPost', { title: 'Not yet', publish: false })
    const first = await shop(keys.a1, '{ blogPosts(first: 1) { nodes { slug } pageInfo { endCursor hasNextPage } } }')
    const page = first.data?.['blogPosts'] as { nodes: { slug: string }[]; pageInfo: { endCursor: string; hasNextPage: boolean } }
    expect(page.nodes.map((n) => n.slug)).toEqual(['a-capsule-for-fall'])
    expect(page.pageInfo.hasNextPage).toBe(true)
    const next = await shop(keys.a1, `{ blogPosts(first: 1, after: "${page.pageInfo.endCursor}") { nodes { slug } pageInfo { hasNextPage } } }`)
    expect(next.data?.['blogPosts']).toEqual({ nodes: [{ slug: 'caring-for-linen' }], pageInfo: { hasNextPage: false } })
    expect((await shop(keys.a1, '{ blogPosts(tag: "care") { nodes { slug } } }')).data?.['blogPosts']).toEqual({ nodes: [{ slug: 'caring-for-linen' }] })
    expect((await shop(keys.a1, '{ blogPosts(after: "nonsense") { nodes { slug } } }')).code).toBe('INVALID_CURSOR')
    expect((await shop(keys.b1, '{ blogPosts { nodes { slug } } }')).data?.['blogPosts']).toEqual({ nodes: [] })
    await db.sql`update plan_entitlement set enabled = false where key = 'blog' and plan_id = (select plan_id from store_subscription where store_id = ${t.storeA1})`
    try {
      expect((await shop(keys.a1, '{ blogPosts { nodes { slug } } }')).data?.['blogPosts']).toEqual({ nodes: [] })
      expect((await shop(keys.a1, '{ blogPost(slug: "caring-for-linen") { slug } }')).data?.['blogPost']).toBeNull()
    } finally {
      await db.sql`update plan_entitlement set enabled = true where key = 'blog' and plan_id = (select plan_id from store_subscription where store_id = ${t.storeA1})`
    }
  })
})

describe('content pages through the Shop API', () => {
  it('shows a live page in the shopper’s language, never a draft, and the footer’s pages', async () => {
    const faq = await save('saveContentPage', { title: 'Questions', slug: 'faq', inMenu: true, body: [{ kind: 'image', assetId: ids.photo, alt: 'Studio' }, { kind: 'faq', items: [{ question: 'Gift wrap?', answer: 'Yes.' }] }] })
    await save('saveContentPage', { title: 'Lookbook', slug: 'lookbook', body: [{ kind: 'image', assetId: ids.draftPhoto, alt: 'Soon' }], publish: false })
    await save('saveContentPage', { title: 'About', slug: 'about' })
    expect((await shop(keys.a1, '{ contentPage(slug: "lookbook") { slug } }')).data?.['contentPage']).toBeNull()
    expect((await shop(keys.a1, '{ contentPages { nodes { slug } } }')).data?.['contentPages']).toEqual({ nodes: [{ slug: 'about' }, { slug: 'faq' }] })
    expect((await shop(keys.a1, '{ contentPages(inMenu: true) { nodes { slug inMenu } } }')).data?.['contentPages']).toEqual({ nodes: [{ slug: 'faq', inMenu: true }] })
    const shown = await shop(keys.a1, '{ contentPage(slug: "FAQ") { title body { kind alt image { id } items { question answer } } } }')
    expect(shown.data?.['contentPage']).toEqual({ title: 'Questions', body: [{ kind: 'image', alt: 'Studio', image: { id: ids.photo }, items: null }, { kind: 'faq', alt: null, image: null, items: [{ question: 'Gift wrap?', answer: 'Yes.' }] }] })
    // A file a live page shows is one the shopper may fetch; a draft's isn't.
    const seen = async (id: string) => withScope(db.sql, { caller: { kind: 'shopper', customerId: null }, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: { kind: 'all' }, subscription: 'active' }, async (tx) => (await tx`select id from asset where id = ${id}`).length)
    expect(await seen(ids.photo)).toBe(1)
    expect(await seen(ids.draftPhoto)).toBe(0)

    // Its Hindi words show to a Hindi shopper; everyone else reads the main language's.
    const translate = (input: Record<string, unknown> | null, language = 'hi-IN', who: 'owner' | 'manager' = 'owner') =>
      w.gql(who, 'mutation T($id: ID!, $language: String!, $input: ContentTranslationInput) { saveContentPageTranslation(id: $id, language: $language, input: $input) { language title changed } }', { id: faq.id, language, input })
    expect((await translate({ title: 'सवाल', body: [{ kind: 'heading', text: 'सवाल' }] })).data?.['saveContentPageTranslation']).toEqual({ language: 'hi-IN', title: 'सवाल', changed: false })
    expect((await shop(keys.a1, '{ contentPage(slug: "faq") { title body { kind text } } }', 'hi-IN')).data?.['contentPage']).toEqual({ title: 'सवाल', body: [{ kind: 'heading', text: 'सवाल' }] })
    expect((await shop(keys.a1, '{ contentPage(slug: "faq") { title } }')).data?.['contentPage']).toEqual({ title: 'Questions' })
    // The main language's words change: the translation says so.
    await save('saveContentPage', { title: 'Questions we get asked', slug: 'faq', inMenu: true, body: [] }, faq.id, faq.revision)
    expect((await w.gql('manager', `{ contentTranslation(id: "${faq.id}", language: "hi-IN") { changed } }`)).data?.['contentTranslation']).toEqual({ changed: true })
    // Only a language the store offers besides its main one; only the Owner; null removes it.
    expect((await translate({ title: 'Q', body: [] }, 'en-US')).code).toBe('INVALID_INPUT')
    expect((await translate({ title: 'Q', body: [] }, 'fr-FR')).code).toBe('INVALID_INPUT')
    expect((await translate({ title: 'Q', body: [] }, 'hi-IN', 'manager')).code).toBe('FORBIDDEN')
    expect((await translate(null)).data?.['saveContentPageTranslation']).toBeNull()
    expect((await shop(keys.a1, '{ contentPage(slug: "faq") { title } }', 'hi-IN')).data?.['contentPage']).toEqual({ title: 'Questions we get asked' })
    const logged = await db.sql<{ reason: string }[]>`select reason from activity_log where store_id = ${t.storeA1} and action = 'content.translated' order by occurred_at`
    expect(logged.map((l) => l.reason)).toEqual(['hi-IN', 'hi-IN removed'])
    // Another store's key reads none of it.
    expect((await shop(keys.b1, '{ contentPage(slug: "faq") { title } }')).data?.['contentPage']).toBeNull()
  })
})

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { withSystemScope } from '#db/scoped/index'
import { storeBuildPosts } from '#engine/modules/content/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'
import { seedStoreWorld } from './support/storeWorld'

// Card #324: a build's snapshot carries the store's published posts, so each gets its page with its Article data.

let db: TestDatabase
let t: Tenants
const now = new Date('2026-10-13T12:00:00Z')

const post = (storeId: string, slug: string, status: string, publishAt: string, extra: { author?: string | null; seoTitle?: string | null; deleted?: boolean } = {}) =>
  db.sql`insert into storefront_content (store_id, kind, slug, title, status, publish_at, published_at, author, seo_title, deleted_at)
    values (${storeId}, 'post', ${slug}, ${`Title of ${slug}`}, ${status}, ${publishAt}, ${status === 'published' ? publishAt : null}, ${extra.author ?? null}, ${extra.seoTitle ?? null}, ${extra.deleted ? now : null})`

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  // Each store on a plan, as the Store API's world seeds them; then A1's plan gains the blog.
  await seedStoreWorld(db.sql, t, { now: () => new Date(), secrets: null, lookup: null })
  await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, enabled) select plan_id, partner_id, 1, 'blog', true from store_subscription where store_id = ${t.storeA1}`
  await post(t.storeA1, 'why-linen', 'published', '2026-10-01T10:00:00Z', { author: 'Maya', seoTitle: 'Why linen' })
  await post(t.storeA1, 'caring-for-linen', 'published', '2026-10-05T10:00:00Z')
  await post(t.storeA1, 'draft-one', 'draft', '2026-10-02T10:00:00Z')
  await post(t.storeA1, 'next-week', 'scheduled', '2026-10-20T10:00:00Z')
  await post(t.storeA1, 'taken-down', 'published', '2026-10-03T10:00:00Z', { deleted: true })
  await post(t.storeB1, 'other-store', 'published', '2026-10-04T10:00:00Z')
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('the posts a build writes pages for', () => {
  it('are the store’s published, due posts, newest first, with their head and no draft, scheduled, deleted or other store’s', async () => {
    const posts = await withSystemScope(db.sql, (tx) => storeBuildPosts(tx, t.storeA1, now, 500))
    expect(posts).toEqual([
      { path: '/blog/caring-for-linen', title: 'Title of caring-for-linen', seoTitle: null, seoDescription: null, author: null, publishedAt: '2026-10-05T10:00:00.000Z', image: null },
      { path: '/blog/why-linen', title: 'Title of why-linen', seoTitle: 'Why linen', seoDescription: null, author: 'Maya', publishedAt: '2026-10-01T10:00:00.000Z', image: null },
    ])
    expect(await withSystemScope(db.sql, (tx) => storeBuildPosts(tx, t.storeA1, now, 1))).toHaveLength(1)
  })

  it('are none while the store’s plan has no blog', async () => {
    expect(await withSystemScope(db.sql, (tx) => storeBuildPosts(tx, t.storeB1, now, 500))).toEqual([])
  })
})

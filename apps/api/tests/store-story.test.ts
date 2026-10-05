import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { withSystemScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #293 (SAPI 3, part 5): A+ content, drafts published apart from the page (CATALOG Q9), brand
// stories the merchant shares (Q5), and a supplier's story naming only what the supplier reads.

let db: TestDatabase
let t: Tenants
const now = new Date('2026-10-05T09:00:00Z')
type Who = 'owner' | 'supplier' | 'otherSupplier' | 'bOwner'
const people: Record<Who, string> = { owner: '', supplier: '', otherSupplier: '', bOwner: '' }
const cookies: Record<Who, string> = { owner: '', supplier: '', otherSupplier: '', bOwner: '' }
const plans = { full: '', bare: '' }

const user = async (partnerId: string, email: string, name: string) =>
  (await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${partnerId}, ${email}, ${name}, 'active') returning id`)[0]?.id ?? ''

const subscribe = async (storeId: string, partnerId: string, planId: string) => {
  await db.sql`update store set plan_id = ${planId}, pricing_currency = 'INR' where id = ${storeId}`
  await db.sql`delete from store_subscription where store_id = ${storeId}`
  await db.sql`insert into store_subscription (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end)
    values (${storeId}, ${partnerId}, ${planId}, 1, 'active', 'month', 'INR', 0, ${now}, ${new Date(now.getTime() + 30 * 86_400_000)})`
}

let files = 0
const upload = async (storeId: string, sellerId: string | null, kind: 'image' | 'video' = 'image') => {
  files += 1
  const key = `stores/${storeId}/assets/00000000-0000-4000-8000-${String(files).padStart(12, '0')}.${kind === 'image' ? 'png' : 'mp4'}`
  return (await db.sql<{ id: string }[]>`insert into asset (store_id, seller_id, r2_key, kind, mime, bytes, checksum) values (${storeId}, ${sellerId}, ${key}, ${kind}, ${kind === 'image' ? 'image/png' : 'video/mp4'}, 1, ${'0'.repeat(64)}) returning id`)[0]?.id ?? ''
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update seller set access_level = 'vendor-catalogue' where id in (${t.sellerA1First}, ${t.sellerA1Second})`
  const plan = async (partnerId: string, name: string, aplus: boolean) => {
    const [row] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${partnerId}, ${name}, 'live') returning id`
    await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) values (${row?.id ?? ''}, ${partnerId}, 1, 'products', 100)`
    if (aplus) await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, enabled) values (${row?.id ?? ''}, ${partnerId}, 1, 'aplus', true)`
    return row?.id ?? ''
  }
  plans.full = await plan(t.partnerA, 'Full', true)
  plans.bare = await plan(t.partnerA, 'Bare', false)
  await subscribe(t.storeA1, t.partnerA, plans.full)
  await subscribe(t.storeB1, t.partnerB, await plan(t.partnerB, 'B full', true))
  people.owner = await user(t.partnerA, 'owner@a.example', 'Olivia')
  people.supplier = await user(t.partnerA, 'anand@a.example', 'Anand')
  people.otherSupplier = await user(t.partnerA, 'bhatia@a.example', 'Bhatia')
  people.bOwner = await user(t.partnerB, 'owner@b.example', 'Bea')
  await db.sql`insert into membership (user_id, store_id, role_key, status) values (${people.owner}, ${t.storeA1}, 'owner', 'active'), (${people.bOwner}, ${t.storeB1}, 'owner', 'active')`
  await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${people.supplier}, ${t.storeA1}, ${t.sellerA1First}, 'supplier-admin', 'active'), (${people.otherSupplier}, ${t.storeA1}, ${t.sellerA1Second}, 'supplier-admin', 'active')`
  for (const who of Object.keys(cookies) as Who[]) {
    cookies[who] = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: people[who], partnerId: who === 'bOwner' ? t.partnerB : t.partnerA }, now))
  }
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const sellerOf: Partial<Record<Who, () => string>> = { supplier: () => t.sellerA1First, otherSupplier: () => t.sellerA1Second }

const gql = async (source: string, who: Who, variables: Record<string, unknown> = {}) => {
  const partnerId = who === 'bOwner' ? t.partnerB : t.partnerA
  const storeId = who === 'bOwner' ? t.storeB1 : t.storeA1
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const seller = sellerOf[who]?.()
  const headers: Record<string, string> = { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: storeId, ...(seller ? { [supplierHeader]: seller } : {}) }
  const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), partnerId, now, activityLog, facts)
  const contextValue: StoreContext = { standing, partnerId, sql: db.sql, activity: activityLog, facts, now: () => now }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue, variableValues: variables })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined, errors: result.errors }
}

const product = async (who: Who, name: string) => {
  const result = await gql('mutation S($input: ProductInput!) { saveProduct(input: $input) { id } }', who, { input: { name, options: [], versions: [{ choices: [], prices: [{ currency: 'INR', amount: '100' }] }] } })
  return (result.data?.['saveProduct'] as { id: string } | undefined)?.id ?? ''
}

const withMedia = async (who: Who, name: string, media: Record<string, unknown>) =>
  (await gql('mutation S($input: ProductInput!) { saveProduct(input: $input) { id } }', who, { input: { name, options: [], versions: [{ choices: [], prices: [{ currency: 'INR', amount: '100' }] }], ...media } })).code
const copyStory = async (who: Who, from: string, to: string[]) => {
  const result = await gql('mutation C($from: ID!, $to: [ID!]!) { copyProductStory(fromProductId: $from, toProductIds: $to) }', who, { from, to })
  return { copied: result.data?.['copyProductStory'] as number | undefined, code: result.code, extensions: result.errors?.[0]?.extensions }
}

interface StoryOut {
  revision: number
  status: string
  template: string | null
  modules: { id: string; kind: string; title: string | null; body: string | null; photo: { assetId: string | null; alt: string | null } | null; productIds: string[] | null; blockId: string | null }[]
}
const storyFields = 'revision status template modules { id kind title body photo { assetId alt } productIds blockId }'
const storyOf = async (who: Who, productId: string) => (await gql(`query Q($id: ID!) { productStory(productId: $id) { ${storyFields} } }`, who, { id: productId })).data?.['productStory'] as StoryOut | null
const saveStory = async (who: Who, productId: string, revision: number, modules: unknown[], template?: string) => {
  const result = await gql(`mutation S($id: ID!, $revision: Int!, $input: ProductStoryInput!) { saveProductStory(productId: $id, revision: $revision, input: $input) { ${storyFields} } }`, who, { id: productId, revision, input: { modules, template } })
  return { story: result.data?.['saveProductStory'] as StoryOut | undefined, code: result.code, errors: result.errors }
}
const publish = async (who: Who, productId: string, revision: number) => {
  const result = await gql(`mutation P($id: ID!, $revision: Int!) { publishProductStory(productId: $id, revision: $revision) { ${storyFields} } }`, who, { id: productId, revision })
  return { story: result.data?.['publishProductStory'] as StoryOut | undefined, code: result.code, errors: result.errors }
}
const saveBlock = async (who: Who, input: Record<string, unknown>, id?: string, revision?: number) => {
  const result = await gql('mutation B($id: ID, $revision: Int, $input: StoryBlockInput!) { saveStoryBlock(id: $id, revision: $revision, input: $input) { id revision } }', who, { id, revision, input })
  return { saved: result.data?.['saveStoryBlock'] as { id: string; revision: number } | undefined, code: result.code }
}
const banner = (assetId: string | null, alt: string | null, id = 'm1') => ({ id, kind: 'banner', title: 'Made to be lived in', photo: { assetId, alt } })

describe('A+ content: draft and live', () => {
  it('saves an unfinished draft, refuses to publish it until every photo is described, then goes live', async () => {
    const id = await product('owner', 'Linen shirt')
    expect(await storyOf('owner', id)).toMatchObject({ revision: 0, status: 'draft', modules: [] })
    const photo = await upload(t.storeA1, null)
    const draft = await saveStory('owner', id, 0, [banner(photo, null), { id: 'm2', kind: 'imageText', title: 'From seed to shirt', photo: { assetId: null } }, { id: 'm3', kind: 'specs' }], 'fashion')
    expect(draft.story).toMatchObject({ revision: 1, status: 'draft', template: 'fashion' })
    const refused = await publish('owner', id, 1)
    expect(refused.code).toBe('STORY_INCOMPLETE')
    expect(refused.errors?.[0]?.extensions['gaps']).toEqual([{ moduleId: 'm1', field: 'alt' }, { moduleId: 'm2', field: 'body' }, { moduleId: 'm2', field: 'photo' }])

    const done = await saveStory('owner', id, 1, [banner(photo, 'A linen shirt on a chair'), { id: 'm3', kind: 'specs' }])
    expect((await publish('owner', id, done.story?.revision ?? 0)).story).toMatchObject({ revision: 3, status: 'live' })
    const changed = await saveStory('owner', id, 3, [banner(photo, 'A linen shirt on a chair'), { id: 'm3', kind: 'faq' }])
    expect(changed.story?.status).toBe('changed')
    const [row] = await db.sql<{ live: { kind: string }[] }[]>`select live from product_story where product_id = ${id}`
    expect(row?.live.map((m) => m.kind)).toEqual(['banner', 'specs'])
  })

  it('takes the story off the page when an empty draft is published', async () => {
    const id = await product('owner', 'Wool socks')
    const photo = await upload(t.storeA1, null)
    const saved = await saveStory('owner', id, 0, [banner(photo, 'Socks')])
    const live = await publish('owner', id, saved.story?.revision ?? 0)
    const empty = await saveStory('owner', id, live.story?.revision ?? 0, [])
    expect((await publish('owner', id, empty.story?.revision ?? 0)).story).toMatchObject({ status: 'draft', modules: [] })
    expect((await db.sql<{ live: unknown }[]>`select live from product_story where product_id = ${id}`)[0]?.live).toBeNull()
  })

  it('refuses a save made from a stale revision, and a first save when one exists', async () => {
    const id = await product('owner', 'Cap')
    await saveStory('owner', id, 0, [{ id: 'a', kind: 'specs' }])
    expect((await saveStory('owner', id, 0, [{ id: 'b', kind: 'faq' }])).errors?.[0]?.extensions).toMatchObject({ code: 'STALE_REVISION', revision: 1 })
    expect((await publish('owner', id, 7)).code).toBe('STALE_REVISION')
  })

  it('refuses modules it doesn’t know, fields a kind doesn’t have, more than ten, and a video that isn’t https', async () => {
    const id = await product('owner', 'Scarf')
    const refusal = async (modules: unknown[]) => (await saveStory('owner', id, 0, modules)).errors?.[0]?.extensions
    expect(await refusal([{ id: 'a', kind: 'carousel' }])).toMatchObject({ code: 'INVALID_STORY', field: 'kind' })
    expect(await refusal([{ id: 'a', kind: 'banner', body: 'no body on a banner' }])).toMatchObject({ code: 'INVALID_STORY', field: 'body' })
    expect(await refusal(Array.from({ length: 11 }, (_, i) => ({ id: `m${i}`, kind: 'specs' })))).toMatchObject({ code: 'INVALID_STORY', field: 'modules' })
    expect(await refusal([{ id: 'a', kind: 'video', video: { url: 'http://videos.example/x' } }])).toMatchObject({ code: 'INVALID_STORY', field: 'video' })
    expect(await refusal([{ id: 'a', kind: 'specs' }, { id: 'a', kind: 'faq' }])).toMatchObject({ code: 'INVALID_STORY', field: 'id' })
    expect(await refusal([{ id: 'a', kind: 'compare', productIds: [id] }])).toMatchObject({ code: 'INVALID_STORY', field: 'productIds' })
    expect(await refusal([{ id: 'a', kind: 'compare', productIds: ['------------------------------------'] }])).toMatchObject({ code: 'INVALID_STORY', field: 'productIds' })
  })

  it('needs the plan’s A+ to write, never to read what was kept through a downgrade', async () => {
    const id = await product('owner', 'Belt')
    const kept = await saveStory('owner', id, 0, [{ id: 'a', kind: 'specs' }])
    const supplierId = await product('supplier', 'Anand belt')
    await subscribe(t.storeA1, t.partnerA, plans.bare)
    try {
      expect((await saveStory('owner', id, kept.story?.revision ?? 0, [])).errors?.[0]?.extensions).toMatchObject({ code: 'PLAN_LIMIT', key: 'aplus', unlockedBy: { id: plans.full } })
      expect((await publish('owner', id, kept.story?.revision ?? 0)).code).toBe('PLAN_LIMIT')
      expect((await storyOf('owner', id))?.modules).toHaveLength(1)
      expect((await saveStory('supplier', supplierId, 0, [])).errors?.[0]?.extensions).toEqual({ code: 'FEATURE_UNAVAILABLE' })
    } finally {
      await subscribe(t.storeA1, t.partnerA, plans.full)
    }
  })
})

describe('A+ content: owners', () => {
  it('lets a supplier write its own products’ stories and read no one else’s', async () => {
    const theirs = await product('supplier', 'Anand kurta')
    const merchant = await product('owner', 'Store kurta')
    expect((await saveStory('supplier', theirs, 0, [{ id: 'a', kind: 'specs' }])).story?.revision).toBe(1)
    expect(await storyOf('supplier', merchant)).toBeNull()
    expect(await storyOf('otherSupplier', theirs)).toBeNull()
    expect((await saveStory('supplier', merchant, 0, [])).code).toBe('NOT_FOUND')
    expect((await saveStory('otherSupplier', theirs, 1, [])).code).toBe('NOT_FOUND')
    expect((await storyOf('owner', theirs))?.modules).toHaveLength(1)
  })

  it('compares a supplier’s product only with that supplier’s own, whoever saves it', async () => {
    const theirs = await product('supplier', 'Anand tee')
    const theirsToo = await product('supplier', 'Anand tee, heavy')
    const merchant = await product('owner', 'Store tee')
    const other = await product('otherSupplier', 'Bhatia tee')
    const compare = (ids: string[]) => [{ id: 'c', kind: 'compare', title: 'Compare', productIds: ids }]
    expect((await saveStory('supplier', theirs, 0, compare([merchant]))).code).toBe('STORY_REFUSED')
    expect((await saveStory('owner', theirs, 0, compare([merchant]))).code).toBe('STORY_REFUSED')
    expect((await saveStory('owner', theirs, 0, compare([other]))).code).toBe('STORY_REFUSED')
    expect((await saveStory('owner', theirs, 0, compare([theirsToo]))).story?.modules[0]?.productIds).toEqual([theirsToo])
    // The merchant's own products may compare any of the store's.
    expect((await saveStory('owner', merchant, 0, compare([theirs, other]))).story?.revision).toBe(1)
    // The comparison's chips are named with the story, one read; a supplier is named only its own.
    const names = async (who: Who, id: string) => ((await gql('query Q($id: ID!) { productStory(productId: $id) { products { id name } } }', who, { id })).data?.['productStory'] as { products: { name: string }[] }).products.map((p) => p.name).sort()
    expect(await names('owner', merchant)).toEqual(['Anand tee', 'Bhatia tee'])
    expect(await names('supplier', theirs)).toEqual(['Anand tee, heavy'])
    // A compared product trashed later doesn't block the next save, but can't be added again.
    await gql('mutation D($ids: [ID!]!) { deleteProducts(ids: $ids) }', 'owner', { ids: [other] })
    expect((await saveStory('owner', merchant, 1, [...compare([theirs, other]), { id: 'f', kind: 'faq' }])).story?.revision).toBe(2)
    const fresh = await product('owner', 'Store tee, fresh')
    expect((await saveStory('owner', fresh, 0, compare([theirs, other]))).code).toBe('STORY_REFUSED')
  })

  it('names only files of the right kind in this store, and moves an unshared upload to the product’s owner', async () => {
    const theirs = await product('supplier', 'Anand bag')
    const merchant = await product('owner', 'Store bag')
    expect((await saveStory('owner', merchant, 0, [banner(await upload(t.storeA1, null, 'video'), 'x')])).code).toBe('STORY_REFUSED')
    expect((await saveStory('owner', merchant, 0, [banner(await upload(t.storeB1, null), 'x')])).code).toBe('STORY_REFUSED')
    expect((await saveStory('supplier', theirs, 0, [banner(await upload(t.storeA1, t.sellerA1Second), 'x')])).code).toBe('STORY_REFUSED')

    const fresh = await upload(t.storeA1, null)
    expect((await saveStory('owner', theirs, 0, [banner(fresh, 'A bag')])).story?.revision).toBe(1)
    expect((await db.sql<{ seller_id: string | null }[]>`select seller_id from asset where id = ${fresh}`)[0]?.seller_id).toBe(t.sellerA1First)
    // Now the supplier's story shows it, the merchant can't take it for its own product.
    expect((await saveStory('owner', merchant, 0, [banner(fresh, 'A bag')])).code).toBe('STORY_REFUSED')
    const video = await upload(t.storeA1, null, 'video')
    expect((await saveStory('owner', merchant, 0, [{ id: 'v', kind: 'video', title: 'In use', video: { assetId: video } }])).story?.revision).toBe(1)
  })
})

describe('Files a story shows', () => {
  it('stay their owner’s when a photo or video of another owner’s product names them', async () => {
    const theirs = await product('supplier', 'Anand lamp')
    const photo = await upload(t.storeA1, t.sellerA1First)
    const video = await upload(t.storeA1, t.sellerA1First, 'video')
    await saveStory('supplier', theirs, 0, [banner(photo, 'A lamp'), { id: 'v', kind: 'video', video: { assetId: video } }])
    expect(await withMedia('owner', 'Store lamp', { photos: [{ assetId: photo, alt: 'x' }] })).toBe('FILE_REFUSED')
    expect(await withMedia('owner', 'Store lamp', { video: { assetId: video } })).toBe('FILE_REFUSED')
    expect((await db.sql<{ seller_id: string | null }[]>`select seller_id from asset where id = any (${`{${photo},${video}}`}::uuid[])`).map((a) => a.seller_id)).toEqual([t.sellerA1First, t.sellerA1First])

    // A brand story holds only photos (migration 0045), so its file is refused as another product's photo.
    const brandPhoto = await upload(t.storeA1, null)
    await saveBlock('owner', { name: 'Lamps', title: 'Since 1990', body: 'Brass.', photo: { assetId: brandPhoto, alt: 'Brass' } })
    const supplierProduct = await product('supplier', 'Anand lamp, brass')
    const refused = await gql('mutation S($id: ID!, $revision: Int!, $input: ProductInput!) { saveProduct(id: $id, revision: $revision, input: $input) { id } }', 'owner', {
      id: supplierProduct,
      revision: 1,
      input: { name: 'Anand lamp, brass', options: [], versions: [{ choices: [], prices: [{ currency: 'INR', amount: '100' }] }], photos: [{ assetId: brandPhoto, alt: 'x' }] },
    })
    expect(refused.code).toBe('FILE_REFUSED')
    expect((await db.sql<{ seller_id: string | null }[]>`select seller_id from asset where id = ${brandPhoto}`)[0]?.seller_id).toBeNull()
  })
})

describe('Brand stories', () => {
  it('are the merchant’s: shared by many products, counted, kept while in use', async () => {
    const photo = await upload(t.storeA1, null)
    const made = await saveBlock('owner', { name: 'Our story', title: 'Since 1998', body: 'Hand-loomed in Kutch.', photo: { assetId: photo, alt: 'The loom' } })
    const blockId = made.saved?.id ?? ''
    const one = await product('owner', 'Throw')
    const two = await product('owner', 'Cushion')
    for (const id of [one, two]) await saveStory('owner', id, 0, [{ id: 'b', kind: 'brand', blockId }])
    const read = await gql('query B($id: ID!) { storyBlock(id: $id) { name title products revision } storyBlocks { nodes { id products } } }', 'owner', { id: blockId })
    expect(read.data?.['storyBlock']).toMatchObject({ name: 'Our story', title: 'Since 1998', products: 2, revision: 1 })
    expect((await saveBlock('owner', { name: 'Our story', title: 'Since 1999', body: 'x' }, blockId, 1)).saved?.revision).toBe(2)
    expect((await saveBlock('owner', { name: 'Our story', title: 'Since 2000', body: 'x' }, blockId, 1)).code).toBe('STALE_REVISION')
    expect((await gql('mutation D($id: ID!) { deleteStoryBlock(id: $id) }', 'owner', { id: blockId })).code).toBe('STORY_BLOCK_IN_USE')

    const lone = await saveBlock('owner', { name: 'Spare', title: 'Spare', body: 'x' })
    expect((await gql('mutation D($id: ID!) { deleteStoryBlock(id: $id) }', 'owner', { id: lone.saved?.id })).data?.['deleteStoryBlock']).toBe(true)
  })

  it('refuses a photo with no description, a supplier, and a brand story on a supplier’s product', async () => {
    expect((await saveBlock('owner', { name: 'N', title: 'T', body: 'B', photo: { assetId: await upload(t.storeA1, null) } })).code).toBe('INVALID_STORY')
    expect((await saveBlock('supplier', { name: 'N', title: 'T', body: 'B' })).code).toBe('FORBIDDEN')
    expect((await gql('{ storyBlocks { nodes { id } } }', 'supplier')).code).toBe('FORBIDDEN')
    const blockId = (await saveBlock('owner', { name: 'Ours', title: 'T', body: 'B' })).saved?.id
    const theirs = await product('supplier', 'Anand rug')
    expect((await saveStory('supplier', theirs, 0, [{ id: 'b', kind: 'brand', blockId }])).errors?.[0]?.extensions).toMatchObject({ code: 'INVALID_STORY', field: 'kind' })
    expect((await saveStory('owner', theirs, 0, [{ id: 'b', kind: 'brand', blockId }])).code).toBe('STORY_REFUSED')
  })

  it('page one at a time when made in the same instant, every one once', async () => {
    const made = (await db.sql<{ id: string }[]>`insert into story_block (store_id, name, content) select ${t.storeB1}, 'Instant ' || g, '{"title":"T","body":"B","photo":null}' from generate_series(1, 3) g returning id`).map((r) => r.id)
    const seen: string[] = []
    let after: string | undefined
    for (let page = 0; page < 10; page += 1) {
      const answer = (await gql('query L($after: String) { storyBlocks(first: 1, after: $after) { nodes { id } pageInfo { hasNextPage endCursor } } }', 'bOwner', { after })).data?.['storyBlocks'] as { nodes: { id: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }
      seen.push(...answer.nodes.map((n) => n.id))
      if (!answer.pageInfo.hasNextPage) break
      after = answer.pageInfo.endCursor ?? undefined
    }
    expect(seen.sort()).toEqual([...made].sort())
    await db.sql`delete from story_block where store_id = ${t.storeB1}`
  })

  it('stops at 50 a store', async () => {
    const [{ n } = { n: 0 }] = await db.sql<{ n: number }[]>`select count(*)::int as n from story_block where store_id = ${t.storeA1}`
    await db.sql`insert into story_block (store_id, name, content) select ${t.storeA1}, 'Filler ' || g, '{"title":"T","body":"B","photo":null}' from generate_series(1, ${50 - n}) g`
    expect((await saveBlock('owner', { name: 'One more', title: 'T', body: 'B' })).code).toBe('TOO_MANY_STORY_BLOCKS')
    await db.sql`delete from story_block where name like 'Filler %'`
  })

  it('holds the limit when two are made at the same moment', async () => {
    const [{ n } = { n: 0 }] = await db.sql<{ n: number }[]>`select count(*)::int as n from story_block where store_id = ${t.storeA1}`
    await db.sql`insert into story_block (store_id, name, content) select ${t.storeA1}, 'Filler ' || g, '{"title":"T","body":"B","photo":null}' from generate_series(1, ${49 - n}) g`
    // Another save holds the store's lock and has made the 50th, not yet committed.
    let commit = () => {}
    const held = new Promise<void>((resolve) => (commit = resolve))
    const other = db.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`story_block:${t.storeA1}`}))`
      await tx`insert into story_block (store_id, name, content) values (${t.storeA1}, 'Filler 50', '{"title":"T","body":"B","photo":null}')`
      await held
    })
    await new Promise((r) => setTimeout(r, 100))
    const mine = saveBlock('owner', { name: 'Racing', title: 'T', body: 'B' })
    await new Promise((r) => setTimeout(r, 200))
    commit()
    await other
    expect((await mine).code).toBe('TOO_MANY_STORY_BLOCKS')
    await db.sql`delete from story_block where name like 'Filler %'`
  })
})

describe('Brand stories, at the same moment', () => {
  it('never leaves a story naming a brand story deleted at the same moment', async () => {
    const product1 = await product('owner', 'Vase')
    const blockId = (await saveBlock('owner', { name: 'Race', title: 'T', body: 'B' })).saved?.id ?? ''
    // A save naming the block holds it, so a delete waits for the save, then sees the story.
    let release = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    const saving = db.sql.begin(async (tx) => {
      await tx`insert into product_story (product_id, store_id, draft) values (${product1}, ${t.storeA1}, ${tx.json([{ id: 'b', kind: 'brand', blockId }])})`
      await held
    })
    await new Promise((r) => setTimeout(r, 100))
    const deleting = gql('mutation D($id: ID!) { deleteStoryBlock(id: $id) }', 'owner', { id: blockId })
    await new Promise((r) => setTimeout(r, 200))
    release()
    await saving
    expect((await deleting).code).toBe('STORY_BLOCK_IN_USE')

    // A delete holding the block makes a save that names it wait, then refuses it.
    const product2 = await product('owner', 'Bowl')
    const spare = (await saveBlock('owner', { name: 'Race 2', title: 'T', body: 'B' })).saved?.id ?? ''
    let go = () => {}
    const gate = new Promise<void>((resolve) => (go = resolve))
    const removing = db.sql.begin(async (tx) => {
      await tx`select 1 from story_block where id = ${spare} for update`
      await tx`delete from story_block where id = ${spare}`
      await gate
    })
    await new Promise((r) => setTimeout(r, 100))
    const naming = saveStory('owner', product2, 0, [{ id: 'b', kind: 'brand', blockId: spare }])
    await new Promise((r) => setTimeout(r, 200))
    go()
    await removing
    expect((await naming).code).toBe('STORY_REFUSED')
  })
})

describe('Copying A+ content', () => {
  it('puts the source’s draft on each target’s draft and leaves their pages alone', async () => {
    const source = await product('owner', 'Mug')
    const target = await product('owner', 'Cup')
    const another = await product('owner', 'Jug')
    const photo = await upload(t.storeA1, null)
    const live = await saveStory('owner', target, 0, [banner(photo, 'A cup')])
    await publish('owner', target, live.story?.revision ?? 0)
    await saveStory('owner', source, 0, [{ id: 'f', kind: 'faq', title: 'Questions' }, { id: 'c', kind: 'compare', productIds: [target, another] }])
    const copied = await gql('mutation C($from: ID!, $to: [ID!]!) { copyProductStory(fromProductId: $from, toProductIds: $to) }', 'owner', { from: source, to: [target, another] })
    expect(copied.data?.['copyProductStory']).toBe(2)
    const onTarget = await storyOf('owner', target)
    expect(onTarget).toMatchObject({ status: 'changed' })
    expect(onTarget?.modules.find((m) => m.kind === 'compare')?.productIds).toEqual([another])
    expect((await storyOf('owner', another))?.modules.find((m) => m.kind === 'compare')?.productIds).toEqual([target])

    // A compared product trashed since is left out of the copies.
    await gql('mutation D($ids: [ID!]!) { deleteProducts(ids: $ids) }', 'owner', { ids: [another] })
    const third = await product('owner', 'Flask')
    await gql('mutation C($from: ID!, $to: [ID!]!) { copyProductStory(fromProductId: $from, toProductIds: $to) }', 'owner', { from: source, to: [third] })
    expect((await storyOf('owner', third))?.modules.find((m) => m.kind === 'compare')?.productIds).toEqual([target])
  })

  it('copies into 1 to 50 other products, named by id', async () => {
    const source = await product('owner', 'Plate')
    await saveStory('owner', source, 0, [{ id: 'f', kind: 'faq' }])
    expect((await copyStory('owner', source, [])).extensions).toMatchObject({ code: 'INVALID_STORY', field: 'toProductIds' })
    expect((await copyStory('owner', source, [source])).extensions).toMatchObject({ code: 'INVALID_STORY', field: 'toProductIds' })
    expect((await copyStory('owner', source, ['plate'])).extensions).toMatchObject({ code: 'INVALID_STORY', field: 'toProductIds' })
    const many = Array.from({ length: 51 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`)
    expect((await copyStory('owner', source, many)).extensions).toMatchObject({ code: 'INVALID_STORY', field: 'toProductIds' })
    expect((await copyStory('owner', source, many.slice(0, 50))).code).toBe('NOT_FOUND')
  })

  it('refuses the whole copy when a target can’t carry what the story names', async () => {
    const merchant = await product('owner', 'Store plate')
    const theirs = await product('supplier', 'Anand plate')
    const mine = await product('owner', 'Store plate, deep')
    const blockId = (await saveBlock('owner', { name: 'Plates', title: 'T', body: 'B' })).saved?.id
    const branded = await product('owner', 'Store plate, branded')
    await saveStory('owner', branded, 0, [{ id: 'b', kind: 'brand', blockId }])
    expect((await copyStory('owner', branded, [mine, theirs])).code).toBe('STORY_REFUSED')
    await saveStory('owner', merchant, 0, [{ id: 'c', kind: 'compare', productIds: [mine, branded] }])
    expect((await copyStory('owner', merchant, [theirs])).code).toBe('STORY_REFUSED')
    expect(await storyOf('owner', theirs)).toMatchObject({ revision: 0, modules: [] })
    expect((await storyOf('owner', mine))?.modules).toEqual([])
  })

  it('copies only between products the caller reads', async () => {
    const theirs = await product('supplier', 'Anand mug')
    await saveStory('supplier', theirs, 0, [{ id: 'f', kind: 'faq' }])
    const merchant = await product('owner', 'Store mug')
    expect((await gql('mutation C($from: ID!, $to: [ID!]!) { copyProductStory(fromProductId: $from, toProductIds: $to) }', 'supplier', { from: theirs, to: [merchant] })).code).toBe('NOT_FOUND')
    expect((await gql('mutation C($from: ID!, $to: [ID!]!) { copyProductStory(fromProductId: $from, toProductIds: $to) }', 'bOwner', { from: theirs, to: [theirs] })).code).toBe('NOT_FOUND')
  })
})

describe('Another store', () => {
  it('reads and writes nothing of store A’s stories', async () => {
    const id = await product('owner', 'Lamp')
    await saveStory('owner', id, 0, [{ id: 'a', kind: 'specs' }])
    expect(await storyOf('bOwner', id)).toBeNull()
    expect((await saveStory('bOwner', id, 1, [])).code).toBe('NOT_FOUND')
    expect((await gql('{ storyBlocks { nodes { id } } }', 'bOwner')).data?.['storyBlocks']).toEqual({ nodes: [] })
  })
})

describe('a supplier’s A+ under approval (CATALOG Q11)', () => {
  it('sends the product back to the queue when the supplier publishes its story, and is shown again once approved', async () => {
    const id = await product('supplier', 'Approval kurta')
    await gql('mutation { setApproval(on: true) }', 'owner')
    try {
      await db.sql`update product set approval_status = 'approved', visibility = 'visible' where id = ${id}`
      const saved = await saveStory('supplier', id, 0, [{ id: 'a', kind: 'specs' }])
      expect((await db.sql<{ approval_status: string }[]>`select approval_status from product where id = ${id}`)[0]?.approval_status).toBe('approved')
      expect((await publish('supplier', id, saved.story?.revision ?? 0)).code).toBeUndefined()
      expect((await db.sql<{ approval_status: string; visibility: string }[]>`select approval_status, visibility from product where id = ${id}`)[0]).toEqual({ approval_status: 'pending', visibility: 'hidden' })
      expect((await gql('mutation A($id: ID!) { approveProduct(id: $id) }', 'owner', { id })).data?.['approveProduct']).toBe(true)
      expect((await db.sql<{ approval_status: string; visibility: string }[]>`select approval_status, visibility from product where id = ${id}`)[0]).toEqual({ approval_status: 'approved', visibility: 'visible' })
    } finally {
      await gql('mutation { setApproval(on: false) }', 'owner')
    }
  })
})

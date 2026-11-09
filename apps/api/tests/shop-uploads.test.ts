import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import { handleUpload } from '#apis/shop/uploads'
import { resolveShopper } from '#auth/shopCaller'
import type { CallerContext, SellerScope } from '#core/tenancy'
import { withScope } from '#db/scoped/index'
import { uploadDeleteDeliverer } from '#jobs/queues/deliverers/uploadDelete'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #1369: a shopper's files for upload questions (PLATFORM-PROMPT §5.4 "Uploads"; DATA-MODEL §7.6, §7.11): checked by
// content, kept on R2 under the cart, held to the shopper's own cart, and removed with their objects through the outbox.

let db: TestDatabase
let t: Tenants
let storeId = ''
const host = 'prints.shop.example'
const ids = { product: '', version: '', photo: '', photoOrPdf: '', hiddenQuestion: '' }
const bucket = new Map<string, Uint8Array<ArrayBuffer>>()
const files = {
  put: async (key: string, body: Uint8Array) => {
    bucket.set(key, new Uint8Array(body))
  },
  get: async (key: string) => (bucket.has(key) ? { body: new Blob([bucket.get(key) ?? new Uint8Array()]).stream() } : null),
  delete: async (key: string) => {
    bucket.delete(key)
  },
}
let addressOk = true

const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(60).fill(1)])
const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(60).fill(2)])
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0))
const webp = () => new Uint8Array([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBPVP8 '), ...new Array(40).fill(3)])
const heic = () => new Uint8Array([0, 0, 0, 24, ...ascii('ftypheic'), ...new Array(40).fill(4)])
const pdf = () => new Uint8Array([...ascii('%PDF-1.7\n'), ...new Array(40).fill(5)])

const one = async <T extends object>(rows: Promise<T[]>): Promise<T> => {
  const [row] = await rows
  if (!row) throw new Error('no row')
  return row
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update partner set state = 'live' where id = ${t.partnerA}`
  storeId = (await one(db.sql<{ id: string }[]>`insert into store (partner_id, name, code, country, pricing_currency, status) values (${t.partnerA}, 'Prints', 'prints', 'IN', 'INR', 'active') returning id`)).id
  ids.product = (await one(db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility) values (${storeId}, 'Photo mug', 'photo-mug', 'visible') returning id`)).id
  ids.version = (await one(db.sql<{ id: string }[]>`insert into product_version (store_id, product_id, sku, position, track_stock) values (${storeId}, ${ids.product}, 'mug', 0, false) returning id`)).id
  await db.sql`insert into version_price (version_id, store_id, currency, amount) values (${ids.version}, ${storeId}, 'INR', 50000)`
  const question = (label: string, position: number, accept: string, maxFiles: number, product = ids.product) =>
    one(db.sql<{ id: string }[]>`insert into product_question (product_id, store_id, kind, label, position, accept, max_files, price_mode, price_per)
      values (${product}, ${storeId}, 'upload', ${label}, ${position}, ${accept}, ${maxFiles}, 'fixed', 'line') returning id`)
  ids.photo = (await question('Your photo', 1, 'image', 2)).id
  ids.photoOrPdf = (await question('Artwork', 2, 'image_pdf', 1)).id
  await db.sql`insert into product_question_amount (store_id, product_id, question_id, currency, amount) values (${storeId}, ${ids.product}, ${ids.photo}, 'INR', 30000), (${storeId}, ${ids.product}, ${ids.photoOrPdf}, 'INR', 0)`
  const hidden = (await one(db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility) values (${storeId}, 'Draft mug', 'draft-mug', 'hidden') returning id`)).id
  ids.hiddenQuestion = (await question('Draft photo', 1, 'image', 1, hidden)).id
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const contextOf = async (token: string | null): Promise<ShopContext> => {
  const headers: Record<string, string> = token ? { 'x-shop-cart': token } : {}
  const found = await resolveShopper(db.sql, new Request(`https://${host}/shop-api`, { headers }), host, 'shop.example')
  if (found.kind !== 'found') throw new Error('no store')
  return {
    sql: db.sql,
    shopper: found.shopper,
    origin: `https://${host}`,
    activity: activityLog,
    facts: { requestId: 'r', ip: '203.0.113.20', userAgent: null },
    couriers: null,
    allowNewCart: async () => true,
    allowUploadToCart: async () => true,
    allowUploadFromAddress: async () => addressOk,
    now: () => new Date(),
  }
}
const send = async (token: string | null, question: string, body: Uint8Array<ArrayBuffer>) => {
  const response = await handleUpload(
    new Request(`https://${host}/shop-api/uploads?question=${question}`, { method: 'POST', body, headers: { 'content-length': String(body.byteLength), ...(token ? { 'x-shop-cart': token } : {}) } }),
    await contextOf(token),
    files,
  )
  return { status: response.status, body: (await response.json()) as { id?: string; kind?: string; cartToken?: string | null; removed?: boolean; errors?: { extensions: { code: string } }[] } }
}
const remove = async (token: string, id: string) => {
  const response = await handleUpload(new Request(`https://${host}/shop-api/uploads/${id}`, { method: 'DELETE', headers: { 'x-shop-cart': token } }), await contextOf(token), files)
  return { status: response.status, body: (await response.json()) as { removed?: boolean; errors?: { extensions: { code: string } }[] } }
}
const code = (r: Awaited<ReturnType<typeof send>>) => r.body.errors?.[0]?.extensions.code
const gql = async (source: string, token: string, variables: Record<string, unknown> = {}) => {
  const result = await graphql({ schema: shopSchema as GraphQLSchema, source, contextValue: await contextOf(token), variableValues: variables })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined, problems: result.errors?.[0]?.extensions['problems'] as { reason: string }[] | undefined }
}
const add = (token: string, answers: unknown[]) =>
  gql('mutation A($v: ID!, $a: [ShopAnswerInput!]) { addToCart(versionId: $v, quantity: 1, answers: $a) { cart { lines { id lineTotal { amount } problem answers { questionId uploads { id kind } } } } } }', token, { v: ids.version, a: answers })
const rowsOf = async (cartToken: string) => {
  const cart = (await gql('{ cart { id } }', cartToken)).data?.['cart'] as { id: string } | null
  return cart ? db.sql<{ id: string; mime: string }[]>`select id, mime from shopper_upload where order_id = ${cart.id} order by created_at, id` : []
}

describe('a shopper’s files (#1369)', () => {
  let token = ''
  let first = ''

  it('starts a cart with the first file, handing its token back once, and keeps the file under the cart', async () => {
    const started = await send(null, ids.photo, jpeg())
    expect(started.status).toBe(200)
    expect(started.body).toMatchObject({ kind: 'image' })
    token = started.body.cartToken ?? ''
    first = started.body.id ?? ''
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    const next = await send(token, ids.photo, png())
    expect(next.body.cartToken).toBeNull()
    const rows = await rowsOf(token)
    expect(rows.map((r) => r.mime)).toEqual(['image/jpeg', 'image/png'])
    expect([...bucket.keys()].every((k) => k.startsWith(`stores/${storeId}/shopper-uploads/`))).toBe(true)
  })

  it('checks each file by its content against what the question takes', async () => {
    expect((await send(token, ids.photo, webp())).body.kind).toBe('image')
    expect((await send(token, ids.photo, heic())).body.kind).toBe('image')
    expect(code(await send(token, ids.photo, pdf()))).toBe('FILE_TYPE')
    expect((await send(token, ids.photoOrPdf, pdf())).body.kind).toBe('pdf')
    // A text file whatever its name says, and nothing at all.
    expect(code(await send(token, ids.photo, new Uint8Array(ascii('hello, not a photo'))))).toBe('FILE_TYPE')
    expect(code(await send(token, ids.photo, new Uint8Array()))).toBe('FILE_TYPE')
    const big = new Uint8Array(10 * 1024 * 1024 + 1)
    big.set([0xff, 0xd8, 0xff], 0)
    expect(code(await send(token, ids.photo, big))).toBe('FILE_TOO_LARGE')
    expect(code(await send(token, ids.hiddenQuestion, jpeg()))).toBe('UNKNOWN_QUESTION')
    expect(code(await send(token, crypto.randomUUID(), jpeg()))).toBe('UNKNOWN_QUESTION')
  })

  it('takes this cart’s own files as answers, for the question they were sent for, and prices the answer once', async () => {
    const otherToken = (await send(null, ids.photo, jpeg())).body.cartToken ?? ''
    const theirs = (await rowsOf(otherToken))[0]?.id ?? ''
    expect((await add(token, [{ questionId: ids.photo, uploadIds: [theirs] }])).problems?.[0]?.reason).toBe('UPLOAD_NOT_FOUND')
    const artwork = (await rowsOf(token)).find((r) => r.mime === 'application/pdf')?.id ?? ''
    expect((await add(token, [{ questionId: ids.photo, uploadIds: [artwork] }])).problems?.[0]?.reason).toBe('UPLOAD_NOT_FOUND')
    const added = await add(token, [{ questionId: ids.photo, uploadIds: [first] }])
    const line = (added.data?.['addToCart'] as { cart: { lines: { lineTotal: { amount: string }; problem: string | null; answers: { uploads: { id: string }[] }[] }[] } }).cart.lines[0]
    expect(line).toMatchObject({ lineTotal: { amount: '80000' }, problem: null, answers: [{ uploads: [{ id: first }] }] })
  })

  it('removes a file in the modal only from its own cart and only while no line names it, queuing its object’s deletion', async () => {
    expect((await remove(token, first)).body.errors?.[0]?.extensions.code).toBe('UPLOAD_IN_USE')
    const otherToken = (await send(null, ids.photo, jpeg())).body.cartToken ?? ''
    const theirs = (await rowsOf(otherToken))[0]?.id ?? ''
    expect((await remove(token, theirs)).body.errors?.[0]?.extensions.code).toBe('UPLOAD_NOT_FOUND')
    expect((await rowsOf(otherToken)).map((r) => r.id)).toEqual([theirs])
    const spare = (await rowsOf(token)).find((r) => r.mime === 'image/png')?.id ?? ''
    expect(await remove(token, spare)).toEqual({ status: 200, body: { removed: true } })
    expect((await rowsOf(token)).some((r) => r.id === spare)).toBe(false)
    const [queued] = await db.sql<{ payload: { key: string } }[]>`select payload from outbox where kind = 'upload.delete' and payload ->> 'key' like ${`%/${spare}`}`
    expect(queued?.payload.key).toMatch(new RegExp(`^stores/${storeId}/shopper-uploads/[0-9a-f-]{36}/${spare}$`))
    expect(bucket.has(queued?.payload.key ?? '')).toBe(true)
    // A row naming another store can't delete this store's file.
    await expect(uploadDeleteDeliverer(files).deliver({ payload: queued?.payload, storeId: crypto.randomUUID() } as never, new AbortController().signal)).rejects.toThrow()
    expect(bucket.has(queued?.payload.key ?? '')).toBe(true)
    await uploadDeleteDeliverer(files).deliver({ payload: queued?.payload, storeId } as never, new AbortController().signal)
    expect(bucket.has(queued?.payload.key ?? '')).toBe(false)
  })

  it('removes a line’s files with the line, unless another line still names them', async () => {
    const lines = ((await gql('{ cart { lines { id } } }', token)).data?.['cart'] as { lines: { id: string }[] }).lines
    await gql(`mutation { setCartQuantity(versionId: "${ids.version}", lineId: "${lines[0]?.id}", quantity: 0) { cart { id } } }`, token)
    expect((await rowsOf(token)).some((r) => r.id === first)).toBe(false)
    expect((await db.sql`select 1 from outbox where kind = 'upload.delete' and payload ->> 'key' like ${`%/${first}`}`).length).toBe(1)
  })

  it('holds a cart to 50 files and an address to its rate', async () => {
    const cart = (await gql('{ cart { id } }', token)).data?.['cart'] as { id: string }
    await db.sql`insert into shopper_upload (id, store_id, order_id, question_id, r2_key, mime, bytes, checksum)
      select gen_random_uuid(), ${storeId}, ${cart.id}, ${ids.photo}, 'stores/' || ${storeId} || '/shopper-uploads/' || ${cart.id} || '/' || gen_random_uuid(), 'image/jpeg', 10, ${'d'.repeat(64)}
      from generate_series(1, 50 - (select count(*)::int from shopper_upload where order_id = ${cart.id}))`
    expect(code(await send(token, ids.photo, jpeg()))).toBe('TOO_MANY_UPLOADS')
    addressOk = false
    expect((await send(token, ids.photo, jpeg())).status).toBe(429)
    addressOk = true
  })

  it('caps a body as it streams, whatever its header says', async () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 10)
    big.set([0xff, 0xd8, 0xff], 0)
    const chunked = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let at = 0; at < big.byteLength; at += 1024 * 1024) controller.enqueue(big.subarray(at, at + 1024 * 1024))
        controller.close()
      },
    })
    const response = await handleUpload(new Request(`https://${host}/shop-api/uploads?question=${ids.photo}`, { method: 'POST', body: chunked, duplex: 'half', headers: { 'x-shop-cart': token } } as RequestInit), await contextOf(token), files)
    expect(response.status).toBe(413)
  })

  it('holds the rows to their store and the shopper to its own cart; no request role reads a key', async () => {
    const cart = (await gql('{ cart { id } }', token)).data?.['cart'] as { id: string }
    const other = (await one(db.sql<{ id: string }[]>`insert into store (partner_id, name, code, country, pricing_currency, status) values (${t.partnerA}, 'Other prints', 'other-prints', 'IN', 'INR', 'active') returning id`)).id
    const person = (storeId: string, sellerScope: SellerScope = { kind: 'all' }): CallerContext => ({ caller: { kind: 'person', userId: crypto.randomUUID(), sessionId: 's' }, partnerId: t.partnerA, storeId, sellerScope, subscription: 'active' })
    const shopperOf = (storeId: string): CallerContext => ({ caller: { kind: 'shopper', customerId: null }, partnerId: t.partnerA, storeId, sellerScope: { kind: 'all' }, subscription: 'active' })
    const count = (context: CallerContext) => withScope(db.sql, context, async (tx) => (await tx<{ n: number }[]>`select count(*)::int as n from shopper_upload where order_id = ${cart.id}`)[0]?.n ?? 0)
    expect(await count(person(storeId))).toBeGreaterThan(0)
    expect(await count(person(other))).toBe(0)
    // A shopper with no token holds no cart: it sees none, and deletes none.
    expect(await count(shopperOf(storeId))).toBe(0)
    expect(await withScope(db.sql, shopperOf(storeId), async (tx) => (await tx`delete from shopper_upload where order_id = ${cart.id}`).count)).toBe(0)
    expect(await withScope(db.sql, shopperOf(other), async (tx) => (await tx`delete from shopper_upload where order_id = ${cart.id}`).count)).toBe(0)
    await expect(withScope(db.sql, shopperOf(other), (tx) => tx`insert into shopper_upload (id, store_id, order_id, r2_key, mime, bytes, checksum) values (${crypto.randomUUID()}, ${other}, ${cart.id}, ${`stores/${other}/shopper-uploads/${cart.id}/${crypto.randomUUID()}`}, 'image/png', 1, ${'f'.repeat(64)})`)).rejects.toThrow()
    await expect(withScope(db.sql, person(storeId), (tx) => tx`select r2_key from shopper_upload`)).rejects.toThrow(/permission denied/)
    await expect(withScope(db.sql, shopperOf(storeId), (tx) => tx`select r2_key from shopper_upload`)).rejects.toThrow(/permission denied/)
    await expect(withScope(db.sql, person(storeId, { kind: 'seller', sellerId: t.sellerA1First }), (tx) => tx`select id from shopper_upload`)).rejects.toThrow(/permission denied/)
    expect((await db.sql`select 1 from shopper_upload where order_id = ${cart.id}`).length).toBeGreaterThan(0)
  })

  it('lets the owner erase a file from its cart after the cart has expired', async () => {
    const cart = (await gql('{ cart { id } }', token)).data?.['cart'] as { id: string }
    const [loose] = await db.sql<{ id: string }[]>`
      select u.id from shopper_upload u where u.order_id = ${cart.id} and not exists (select 1 from cart_line l where l.order_id = u.order_id
        and l.answers is not null and jsonb_path_exists(l.answers, '$[*].uploads[*] ? (@ == $id)', jsonb_build_object('id', u.id::text))) limit 1`
    await db.sql`update "order" set cart_expires_at = now() - interval '1 day' where id = ${cart.id}`
    const gone = await remove(token, loose?.id ?? '')
    expect(gone).toMatchObject({ status: 200, body: { removed: true } })
    expect((await db.sql`select 1 from shopper_upload where id = ${loose?.id ?? ''}`).length).toBe(0)
    // Another cart's holder, or none, still finds nothing.
    const stranger = await send(null, ids.photo, jpeg())
    const still = (await db.sql<{ id: string }[]>`select id from shopper_upload where order_id = ${cart.id} limit 1`)[0]?.id ?? ''
    expect((await remove(stranger.body.cartToken ?? '', still)).status).toBe(404)
    await db.sql`update "order" set cart_expires_at = now() + interval '1 day' where id = ${cart.id}`
  })

  it('keys the per-cart limit on the cart the request opens, never on the header as sent', async () => {
    const keys: string[] = []
    const sent = async (header: string) =>
      handleUpload(new Request(`https://${host}/shop-api/uploads/${crypto.randomUUID()}`, { method: 'DELETE', headers: { 'x-shop-cart': header } }), { ...(await contextOf(header)), allowUploadToCart: async (key: string) => (keys.push(key), true) }, files)
    await sent('a'.repeat(64))
    await sent('b'.repeat(64))
    expect(keys).toEqual([`upload-cart:${storeId}:new:203.0.113.20`, `upload-cart:${storeId}:new:203.0.113.20`])
    const cart = (await gql('{ cart { id } }', token)).data?.['cart'] as { id: string }
    await sent(token)
    expect(keys[2]).toBe(`upload-cart:${storeId}:cart:${cart.id}`)
  })

  it('keeps a cart holding files out of the expired-cart sweep', async () => {
    const cart = (await gql('{ cart { id } }', token)).data?.['cart'] as { id: string }
    await db.sql`update "order" set cart_expires_at = now() - interval '1 day' where id = ${cart.id}`
    const { deleteExpiredCarts } = await import('#db/scoped/cart')
    const { withSystemScope } = await import('#db/scoped/index')
    await withSystemScope(db.sql, (tx) => deleteExpiredCarts(tx, new Date(), 100))
    expect((await db.sql`select 1 from "order" where id = ${cart.id}`).length).toBe(1)
  })
})

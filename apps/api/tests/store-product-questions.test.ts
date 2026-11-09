import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import type { CallerContext, SellerScope } from '#core/tenancy'
import { withScope, withSystemScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #1368: a product's questions through the Store API (CATALOG-DESIGN facts 49–57, U4–U13; DATA-MODEL §7.3): the
// merchant side writes any product's, a supplier its own products' only, a shopper reads only a visible product's.

let db: TestDatabase
let t: Tenants
const now = new Date('2026-11-09T09:00:00Z')
type Who = 'owner' | 'supplier' | 'otherSupplier' | 'bOwner'
const people: Record<Who, string> = { owner: '', supplier: '', otherSupplier: '', bOwner: '' }
const cookies: Record<Who, string> = { owner: '', supplier: '', otherSupplier: '', bOwner: '' }
const sellerOf: Partial<Record<Who, () => string>> = { supplier: () => t.sellerA1First, otherSupplier: () => t.sellerA1Second }

const user = async (partnerId: string, email: string, name: string) => {
  const [row] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${partnerId}, ${email}, ${name}, 'active') returning id`
  return row?.id ?? ''
}

const subscribe = async (storeId: string, partnerId: string) => {
  const [plan] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${partnerId}, 'Plan', 'live') returning id`
  await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) values (${plan?.id ?? ''}, ${partnerId}, 1, 'products', 50)`
  await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, enabled) values (${plan?.id ?? ''}, ${partnerId}, 1, 'offers', true)`
  await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) values (${plan?.id ?? ''}, ${partnerId}, 1, 'live_offers', 10)`
  await db.sql`update store set plan_id = ${plan?.id ?? ''}, pricing_currency = 'INR' where id = ${storeId}`
  await db.sql`delete from store_subscription where store_id = ${storeId}`
  await db.sql`
    insert into store_subscription (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end)
    values (${storeId}, ${partnerId}, ${plan?.id ?? ''}, 1, 'active', 'month', 'INR', 0, ${now}, ${new Date(now.getTime() + 30 * 86_400_000)})
  `
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update seller set access_level = 'vendor-catalogue' where id in (${t.sellerA1First}, ${t.sellerA1Second})`
  people.owner = await user(t.partnerA, 'owner@q.example', 'Olivia Owner')
  people.supplier = await user(t.partnerA, 'anand@q.example', 'Anand')
  people.otherSupplier = await user(t.partnerA, 'bhatia@q.example', 'Bhatia')
  people.bOwner = await user(t.partnerB, 'owner@qb.example', 'Bea Owner')
  await db.sql`insert into membership (user_id, store_id, role_key, status) values (${people.owner}, ${t.storeA1}, 'owner', 'active'), (${people.bOwner}, ${t.storeB1}, 'owner', 'active')`
  await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${people.supplier}, ${t.storeA1}, ${t.sellerA1First}, 'supplier-admin', 'active'), (${people.otherSupplier}, ${t.storeA1}, ${t.sellerA1Second}, 'supplier-admin', 'active')`
  await subscribe(t.storeA1, t.partnerA)
  await subscribe(t.storeB1, t.partnerB)
  await db.sql`insert into store_currency (store_id, currency, mode) values (${t.storeA1}, 'USD', 'manual')`
  for (const who of Object.keys(cookies) as Who[]) {
    cookies[who] = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: people[who], partnerId: who === 'bOwner' ? t.partnerB : t.partnerA }, now))
  }
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

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

const save = `mutation Save($id: ID, $revision: Int, $input: ProductInput!) { saveProduct(id: $id, revision: $revision, input: $input) { id revision approval reviewed } }`
const questionFields = `id kind label help required minPicks maxPicks freePicks maxLength multiline example accept maxFiles versionIds
  shownIf { questionId choiceId } price { mode per percentBps amounts { currency amount } versionAmounts { versionId amounts { currency amount } } }
  choices { id label available maxQuantity price { mode per percentBps amounts { currency amount } versionAmounts { versionId amounts { currency amount } } } }`
const read = (id: string, who: Who = 'owner') => gql(`query P($id: ID!) { product(id: $id) { revision versions { id } questions { ${questionFields} } } }`, who, { id })

type Saved = { id: string; revision: number; approval: string | null; reviewed: string[] }
type Q = { id: string; kind: string; label: string; required: boolean; maxPicks: number | null; versionIds: string[] | null; shownIf: { questionId: string; choiceId: string } | null; price: { mode: string; amounts: { currency: string; amount: string }[]; versionAmounts: { versionId: string }[] } | null; choices: { id: string; label: string; available: boolean; price: { amounts: { amount: string }[] } | null }[] }

const inr = (amount: string) => [{ currency: 'INR', amount }]
const sized = (name: string, questions: unknown[]) => ({
  name,
  options: [{ name: 'Size', values: [{ name: 'Small' }, { name: 'Large' }] }],
  versions: [
    { choices: ['Small'], prices: inr('30000') },
    { choices: ['Large'], prices: inr('45000') },
  ],
  questions,
})
const cake = [
  {
    kind: 'CHOICE',
    label: 'Toppings',
    maxPicks: 3,
    freePicks: 1,
    choices: [
      { label: 'Cheese', price: { mode: 'FIXED', per: 'ITEM', amounts: inr('3000'), versionAmounts: [{ version: 1, amounts: inr('5000') }] } },
      { label: 'Olives', maxQuantity: 2, price: { mode: 'PERCENT', per: 'ITEM', percentBps: 1000 } },
    ],
  },
  { kind: 'CHOICE', label: 'Gift wrap', choices: [{ label: 'Yes', price: { mode: 'FIXED', per: 'LINE', amounts: [...inr('5000'), { currency: 'USD', amount: '100' }] } }] },
  { kind: 'TEXT', label: 'Message on the cake', required: true, maxLength: 40, example: 'Happy birthday', price: { mode: 'PER_CHARACTER', per: 'ITEM', amounts: inr('1000') }, shownIf: { question: 1, choice: 0 } },
  { kind: 'UPLOAD', label: 'Your photo', accept: 'IMAGE_PDF', maxFiles: 2, versions: [1] },
]

describe('questions on a product (#1368)', () => {
  let id = ''

  it('saves every kind of question with the product, and reads them back in order', async () => {
    const made = await gql(save, 'owner', { input: sized('Birthday cake', cake) })
    expect(made.errors).toBeUndefined()
    id = (made.data?.['saveProduct'] as Saved).id
    const product = (await read(id)).data?.['product'] as { versions: { id: string }[]; questions: Q[] }
    const [toppings, wrap, message, photo] = product.questions
    expect(product.questions.map((q) => [q.kind, q.label, q.required])).toEqual([
      ['CHOICE', 'Toppings', false],
      ['CHOICE', 'Gift wrap', false],
      ['TEXT', 'Message on the cake', true],
      ['UPLOAD', 'Your photo', false],
    ])
    expect(toppings?.choices[0]?.price?.amounts).toEqual([{ currency: 'INR', amount: '3000' }])
    expect(toppings?.choices.map((c) => c.label)).toEqual(['Cheese', 'Olives'])
    expect((toppings?.choices[0]?.price as unknown as { versionAmounts: { versionId: string }[] }).versionAmounts[0]?.versionId).toBe(product.versions[1]?.id)
    expect(wrap?.choices[0]?.price?.amounts).toHaveLength(2)
    expect(message?.shownIf).toEqual({ questionId: wrap?.id, choiceId: wrap?.choices[0]?.id })
    expect(photo?.versionIds).toEqual([product.versions[1]?.id])
  })

  it('keeps question and choice ids across a save, so a cart’s answers still name them', async () => {
    const before = (await read(id)).data?.['product'] as { revision: number; questions: Q[] }
    const kept: Record<string, unknown>[] = before.questions.map((q, qi) => ({
      ...cake[qi],
      id: q.id,
      ...(q.choices.length > 0 ? { choices: (cake[qi] as { choices: Record<string, unknown>[] }).choices.map((c, ci) => ({ ...c, id: q.choices[ci]?.id })) } : {}),
    }))
    kept[0] = { ...kept[0], label: 'Extra toppings' }
    const saved = await gql(save, 'owner', { id, revision: before.revision, input: sized('Birthday cake', kept) })
    expect(saved.errors).toBeUndefined()
    const after = (await read(id)).data?.['product'] as { questions: Q[] }
    expect(after.questions.map((q) => q.id)).toEqual(before.questions.map((q) => q.id))
    expect(after.questions[0]?.label).toBe('Extra toppings')
    expect(after.questions[0]?.choices.map((c) => c.id)).toEqual(before.questions[0]?.choices.map((c) => c.id))
  })

  it('leaves the questions as they are when a save sends none, and removes them on []', async () => {
    const { revision, versions } = (await read(id)).data?.['product'] as { revision: number; versions: { id: string }[] }
    // The same versions by id, as the editor sends them, so the questions' version amounts and limits still apply.
    const plain = sized('Birthday cake', [])
    const noQuestions: Record<string, unknown> = { ...plain, versions: plain.versions.map((v, i) => ({ ...v, id: versions[i]?.id })) }
    delete noQuestions['questions']
    await gql(save, 'owner', { id, revision, input: noQuestions })
    expect(((await read(id)).data?.['product'] as { questions: Q[] }).questions).toHaveLength(4)
    const copy = await gql(save, 'owner', { input: sized('Plain cake', []) })
    expect(((await read((copy.data?.['saveProduct'] as Saved).id)).data?.['product'] as { questions: Q[] }).questions).toEqual([])
  })

  it('refuses an 11th question and a 51st choice with the limit, and says which question is wrong', async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({ kind: 'TEXT', label: `Q${i}` }))
    const limit = await gql(save, 'owner', { input: sized('Too many', eleven) })
    expect(limit.code).toBe('QUESTION_LIMIT')
    expect(limit.errors?.[0]?.extensions['limit']).toBe(10)
    const choices = await gql(save, 'owner', { input: sized('Too many choices', [{ kind: 'CHOICE', label: 'Pick', choices: Array.from({ length: 51 }, (_, i) => ({ label: `C${i}` })) }]) })
    expect(choices.code).toBe('CHOICE_LIMIT')
    expect(choices.errors?.[0]?.extensions['limit']).toBe(50)
    const twoDeep = await gql(save, 'owner', {
      input: sized('Two deep', [
        { kind: 'CHOICE', label: 'A', choices: [{ label: 'a' }] },
        { kind: 'CHOICE', label: 'B', choices: [{ label: 'b' }], shownIf: { question: 0, choice: 0 } },
        { kind: 'TEXT', label: 'C', shownIf: { question: 1, choice: 0 } },
      ]),
    })
    expect(twoDeep.code).toBe('INVALID_QUESTION')
    expect(twoDeep.errors?.[0]?.extensions).toMatchObject({ question: 1, field: 'shownIf' })
    const noBase = await gql(save, 'owner', { input: sized('No base amount', [{ kind: 'TEXT', label: 'Name', price: { mode: 'FIXED', per: 'ITEM', amounts: [{ currency: 'USD', amount: '100' }] } }]) })
    expect(noBase.errors?.[0]?.extensions).toMatchObject({ code: 'INVALID_QUESTION', question: 0, field: 'price' })
    const unsold = await gql(save, 'owner', { input: sized('Unsold', [{ kind: 'TEXT', label: 'Name', price: { mode: 'FIXED', per: 'ITEM', amounts: [...inr('100'), { currency: 'EUR', amount: '1' }] } }]) })
    expect(unsold.code).toBe('CURRENCY_NOT_SOLD')
    const required = await gql(save, 'owner', { input: sized('Required none', [{ kind: 'CHOICE', label: 'Pick', required: true, minPicks: 0, choices: [{ label: 'x' }] }]) })
    expect(required.errors?.[0]?.extensions).toMatchObject({ code: 'INVALID_QUESTION', field: 'picks' })
  })

  it('refuses a question id that isn’t this product’s', async () => {
    const other = await gql(save, 'owner', { input: sized('Other cake', [{ kind: 'TEXT', label: 'Name' }]) })
    const otherQuestion = (((await read((other.data?.['saveProduct'] as Saved).id)).data?.['product'] as { questions: Q[] }).questions[0] as Q).id
    const { revision } = (await read(id)).data?.['product'] as { revision: number }
    expect((await gql(save, 'owner', { id, revision, input: sized('Birthday cake', [{ id: otherQuestion, kind: 'TEXT', label: 'Stolen' }]) })).code).toBe('INVALID_INPUT')
  })

  it('copies every question to another product, keeping version amounts only where the choices match', async () => {
    const target = await gql(save, 'owner', {
      input: { name: 'Cupcake', options: [{ name: 'Size', values: [{ name: 'Small' }] }], versions: [{ choices: ['Small'], prices: inr('10000') }] },
    })
    const saved = target.data?.['saveProduct'] as Saved
    const copied = await gql(
      `mutation C($from: ID!, $to: ID!, $revision: Int!) { copyProductQuestions(fromProductId: $from, toProductId: $to, revision: $revision) { product { id revision } droppedAmounts droppedVersionLimits droppedPhotos } }`,
      'owner',
      { from: id, to: saved.id, revision: saved.revision },
    )
    expect(copied.errors).toBeUndefined()
    // Cheese's Large amount and the photo question's Large-only limit have no version here.
    expect(copied.data?.['copyProductQuestions']).toMatchObject({ product: { revision: saved.revision + 1 }, droppedAmounts: 1, droppedVersionLimits: 1, droppedPhotos: 0 })
    const questions = ((await read(saved.id)).data?.['product'] as { questions: Q[] }).questions
    expect(questions.map((q) => q.label)).toEqual(['Extra toppings', 'Gift wrap', 'Message on the cake', 'Your photo'])
    expect(questions[2]?.shownIf?.choiceId).toBe(questions[1]?.choices[0]?.id)
    expect(questions[3]?.versionIds).toBeNull()
    const stale = await gql(`mutation C($from: ID!, $to: ID!) { copyProductQuestions(fromProductId: $from, toProductId: $to, revision: 1) { droppedAmounts } }`, 'owner', { from: id, to: saved.id })
    expect(stale.code).toBe('STALE_REVISION')
  })

  it('duplicates a product with its questions under new ids, conditions and version limits following the copy', async () => {
    const before = (await read(id)).data?.['product'] as { questions: Q[] }
    const made = await gql('mutation D($id: ID!) { duplicateProduct(id: $id) { id } }', 'owner', { id })
    const copyId = (made.data?.['duplicateProduct'] as { id: string }).id
    const copy = (await read(copyId)).data?.['product'] as { versions: { id: string }[]; questions: Q[] }
    expect(copy.questions.map((q) => q.label)).toEqual(before.questions.map((q) => q.label))
    expect(copy.questions.map((q) => q.id).some((x) => before.questions.some((b) => b.id === x))).toBe(false)
    expect(copy.questions[2]?.shownIf).toEqual({ questionId: copy.questions[1]?.id, choiceId: copy.questions[1]?.choices[0]?.id })
    expect(copy.questions[3]?.versionIds).toEqual([copy.versions[1]?.id])
  })

  it('refuses a choice photo that isn’t an image of this store', async () => {
    const file = async (storeId: string, kind: string, mime: string) =>
      (await db.sql<{ id: string }[]>`insert into asset (store_id, r2_key, kind, mime, bytes, checksum) values (${storeId}, ${`stores/${storeId}/assets/${crypto.randomUUID()}.bin`}, ${kind}, ${mime}, 10, ${'b'.repeat(64)}) returning id`)[0]?.id ?? ''
    const withPhoto = (photoAssetId: string) => sized('Photo cake', [{ kind: 'CHOICE', label: 'Shape', choices: [{ label: 'Round', photoAssetId }] }])
    expect((await gql(save, 'owner', { input: withPhoto(await file(t.storeB1, 'image', 'image/jpeg')) })).code).toBe('FILE_REFUSED')
    expect((await gql(save, 'owner', { input: withPhoto(await file(t.storeA1, 'video', 'video/mp4')) })).code).toBe('FILE_REFUSED')
    expect((await gql(save, 'owner', { input: withPhoto(await file(t.storeA1, 'image', 'image/jpeg')) })).errors).toBeUndefined()
  })

  it('copies nothing between stores', async () => {
    const theirs = await gql(save, 'bOwner', { input: sized('Their cake', []) })
    const target = theirs.data?.['saveProduct'] as Saved
    expect((await gql(`mutation C($from: ID!, $to: ID!, $r: Int!) { copyProductQuestions(fromProductId: $from, toProductId: $to, revision: $r) { droppedAmounts } }`, 'bOwner', { from: id, to: target.id, r: target.revision })).code).toBe('NOT_FOUND')
  })

  it('tells the offer editor whether the store asks any questions', async () => {
    expect((await gql('{ hasCustomisation }', 'owner')).data?.['hasCustomisation']).toBe(true)
    expect((await gql('{ hasCustomisation }', 'bOwner')).data?.['hasCustomisation']).toBe(false)
  })
})

describe('suppliers’ questions (ACCESS §7.1–7.2)', () => {
  it('writes questions on its own products only, and an extra’s price sends an approved product back', async () => {
    const own = await gql(save, 'supplier', { input: { ...sized('Engraved pen', [{ kind: 'TEXT', label: 'Name to engrave' }]), options: [{ name: 'Size', values: [{ name: 'Small' }, { name: 'Large' }] }] } })
    expect(own.errors).toBeUndefined()
    const pen = own.data?.['saveProduct'] as Saved
    const merchant = await gql(save, 'owner', { input: sized('Store mug', [{ kind: 'TEXT', label: 'Name' }]) })
    const mug = merchant.data?.['saveProduct'] as Saved
    expect((await read(mug.id, 'supplier')).data?.['product']).toBeNull()
    expect((await read(pen.id, 'otherSupplier')).data?.['product']).toBeNull()
    expect((await gql(`mutation C($from: ID!, $to: ID!) { copyProductQuestions(fromProductId: $from, toProductId: $to, revision: 1) { droppedAmounts } }`, 'supplier', { from: mug.id, to: pen.id })).code).toBe('NOT_FOUND')
    // A supplier types amounts in the pricing currency only.
    const usd = await gql(save, 'supplier', { id: pen.id, revision: pen.revision, input: sized('Engraved pen', [{ kind: 'TEXT', label: 'Name to engrave', price: { mode: 'FIXED', per: 'ITEM', amounts: [...inr('500'), { currency: 'USD', amount: '10' }] } }]) })
    expect(usd.code).toBe('CURRENCY_NOT_SOLD')

    await db.sql`update store set vendor_products_require_approval = true where id = ${t.storeA1}`
    await db.sql`update product set approval_status = 'approved' where id = ${pen.id}`
    const { revision, questions, versions } = (await read(pen.id, 'supplier')).data?.['product'] as { revision: number; questions: Q[]; versions: { id: string }[] }
    // The same versions, by id: a version without one is new, and a new version brings a price.
    const pen2 = (qs: unknown[]) => {
      const input = sized('Engraved pen', qs)
      return { ...input, versions: input.versions.map((v, i) => ({ ...v, id: versions[i]?.id })) }
    }
    const relabel = await gql(save, 'supplier', { id: pen.id, revision, input: pen2([{ id: questions[0]?.id, kind: 'TEXT', label: 'Name on the pen' }]) })
    expect(relabel.data?.['saveProduct']).toMatchObject({ approval: 'approved', reviewed: [] })
    const priced = await gql(save, 'supplier', { id: pen.id, revision: revision + 1, input: pen2([{ id: questions[0]?.id, kind: 'TEXT', label: 'Name on the pen', price: { mode: 'FIXED', per: 'ITEM', amounts: inr('500') } }]) })
    expect(priced.data?.['saveProduct']).toMatchObject({ approval: 'pending', reviewed: ['price'] })
    // Raising a per-character question's length raises what shoppers can be charged: it goes back too.
    await db.sql`update product set approval_status = 'approved' where id = ${pen.id}`
    const perChar = (maxLength: number) => pen2([{ id: questions[0]?.id, kind: 'TEXT', label: 'Name on the pen', maxLength, price: { mode: 'PER_CHARACTER', per: 'ITEM', amounts: inr('50') } }])
    const atRevision = async () => ((await read(pen.id, 'supplier')).data?.['product'] as { revision: number }).revision
    await gql(save, 'supplier', { id: pen.id, revision: await atRevision(), input: perChar(20) })
    await db.sql`update product set approval_status = 'approved' where id = ${pen.id}`
    expect((await gql(save, 'supplier', { id: pen.id, revision: await atRevision(), input: perChar(200) })).data?.['saveProduct']).toMatchObject({ approval: 'pending', reviewed: ['price'] })
    // Making a priced question required makes every shopper pay it: back too. Relabelling it doesn't.
    await db.sql`update product set approval_status = 'approved' where id = ${pen.id}`
    const required = pen2([{ id: questions[0]?.id, kind: 'TEXT', label: 'Name on the pen', required: true, maxLength: 200, price: { mode: 'PER_CHARACTER', per: 'ITEM', amounts: inr('50') } }])
    expect((await gql(save, 'supplier', { id: pen.id, revision: await atRevision(), input: required })).data?.['saveProduct']).toMatchObject({ approval: 'pending', reviewed: ['price'] })
    // A priced list's maximum picks: more picks, more to pay. Back too.
    const toppings = (maxPicks: number) => pen2([{ id: questions[0]?.id, kind: 'TEXT', label: 'Name on the pen', required: true, maxLength: 200, price: { mode: 'PER_CHARACTER', per: 'ITEM', amounts: inr('50') } }, { kind: 'CHOICE', label: 'Charms', maxPicks, choices: [{ label: 'Star', price: { mode: 'FIXED', per: 'ITEM', amounts: inr('100') } }] }])
    await gql(save, 'supplier', { id: pen.id, revision: await atRevision(), input: toppings(1) })
    const charms = ((await read(pen.id, 'supplier')).data?.['product'] as { questions: Q[] }).questions[1]
    await db.sql`update product set approval_status = 'approved' where id = ${pen.id}`
    const raised = pen2([{ id: questions[0]?.id, kind: 'TEXT', label: 'Name on the pen', required: true, maxLength: 200, price: { mode: 'PER_CHARACTER', per: 'ITEM', amounts: inr('50') } }, { id: charms?.id, kind: 'CHOICE', label: 'Charms', maxPicks: 3, choices: [{ id: charms?.choices[0]?.id, label: 'Star', maxQuantity: 3, price: { mode: 'FIXED', per: 'ITEM', amounts: inr('100') } }] }])
    expect((await gql(save, 'supplier', { id: pen.id, revision: await atRevision(), input: raised })).data?.['saveProduct']).toMatchObject({ approval: 'pending', reviewed: ['price'] })
    await db.sql`update product set approval_status = 'approved' where id = ${pen.id}`
    const back = pen2([{ id: questions[0]?.id, kind: 'TEXT', label: 'Name on the pen', required: true, maxLength: 200, price: { mode: 'PER_CHARACTER', per: 'ITEM', amounts: inr('50') } }])
    await gql(save, 'supplier', { id: pen.id, revision: await atRevision(), input: back })
    await db.sql`update product set approval_status = 'approved' where id = ${pen.id}`
    // Widening a priced question to more versions makes more shoppers pay it: back too.
    const limited = (versions: number[]) => pen2([{ id: questions[0]?.id, kind: 'TEXT', label: 'Name on the pen', required: true, maxLength: 200, versions, price: { mode: 'PER_CHARACTER', per: 'ITEM', amounts: inr('50') } }])
    await gql(save, 'supplier', { id: pen.id, revision: await atRevision(), input: limited([0]) })
    await db.sql`update product set approval_status = 'approved' where id = ${pen.id}`
    expect((await gql(save, 'supplier', { id: pen.id, revision: await atRevision(), input: limited([0, 1]) })).data?.['saveProduct']).toMatchObject({ approval: 'pending', reviewed: ['price'] })
    await db.sql`update store set vendor_products_require_approval = false where id = ${t.storeA1}`
  })

  it('copies a merchant product’s questions onto a supplier’s without its photos or the currencies the supplier can’t type', async () => {
    const cake = (await db.sql<{ id: string }[]>`select id from product where store_id = ${t.storeA1} and name = 'Birthday cake' order by created_at limit 1`)[0]?.id ?? ''
    const pen = (await db.sql<{ id: string; revision: number }[]>`select id, revision from product where store_id = ${t.storeA1} and name = 'Engraved pen'`)[0]
    const [photo] = await db.sql<{ id: string }[]>`insert into asset (store_id, r2_key, kind, mime, bytes, checksum)
      values (${t.storeA1}, ${`stores/${t.storeA1}/assets/${crypto.randomUUID()}.jpg`}, 'image', 'image/jpeg', 10, ${'c'.repeat(64)}) returning id`
    await db.sql`update product_question_choice set photo_asset_id = ${photo?.id ?? ''} where id = (select id from product_question_choice where product_id = ${cake} order by position limit 1)`
    const copied = await gql(
      `mutation C($from: ID!, $to: ID!, $r: Int!) { copyProductQuestions(fromProductId: $from, toProductId: $to, revision: $r) { droppedAmounts droppedVersionLimits droppedPhotos } }`,
      'owner',
      { from: cake, to: pen?.id, r: pen?.revision },
    )
    expect(copied.errors).toBeUndefined()
    // The gift wrap's USD amount (a manual currency) and the choice photo: the pen has both sizes, so nothing else drops.
    expect(copied.data?.['copyProductQuestions']).toEqual({ droppedAmounts: 1, droppedVersionLimits: 0, droppedPhotos: 1 })
    // A supplier can't put the merchant's photo, in use on the cake, on its own choice.
    const { revision, versions } = (await read(pen?.id ?? '', 'supplier')).data?.['product'] as { revision: number; versions: { id: string }[] }
    const input = sized('Engraved pen', [{ kind: 'CHOICE', label: 'Box', choices: [{ label: 'Gift box', photoAssetId: photo?.id }] }])
    const borrowed = await gql(save, 'supplier', { id: pen?.id, revision, input: { ...input, versions: input.versions.map((v, i) => ({ ...v, id: versions[i]?.id })) } })
    expect(borrowed.code).toBe('FILE_REFUSED')
  })
})

describe('who reads the question rows (DATA-MODEL §7.11)', () => {
  const caller = (sellerScope: SellerScope, storeId = t.storeA1, partnerId = t.partnerA): CallerContext => ({
    caller: { kind: 'person', userId: '00000000-0000-4000-8000-0000000000aa', sessionId: 's' },
    partnerId,
    storeId,
    sellerScope,
    subscription: 'active',
  })
  const shopper = (storeId = t.storeA1, partnerId = t.partnerA): CallerContext => ({ caller: { kind: 'shopper', customerId: null }, partnerId, storeId, sellerScope: { kind: 'all' }, subscription: 'active' })

  it('holds a supplier to its own products’, another store to none, and a shopper to visible products’, on every question table', async () => {
    const tables = ['product_question', 'product_question_choice', 'product_question_amount', 'product_question_version'] as const
    const counts = (context: CallerContext) =>
      withScope(db.sql, context, async (tx) => Object.fromEntries(await Promise.all(tables.map(async (table) => [table, (await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from ${table}`))[0]?.n ?? 0] as const))))
    const cake = (await db.sql<{ id: string }[]>`select id from product where store_id = ${t.storeA1} and name = 'Birthday cake' order by created_at limit 1`)[0]?.id ?? ''
    const cakeRows = Object.fromEntries(await Promise.all(tables.map(async (table) => [table, (await db.sql.unsafe<{ n: number }[]>(`select count(*)::int as n from ${table} where product_id = $1`, [cake]))[0]?.n ?? 0] as const)))
    expect(cakeRows).toMatchObject({ product_question: 4, product_question_version: 1 })
    expect(cakeRows['product_question_choice']).toBeGreaterThan(0)
    expect(cakeRows['product_question_amount']).toBeGreaterThan(0)

    const all = await counts(caller({ kind: 'all' }))
    const supplier = await counts(caller({ kind: 'seller', sellerId: t.sellerA1First }))
    expect(all['product_question']).toBeGreaterThan(supplier['product_question'] ?? 0)
    expect(supplier['product_question']).toBeGreaterThan(0)
    for (const table of tables) {
      expect({ table, other: (await counts(caller({ kind: 'seller', sellerId: t.sellerA1Second })))[table] }).toEqual({ table, other: 0 })
      expect({ table, storeB: (await counts(caller({ kind: 'all' }, t.storeB1, t.partnerB)))[table] }).toEqual({ table, storeB: 0 })
      expect({ table, shopperB: (await counts(shopper(t.storeB1, t.partnerB)))[table] }).toEqual({ table, shopperB: 0 })
    }

    // A choice's photo and a question's translation reach a shopper with the product, and leave with it.
    const [asset] = await db.sql<{ id: string }[]>`insert into asset (store_id, r2_key, kind, mime, bytes, checksum)
      values (${t.storeA1}, ${`stores/${t.storeA1}/assets/${crypto.randomUUID()}.jpg`}, 'image', 'image/jpeg', 10, ${'a'.repeat(64)}) returning id`
    const firstChoice = (await db.sql<{ id: string; question_id: string }[]>`select id, question_id from product_question_choice where product_id = ${cake} order by position limit 1`)[0]
    await db.sql`update product_question_choice set photo_asset_id = ${asset?.id ?? ''} where id = ${firstChoice?.id ?? ''}`
    await db.sql`insert into store_language (store_id, language, status) values (${t.storeA1}, 'hi-IN', 'active') on conflict do nothing`
    await db.sql`insert into translation (store_id, entity, entity_id, field, language, text, source_hash) values (${t.storeA1}, 'question', ${firstChoice?.question_id ?? ''}, 'name', 'hi-IN', 'टॉपिंग', md5('Extra toppings'))`
    const shopperSees = () =>
      withScope(db.sql, shopper(), async (tx) => ({
        photo: (await tx<{ n: number }[]>`select count(*)::int as n from asset where id = ${asset?.id ?? ''}`)[0]?.n ?? 0,
        words: (await tx<{ n: number }[]>`select count(*)::int as n from translation where entity = 'question' and entity_id = ${firstChoice?.question_id ?? ''}`)[0]?.n ?? 0,
      }))
    expect(await shopperSees()).toEqual({ photo: 1, words: 1 })
    const visible = await counts(shopper())
    await db.sql`update product set visibility = 'hidden' where id = ${cake}`
    const hidden = await counts(shopper())
    for (const table of tables) expect({ table, gone: (visible[table] ?? 0) - (hidden[table] ?? 0) }).toEqual({ table, gone: cakeRows[table] })
    expect(await shopperSees()).toEqual({ photo: 0, words: 0 })
    await db.sql`update product set visibility = 'visible' where id = ${cake}`
  })

  it('never lets a supplier write into another owner’s questions', async () => {
    const theirs = (await db.sql<{ id: string }[]>`select q.id from product_question q join product p on p.id = q.product_id where p.seller_id = ${t.sellerA1First} limit 1`)[0]?.id ?? ''
    const merchants = (await db.sql<{ id: string; product_id: string }[]>`select q.id, q.product_id from product_question q join product p on p.id = q.product_id where p.store_id = ${t.storeA1} and p.seller_id is null limit 1`)[0]
    const other = caller({ kind: 'seller', sellerId: t.sellerA1Second })
    await expect(withScope(db.sql, other, (tx) => tx`insert into product_question_choice (question_id, product_id, store_id, label, position) values (${theirs}, ${merchants?.product_id ?? ''}, ${t.storeA1}, 'Sneaky', 9)`)).rejects.toThrow()
    expect(await withScope(db.sql, other, async (tx) => (await tx`update product_question set label = 'Taken' where id = ${theirs}`).count)).toBe(0)
    expect(await withScope(db.sql, other, async (tx) => (await tx`delete from product_question where id = ${merchants?.id ?? ''}`).count)).toBe(0)
    await expect(withScope(db.sql, other, (tx) => tx`insert into product_question (product_id, store_id, kind, label, position, multiline, max_length) values (${merchants?.product_id ?? ''}, ${t.storeA1}, 'text', 'Mine now', 9, false, 10)`)).rejects.toThrow()
  })
})

describe('offers’ customisation switch (OFFERS-DESIGN §3.1)', () => {
  it('is on unless the offer turns it off', async () => {
    const input = (include?: boolean) => ({
      name: 'Ten off',
      trigger: 'automatic',
      enabled: false,
      combines: { product: false, order: false, shipping: false },
      conditions: [],
      action: { operation: 'order_percentage_discount', percent: 10 },
      ...(include === undefined ? {} : { includeCustomisation: include }),
    })
    const saveOffer = 'mutation O($input: OfferInput!, $id: ID, $revision: Int) { saveOffer(id: $id, revision: $revision, input: $input) { id revision } }'
    const include = async (id: string) => ((await gql('query O($id: ID!) { offer(id: $id) { includeCustomisation } }', 'owner', { id })).data?.['offer'] as { includeCustomisation: boolean }).includeCustomisation
    const made = await gql(saveOffer, 'owner', { input: input() })
    expect(made.errors).toBeUndefined()
    const offer = made.data?.['saveOffer'] as { id: string; revision: number }
    expect(await include(offer.id)).toBe(true)
    expect((await gql(saveOffer, 'owner', { id: offer.id, revision: offer.revision, input: input(false) })).errors).toBeUndefined()
    expect(await include(offer.id)).toBe(false)
    // An edit that doesn't send the switch (an older client, an API key) leaves it as it is.
    expect((await gql(saveOffer, 'owner', { id: offer.id, revision: offer.revision + 1, input: { ...input(), name: 'Ten percent off' } })).errors).toBeUndefined()
    expect(await include(offer.id)).toBe(false)
  })
})

import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import { resolveShopper } from '#auth/shopCaller'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #1368: a shopper answers a product's questions as it goes in the cart; the engine checks and prices the answers on
// every read and snapshots them on the order (PLATFORM-PROMPT §5.4 "Product customisation"; DATA-MODEL §7.6).

let db: TestDatabase
let t: Tenants
let storeId = ''
const host = 'cakes.shop.example'
const ids = { product: '', small: '', large: '', plain: '', toppings: '', cheese: '', olives: '', wrap: '', wrapYes: '', message: '' }

const one = async <T extends object>(rows: Promise<T[]>): Promise<T> => {
  const [row] = await rows
  if (!row) throw new Error('no row')
  return row
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update partner set state = 'live' where id = ${t.partnerA}`
  storeId = (await one(db.sql<{ id: string }[]>`insert into store (partner_id, name, code, country, pricing_currency, status, address) values
    (${t.partnerA}, 'Cakes', 'cakes', 'IN', 'INR', 'active', '{"street": "1 MI Road", "city": "Jaipur", "postal": "302001", "region": "Rajasthan"}') returning id`)).id
  ids.product = (await one(db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility) values (${storeId}, 'Birthday cake', 'birthday-cake', 'visible') returning id`)).id
  for (const [key, price, position] of [['small', '30000', 0], ['large', '45000', 1]] as const) {
    ids[key] = (await one(db.sql<{ id: string }[]>`insert into product_version (store_id, product_id, sku, position, track_stock) values (${storeId}, ${ids.product}, ${key}, ${position}, false) returning id`)).id
    await db.sql`insert into version_price (version_id, store_id, currency, amount) values (${ids[key]}, ${storeId}, 'INR', ${price})`
  }
  const plainProduct = (await one(db.sql<{ id: string }[]>`insert into product (store_id, name, slug, visibility) values (${storeId}, 'Plain bun', 'plain-bun', 'visible') returning id`)).id
  ids.plain = (await one(db.sql<{ id: string }[]>`insert into product_version (store_id, product_id, sku, position, track_stock) values (${storeId}, ${plainProduct}, 'bun', 0, false) returning id`)).id
  await db.sql`insert into version_price (version_id, store_id, currency, amount) values (${ids.plain}, ${storeId}, 'INR', '5000')`

  const question = (sql: { kind: string; label: string; position: number; extra: Record<string, unknown> }) =>
    one(db.sql<{ id: string }[]>`insert into product_question ${db.sql({ product_id: ids.product, store_id: storeId, kind: sql.kind, label: sql.label, position: sql.position, ...sql.extra })} returning id`)
  ids.toppings = (await question({ kind: 'choice', label: 'Toppings', position: 1, extra: { min_picks: 0, max_picks: 3, free_picks: 0, required: false } })).id
  ids.wrap = (await question({ kind: 'choice', label: 'Gift wrap', position: 2, extra: { min_picks: 0, max_picks: 1, free_picks: 0, required: false } })).id
  ids.message = (await question({ kind: 'text', label: 'Message', position: 3, extra: { max_length: 20, multiline: false, required: true, price_mode: 'per_character', price_per: 'item' } })).id
  const choice = (questionId: string, label: string, position: number, extra: Record<string, unknown>) =>
    one(db.sql<{ id: string }[]>`insert into product_question_choice ${db.sql({ question_id: questionId, product_id: ids.product, store_id: storeId, label, position, ...extra })} returning id`)
  ids.cheese = (await choice(ids.toppings, 'Cheese', 1, { price_mode: 'fixed', price_per: 'item', max_quantity: 2 })).id
  ids.olives = (await choice(ids.toppings, 'Olives', 2, { price_mode: 'percent', price_bps: 1000, price_per: 'item' })).id
  ids.wrapYes = (await choice(ids.wrap, 'Yes', 1, { price_mode: 'fixed', price_per: 'line' })).id
  await db.sql`update product_question set shown_if_choice_id = ${ids.wrapYes} where id = ${ids.message}`
  await db.sql`insert into product_question_amount (store_id, product_id, choice_id, version_id, currency, amount) values
    (${storeId}, ${ids.product}, ${ids.cheese}, null, 'INR', 3000), (${storeId}, ${ids.product}, ${ids.cheese}, ${ids.large}, 'INR', 5000),
    (${storeId}, ${ids.product}, ${ids.wrapYes}, null, 'INR', 5000)`
  await db.sql`insert into product_question_amount (store_id, product_id, question_id, currency, amount) values (${storeId}, ${ids.product}, ${ids.message}, 'INR', 100)`
  await db.sql`insert into store_shipping (store_id, flat_enabled, flat_amount, pickup_enabled, pickup_hours, currency, area_mode, saved_at, revision)
    values (${storeId}, true, 4900, true, 'Mon–Sat, 10–6', 'INR', 'everywhere', now(), 1)`
  await db.sql`insert into payment_provider_account (store_id, provider, status) values (${storeId}, 'cod', 'live')`
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const gql = async (source: string, token: string | null = null, variables: Record<string, unknown> = {}) => {
  const headers: Record<string, string> = token ? { 'x-shop-cart': token } : {}
  const found = await resolveShopper(db.sql, new Request(`https://${host}/shop-api`, { headers }), host, 'shop.example')
  if (found.kind !== 'found') throw new Error('no store')
  const contextValue: ShopContext = { sql: db.sql, shopper: found.shopper, origin: `https://${host}`, activity: activityLog, facts: { requestId: 'r', ip: '203.0.113.9', userAgent: null }, couriers: null, allowNewCart: async () => true, now: () => new Date() }
  const result = await graphql({ schema: shopSchema as GraphQLSchema, source, contextValue, variableValues: variables })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined, problems: result.errors?.[0]?.extensions['problems'] as { questionId: string; reason: string }[] | undefined, errors: result.errors }
}

const lineFields = 'id versionId quantity unitPrice { amount } lineTotal { amount } discount { amount } problem answers { questionId question kind text amount { amount } per choices { choiceId label quantity free } }'
const add = (token: string | null, versionId: string, quantity: number, answers: unknown[] | null) =>
  gql('mutation A($v: ID!, $q: Int!, $a: [ShopAnswerInput!]) { addToCart(versionId: $v, quantity: $q, answers: $a) { cartToken cart { lines { ' + lineFields + ' } problems } } }', token, { v: versionId, q: quantity, a: answers })
type Line = { id: string; versionId: string; quantity: number; unitPrice: { amount: string }; lineTotal: { amount: string }; discount: { amount: string } | null; problem: string | null; answers: { questionId: string; text: string | null; choices: { choiceId: string; free: number }[] }[] }
const linesOf = (result: Awaited<ReturnType<typeof gql>>, field = 'addToCart') => ((result.data?.[field] as { cart: { lines: Line[] } } | undefined)?.cart.lines ?? []) as Line[]
const cartLines = async (token: string) => ((await gql(`{ cart { lines { ${lineFields} } } }`, token)).data?.['cart'] as { lines: Line[] }).lines

const withWrap = (message: string) => [
  { questionId: ids.toppings, choices: [{ choiceId: ids.cheese, quantity: 2 }, { choiceId: ids.olives }] },
  { questionId: ids.wrap, choices: [{ choiceId: ids.wrapYes }] },
  { questionId: ids.message, text: message },
]

describe('a product’s questions in the shop', () => {
  it('lists them on the product page, priced in the cart’s currency; a product without any lists none', async () => {
    const page = await gql(`{ product(slug: "birthday-cake") { questions { id kind label required shownIf { choiceId } choices { label price { mode per amount { amount } versionAmounts { versionId amount { amount } } } } } } }`)
    const questions = (page.data?.['product'] as { questions: { label: string; choices: { price: { amount: { amount: string } | null; versionAmounts: { versionId: string }[] } | null }[] }[] }).questions
    expect(questions.map((q) => q.label)).toEqual(['Toppings', 'Gift wrap', 'Message'])
    expect(questions[0]?.choices[0]?.price?.amount).toEqual({ amount: '3000' })
    expect(questions[0]?.choices[0]?.price?.versionAmounts.map((v) => v.versionId)).toEqual([ids.large])
    expect((await gql(`{ product(slug: "plain-bun") { questions { id } } }`)).data?.['product']).toEqual({ questions: [] })
  })

  it('quotes the modal’s total without writing anything, with what is still missing', async () => {
    const quote = await gql('query Q($v: ID!, $a: [ShopAnswerInput!]!) { customisationQuote(versionId: $v, quantity: 2, answers: $a) { unitPrice { amount } lineTotal { amount } problems { questionId reason } } }', null, {
      v: ids.small,
      a: [{ questionId: ids.toppings, choices: [{ choiceId: ids.cheese }] }, { questionId: ids.wrap, choices: [{ choiceId: ids.wrapYes }] }],
    })
    // 30000 + 3000 per cake, 5000 once for the wrap; the message is now shown and required.
    expect(quote.data?.['customisationQuote']).toEqual({ unitPrice: { amount: '33000' }, lineTotal: { amount: '71000' }, problems: [{ questionId: ids.message, reason: 'REQUIRED' }] })
  })
})

describe('customised lines in the cart', () => {
  let token = ''

  it('refuses answers that don’t fit, naming each question', async () => {
    const missing = await add(null, ids.small, 1, [{ questionId: ids.wrap, choices: [{ choiceId: ids.wrapYes }] }])
    expect(missing.code).toBe('ANSWERS_INVALID')
    expect(missing.problems).toEqual([{ questionId: ids.message, choiceId: null, reason: 'REQUIRED' }])
    const tooMany = await add(null, ids.small, 1, [{ questionId: ids.toppings, choices: [{ choiceId: ids.cheese, quantity: 3 }] }])
    expect(tooMany.problems?.[0]?.reason).toBe('QUANTITY_TOO_HIGH')
  })

  it('prices each line with its extras: per item in the unit, once per line on the line, and a version’s own amount', async () => {
    const added = await add(null, ids.small, 2, withWrap('Happy 30 Asha'))
    expect(added.errors).toBeUndefined()
    token = (added.data?.['addToCart'] as { cartToken: string }).cartToken
    const [line] = linesOf(added)
    // Small: 30000 + 2×3000 cheese + 3000 olives (10%) + 13 characters × 100 = 40300 a cake; the wrap once: 5000.
    expect(line).toMatchObject({ quantity: 2, unitPrice: { amount: '40300' }, lineTotal: { amount: '85600' }, problem: null })
    expect(line?.answers.find((a) => a.questionId === ids.message)?.text).toBe('Happy 30 Asha')
    const large = linesOf(await add(token, ids.large, 1, [{ questionId: ids.toppings, choices: [{ choiceId: ids.cheese }] }]))
    expect(large.find((l) => l.versionId === ids.large)?.unitPrice).toEqual({ amount: '50000' })
  })

  it('keeps equal answers on one line and different answers apart, and adds a product without questions as before', async () => {
    const again = linesOf(await add(token, ids.small, 1, [...withWrap('Happy 30 Asha')].reverse()))
    expect(again.filter((l) => l.versionId === ids.small)).toHaveLength(1)
    expect(again.find((l) => l.versionId === ids.small)?.quantity).toBe(3)
    const other = linesOf(await add(token, ids.small, 1, withWrap('Hi Ravi')))
    expect(other.filter((l) => l.versionId === ids.small)).toHaveLength(2)
    const plain = linesOf(await add(token, ids.plain, 2, null))
    expect(plain.find((l) => l.versionId === ids.plain)).toMatchObject({ quantity: 2, unitPrice: { amount: '5000' }, lineTotal: { amount: '10000' }, answers: [] })
  })

  it('edits a line’s answers, joining the line that already has them', async () => {
    const lines = await cartLines(token)
    const ravi = lines.find((l) => l.answers.some((a) => a.text === 'Hi Ravi'))
    const edited = await gql('mutation E($l: ID!, $a: [ShopAnswerInput!]!) { updateCartLineAnswers(lineId: $l, answers: $a) { cart { lines { ' + lineFields + ' } } } }', token, { l: ravi?.id, a: withWrap('Happy 30 Asha') })
    const small = linesOf(edited, 'updateCartLineAnswers').filter((l) => l.versionId === ids.small)
    expect(small).toHaveLength(1)
    expect(small[0]?.quantity).toBe(4)
    const changed = await gql(`mutation { setCartQuantity(versionId: "${ids.small}", lineId: "${small[0]?.id}", quantity: 1) { cart { lines { ${lineFields} } } } }`, token)
    expect(linesOf(changed, 'setCartQuantity').find((l) => l.versionId === ids.small)?.quantity).toBe(1)
    expect((await gql(`mutation { setCartQuantity(versionId: "${ids.small}", quantity: 1) { cart { problems } } }`, token)).code).toBe('INVALID_INPUT')
  })

  it('flags a line whose answers stopped fitting, and checkout refuses it until edited', async () => {
    await db.sql`update product_question_choice set available = false where id = ${ids.olives}`
    const small = (await cartLines(token)).find((l) => l.versionId === ids.small)
    expect(small?.problem).toBe('check_answers')
    expect((await gql('mutation { checkout { id } }', token)).problems).toContain('LINE_PROBLEM')
    await db.sql`update product_question_choice set available = true where id = ${ids.olives}`
    expect((await cartLines(token)).find((l) => l.versionId === ids.small)?.problem).toBeNull()
  })

  it('lets an offer leave the extras out when its switch is off', async () => {
    const promo = (await one(db.sql<{ id: string }[]>`insert into promotion (store_id, name, trigger, enabled, include_customisation) values (${storeId}, 'Ten off', 'automatic', true, false) returning id`)).id
    await db.sql`insert into promotion_action (promotion_id, store_id, operation, args, position) values (${promo}, ${storeId}, 'products_percentage_discount', ${db.sql.json({ percent: 10, targets: { productIds: [ids.product], collectionIds: [], filterValueIds: [] }, exclude: { giftCards: false, onSale: false }, cap: null })}, 0)`
    const small = (await cartLines(token)).find((l) => l.versionId === ids.small)
    // 10% of the cake alone (30000), not of the line's 45300 with its extras.
    expect(small?.discount).toEqual({ amount: '3000' })
    await db.sql`update promotion set include_customisation = true where id = ${promo}`
    expect((await cartLines(token)).find((l) => l.versionId === ids.small)?.discount).toEqual({ amount: '4530' })
    await db.sql`update promotion set enabled = false where id = ${promo}`
  })

  it('snapshots the answers on the order, unchanged when the questions change later', async () => {
    await gql('mutation { setCartContact(email: "asha@example.com", phone: "+919845022113") { cart { id } } }', token)
    await gql('mutation { setShippingAddress(address: { name: "Asha Rao", line1: "12 MG Road", city: "Pune", region: "Maharashtra", postalCode: "411001", country: "IN" }) { cart { id } } }', token)
    await gql('mutation { setShippingOption(option: "flat") { cart { id } } }', token)
    expect((await gql('mutation { checkout { readyToPay } }', token)).data?.['checkout']).toEqual({ readyToPay: true })
    const placed = await gql('mutation { placeOrder(provider: "cod") { orderId } }', token)
    expect(placed.errors).toBeUndefined()
    const orderId = (placed.data?.['placeOrder'] as { orderId: string }).orderId
    const [line] = await db.sql<{ answers: { label: string; amount: string; choices?: { label: string }[]; text?: string }[]; unit_amount: string; unit_extras_amount: string; line_extras_amount: string }[]>`
      select answers, unit_amount::text, unit_extras_amount::text, line_extras_amount::text from order_line where order_id = ${orderId} and version_id = ${ids.small}`
    expect(line).toMatchObject({ unit_amount: '40300', unit_extras_amount: '10300', line_extras_amount: '5000' })
    await db.sql`update product_question set label = 'Renamed' where id = ${ids.toppings}`
    const [after] = await db.sql<{ answers: { label: string }[] }[]>`select answers from order_line where order_id = ${orderId} and version_id = ${ids.small}`
    expect(after?.answers.map((a) => a.label).sort()).toEqual(['Gift wrap', 'Message', 'Toppings'])
  })

  it('keeps another shopper away from this cart’s lines', async () => {
    const tokenOf = async (message: string) => ((await add(null, ids.small, 1, withWrap(message))).data?.['addToCart'] as { cartToken: string }).cartToken
    const [mine, theirs] = [await tokenOf('Mine'), await tokenOf('Theirs')]
    const theirLine = (await cartLines(theirs))[0]
    expect((await gql('mutation E($l: ID!, $a: [ShopAnswerInput!]!) { updateCartLineAnswers(lineId: $l, answers: $a) { cart { id } } }', mine, { l: theirLine?.id, a: withWrap('Stolen') })).code).toBe('INVALID_INPUT')
    expect((await cartLines(theirs))[0]?.answers.find((a) => a.questionId === ids.message)?.text).toBe('Theirs')
  })
})

import { z } from 'zod'
import { pageInfoSchema, typedQuery, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { loadCollections } from './collections'
import { loadCustomerGroups } from './customers'
import { loadFilters } from './filters'
import type { ExportJob } from './exportJob'

// Offers on the Store API (FIRST-RELEASE (store) §8, OFFERS-DESIGN §3.1; apps/api src/apis/store/offers.ts): the merchant side's alone.
// Owner and Manager write, Staff read, a supplier is refused. Amounts are digit strings of minor units.

const moneySchema = z.object({ amount: z.string().regex(/^-?\d+$/), currency: z.string() })
export type ApiMoney = z.infer<typeof moneySchema>

const targetsSchema = z.object({ productIds: z.array(z.string()), collectionIds: z.array(z.string()), filterValueIds: z.array(z.string()) })
export type OfferTargets = z.infer<typeof targetsSchema>

const leafFields = 'operation amounts { amount currency } minimum productIds collectionIds filterValueIds groupIds customerIds countries days from to'
const leafSchema = z.object({
  operation: z.string(),
  amounts: z.array(moneySchema),
  minimum: z.number().int().nullable(),
  productIds: z.array(z.string()),
  collectionIds: z.array(z.string()),
  filterValueIds: z.array(z.string()),
  groupIds: z.array(z.string()),
  customerIds: z.array(z.string()),
  countries: z.array(z.string()),
  days: z.array(z.number().int()),
  from: z.string().nullable(),
  to: z.string().nullable(),
})
const conditionSchema = leafSchema.extend({ conditions: z.array(leafSchema) })
export type OfferCondition = z.infer<typeof conditionSchema>

const targetFields = 'targets { productIds collectionIds filterValueIds }'
const actionSchema = z.object({
  operation: z.string(),
  percent: z.number().int().nullable(),
  amounts: z.array(moneySchema),
  cap: z.array(moneySchema),
  targets: targetsSchema.nullable(),
  exclude: z.object({ giftCards: z.boolean(), onSale: z.boolean() }).nullable(),
  buy: z.object({ quantity: z.number().int(), targets: targetsSchema.nullable() }).nullable(),
  get: z.object({ quantity: z.number().int(), targets: targetsSchema.nullable() }).nullable(),
  oncePerOrder: z.boolean(),
  kind: z.string().nullable(),
  tiers: z.array(z.object({ minimum: z.array(moneySchema), percent: z.number().int().nullable(), amounts: z.array(moneySchema) })),
})
export type OfferAction = z.infer<typeof actionSchema>

const offerSchema = z.object({
  id: z.string(),
  name: z.string(),
  internalName: z.string().nullable(),
  description: z.string().nullable(),
  trigger: z.enum(['automatic', 'code']),
  code: z.string().nullable(),
  // Derived by the API (OFFERS-DESIGN fact 9); Used up counts as Ended on the tabs.
  status: z.enum(['live', 'scheduled', 'off', 'ended', 'used_up']),
  enabled: z.boolean(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  totalUsesLimit: z.number().int().nullable(),
  perCustomerLimit: z.number().int().nullable(),
  usesCount: z.number().int(),
  combines: z.object({ product: z.boolean(), order: z.boolean(), shipping: z.boolean() }),
  conditions: z.array(conditionSchema),
  action: actionSchema,
  revision: z.number().int(),
})
export type Offer = z.infer<typeof offerSchema>

const offerFields = `id name internalName description trigger code status enabled startsAt endsAt totalUsesLimit perCustomerLimit usesCount revision
  combines { product order shipping }
  conditions { ${leafFields} conditions { ${leafFields} } }
  action { operation percent amounts { amount currency } cap { amount currency } ${targetFields} exclude { giftCards onSale }
    buy { quantity ${targetFields} } get { quantity ${targetFields} } oncePerOrder kind tiers { minimum { amount currency } percent amounts { amount currency } } }`

export const offerTabs = ['live', 'scheduled', 'off', 'ended'] as const
export type OfferTab = (typeof offerTabs)[number]
export const offerKinds = ['products', 'order', 'bxgy', 'shipping'] as const
export type OfferKind = (typeof offerKinds)[number]

export type OfferFilter = { tab: OfferTab; kind: OfferKind | null; trigger: Offer['trigger'] | null; search: string }

export const offerPageSize = 25

/** One page of a tab, newest first by the API's order; `after` pages on. */
export const loadOffers = async (client: ApiClient, { tab, kind, trigger, search }: OfferFilter, after: string | null = null): Promise<{ rows: Offer[]; next: string | null }> => {
  const { offers } = await typedQuery(client)(
    `query Offers($status: String, $kind: String, $trigger: String, $search: String, $first: Int, $after: String) {
      offers(status: $status, kind: $kind, trigger: $trigger, search: $search, first: $first, after: $after) { nodes { ${offerFields} } pageInfo { hasNextPage hasPreviousPage startCursor endCursor } }
    }`,
    z.object({ offers: z.object({ nodes: z.array(offerSchema), pageInfo: pageInfoSchema }) }),
    { status: tab, kind, trigger, search: search.trim() || null, first: offerPageSize, after },
  )
  return { rows: offers.nodes, next: offers.pageInfo.hasNextPage ? offers.pageInfo.endCursor : null }
}

const countsSchema = z.object({ live: z.number().int(), scheduled: z.number().int(), off: z.number().int(), ended: z.number().int() })
export type OfferCounts = z.infer<typeof countsSchema>

export const loadOfferCounts = async (client: ApiClient): Promise<OfferCounts> => (await typedQuery(client)('{ offerCounts { live scheduled off ended } }', z.object({ offerCounts: countsSchema }))).offerCounts

/** The offer, or null for one that isn't here. */
export const loadOffer = async (client: ApiClient, id: string): Promise<Offer | null> =>
  (await typedQuery(client)(`query Offer($id: ID!) { offer(id: $id) { ${offerFields} } }`, z.object({ offer: offerSchema.nullable() }), { id })).offer

const batchSchema = z.object({ id: z.string(), prefix: z.string(), length: z.number().int(), count: z.number().int(), used: z.number().int(), createdAt: z.string() })
export type CodeBatch = z.infer<typeof batchSchema>

export const codeBatchPageSize = 25

/** An offer's runs of single-use codes, newest first. */
export const loadCodeBatches = async (client: ApiClient, offerId: string, after: string | null = null): Promise<{ rows: CodeBatch[]; next: string | null }> => {
  const { offerCodeBatches } = await typedQuery(client)(
    'query Batches($id: ID!, $first: Int, $after: String) { offerCodeBatches(offerId: $id, first: $first, after: $after) { nodes { id prefix length count used createdAt } pageInfo { hasNextPage hasPreviousPage startCursor endCursor } } }',
    z.object({ offerCodeBatches: z.object({ nodes: z.array(batchSchema), pageInfo: pageInfoSchema }) }),
    { id: offerId, first: codeBatchPageSize, after },
  )
  return { rows: offerCodeBatches.nodes, next: offerCodeBatches.pageInfo.hasNextPage ? offerCodeBatches.pageInfo.endCursor : null }
}

/** "Turn off" and "Turn on". */
export const setOfferOn = async (client: ApiClient, id: string, on: boolean): Promise<void> => {
  if (on) await typedQuery(client)('mutation ResumeOffer($id: ID!) { resumeOffer(id: $id) }', z.object({ resumeOffer: z.boolean().nullable() }), { id })
  else await typedQuery(client)('mutation PauseOffer($id: ID!) { pauseOffer(id: $id) }', z.object({ pauseOffer: z.boolean().nullable() }), { id })
}

/** Its end date becomes now. */
export const endOffer = async (client: ApiClient, id: string): Promise<void> => {
  await typedQuery(client)('mutation EndOffer($id: ID!) { endOffer(id: $id) }', z.object({ endOffer: z.boolean().nullable() }), { id })
}

/** A copy, off, with no code and no uses; answers its id. */
export const duplicateOffer = async (client: ApiClient, id: string): Promise<string> =>
  (await typedQuery(client)('mutation DuplicateOffer($id: ID!) { duplicateOffer(id: $id) }', z.object({ duplicateOffer: z.string() }), { id })).duplicateOffer

/** Soft: placed orders keep their discount, and its code stays reserved. */
export const deleteOffer = async (client: ApiClient, id: string): Promise<void> => {
  await typedQuery(client)('mutation DeleteOffer($id: ID!) { deleteOffer(id: $id) }', z.object({ deleteOffer: z.boolean().nullable() }), { id })
}

/** The API's limits on one run of single-use codes (apps/api src/engine/modules/promotions/service.ts). */
export const codeBatchLimits = { count: 5000, prefix: 12 } as const
/** A run's prefix as `generateCodes` takes it, upper-cased: empty, or a letter or digit then letters, digits, - or _. */
export const codePrefixPattern = new RegExp(`^([A-Z0-9][A-Z0-9_-]{0,${codeBatchLimits.prefix - 1}})?$`)
/** The lengths offered after a run's prefix, within the API's 6–16. */
export const codeLengths = [6, 8, 10] as const

export const generateCodes = async (client: ApiClient, offerId: string, run: { count: number; prefix: string; length: number }): Promise<CodeBatch> =>
  (
    await typedQuery(client)(
      'mutation GenerateCodes($id: ID!, $count: Int!, $prefix: String, $length: Int) { generateCodes(offerId: $id, count: $count, prefix: $prefix, length: $length) { id prefix length count used createdAt } }',
      z.object({ generateCodes: batchSchema }),
      { id: offerId, count: run.count, prefix: run.prefix || null, length: run.length },
    )
  ).generateCodes

/** A run's codes as a file: a job, read back with `loadCodesExport`. */
export const requestCodesExport = async (client: ApiClient, batchId: string): Promise<string> =>
  (await typedQuery(client)('mutation ExportOfferCodes($id: ID!) { exportOfferCodes(batchId: $id) }', z.object({ exportOfferCodes: z.string() }), { id: batchId })).exportOfferCodes

const codesExportSchema = z.object({ id: z.string(), state: z.enum(['queued', 'done', 'failed', 'expired']), rows: z.number().int().nullable(), csv: z.string().nullable(), expiresAt: z.string().nullable() })
const codeJobStates = { queued: 'preparing', done: 'ready', failed: 'failed', expired: 'expired' } as const

/** The job, or null for one that isn't here. A done job without its CSV has nothing to share, so it reads as failed. */
export const loadCodesExport = async (client: ApiClient, id: string): Promise<ExportJob | null> => {
  const { offerCodesExport } = await typedQuery(client)('query OfferCodesExport($id: ID!) { offerCodesExport(id: $id) { id state rows csv expiresAt } }', z.object({ offerCodesExport: codesExportSchema.nullable() }), { id })
  if (!offerCodesExport) return null
  const state = codeJobStates[offerCodesExport.state]
  const base = { id: offerCodesExport.id, entries: offerCodesExport.rows, expiresAt: offerCodesExport.expiresAt, truncated: false }
  return state === 'ready' && offerCodesExport.csv === null ? { ...base, state: 'failed', csv: null } : { ...base, state, csv: state === 'ready' ? offerCodesExport.csv : null }
}

const placeSchema = z.object({ timeZone: z.string(), country: z.string().nullable() })

/** The store's time zone (every date is read in it) and country (the region's words); refused for a store without info, never guessed. */
export const loadOfferPlace = async (client: ApiClient): Promise<{ timeZone: string; country: string | null }> => {
  const { storeInfo } = await typedQuery(client)('{ storeInfo { timeZone country } }', z.object({ storeInfo: placeSchema.nullable() }))
  if (!storeInfo) throw new Error('The store has no time zone yet.')
  return storeInfo
}

/** The names an offer's ids stand for: collections, filter values and customer groups, each the store's whole list. */
export const loadOfferNames = async (client: ApiClient) => {
  const [collections, filters, groups] = await Promise.all([loadCollections(client), loadFilters(client), loadCustomerGroups(client)])
  return {
    collections: new Map(collections.map((c) => [c.id, c.name])),
    filterValues: new Map(filters.flatMap((f) => f.values.map((v) => [v.id, `${f.name}: ${v.name}`] as const))),
    groups: new Map(groups.map((g) => [g.id, g.name])),
  }
}

export type OfferSaved = { id: string; revision: number }

/** A new offer without `id`; an edit names the revision it was read at. */
export const saveOffer = async (client: ApiClient, id: string | null, revision: number | null, input: Record<string, unknown>): Promise<OfferSaved> =>
  (
    await typedQuery(client)(
      'mutation SaveOffer($id: ID, $revision: Int, $input: OfferInput!) { saveOffer(id: $id, revision: $revision, input: $input) { id revision } }',
      z.object({ saveOffer: z.object({ id: z.string(), revision: z.number().int() }) }),
      { id, revision, input },
    )
  ).saveOffer

const factsSchema = z.object({
  storeInfo: placeSchema.nullable(),
  storeLocale: z
    .object({ pricingCurrency: z.string().nullable(), currencies: z.array(z.object({ code: z.string(), status: z.string() })), rates: z.array(z.object({ currency: z.string(), perEuro: z.string() })) })
    .nullable(),
})

/** What the editor needs of the store: its time zone and country, the currencies it sells in, and today's reference rates. */
export const loadOfferFacts = async (client: ApiClient) => {
  const { storeInfo, storeLocale } = await typedQuery(client)('{ storeInfo { timeZone country } storeLocale { pricingCurrency currencies { code status } rates { currency perEuro } } }', factsSchema)
  const main = storeLocale?.pricingCurrency
  // A guessed zone would schedule at the wrong moment while naming it as the store's; refuse instead (OFFERS-DESIGN fact 9).
  if (!main || !storeInfo) throw new Error('The store has no pricing currency or time zone yet.')
  return {
    timeZone: storeInfo.timeZone,
    country: storeInfo.country,
    main,
    others: (storeLocale?.currencies ?? []).filter((c) => c.status === 'active' && c.code !== main).map((c) => c.code),
    perEuro: Object.fromEntries((storeLocale?.rates ?? []).map((r) => [r.currency, Number(r.perEuro)] as const).filter(([, rate]) => rate > 0)),
  }
}

/** An offer names at most this many ids of a kind (the engine's own limit); names are asked a chunk at a time. */
export const offerIdLimit = 250
const namesChunk = 50

/** What an offer's ids are called, by the id asked: a name (a customer's email without one) or null; one that's gone is absent. */
export type OfferIdNames = ReadonlyMap<string, string | null>

const nameSchema = z.record(z.string(), z.object({ name: z.string().nullable(), email: z.string().nullable().optional() }).nullable())

const namesOf = async (client: ApiClient, field: 'product' | 'customer', ids: readonly string[]): Promise<Map<string, string | null>> => {
  const out = new Map<string, string | null>()
  const wanted = ids.slice(0, offerIdLimit)
  const selection = field === 'customer' ? '{ name email }' : '{ name }'
  for (let at = 0; at < wanted.length; at += namesChunk) {
    const chunk = wanted.slice(at, at + namesChunk)
    const fields = chunk.map((_, i) => `n${i}: ${field}(id: $i${i}) ${selection}`).join(' ')
    const params = chunk.map((_, i) => `$i${i}: ID!`).join(', ')
    const answer = await typedQuery(client)(`query Names(${params}) { ${fields} }`, nameSchema, Object.fromEntries(chunk.map((id, i) => [`i${i}`, id])))
    chunk.forEach((id, i) => {
      const found = answer[`n${i}`]
      if (found) out.set(id, found.name ?? found.email ?? null)
    })
  }
  return out
}

/** Names for the ids an offer names, the Store API having no read by many ids. */
export const loadProductNames = (client: ApiClient, ids: readonly string[]) => namesOf(client, 'product', ids)
export const loadCustomerNames = (client: ApiClient, ids: readonly string[]) => namesOf(client, 'customer', ids)

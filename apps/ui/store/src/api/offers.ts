import { z } from 'zod'
import { query } from './client'
import { loadCollections } from './collections'
import { loadCustomerGroups } from './customers'
import { loadFilters } from './filters'
import { moneySchema } from './orders'

// Offers (FIRST-RELEASE §8, OFFERS-DESIGN §3.1; apps/api/schema/store.graphql, src/apis/store/offers.ts): the merchant
// side's alone. Owner and Manager write, Staff read (ACCESS §5.1); a supplier is refused by the API.

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
  trigger: z.enum(['automatic', 'code']),
  code: z.string().nullable(),
  // live, scheduled, off, ended or used_up: derived by the API (OFFERS fact 9).
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
export type OfferStatus = Offer['status']

const offerFields = `id name internalName trigger code status enabled startsAt endsAt totalUsesLimit perCustomerLimit usesCount revision
  combines { product order shipping }
  conditions { ${leafFields} conditions { ${leafFields} } }
  action { operation percent amounts { amount currency } cap { amount currency } ${targetFields} exclude { giftCards onSale }
    buy { quantity ${targetFields} } get { quantity ${targetFields} } oncePerOrder kind tiers { minimum { amount currency } percent amounts { amount currency } } }`

const pageInfoSchema = z.object({ hasNextPage: z.boolean(), hasPreviousPage: z.boolean(), startCursor: z.string().nullable(), endCursor: z.string().nullable() })

export const offerTabs = ['live', 'scheduled', 'off', 'ended'] as const
export type OfferTab = (typeof offerTabs)[number]
export const offerKinds = ['products', 'order', 'bxgy', 'shipping'] as const
export type OfferKind = (typeof offerKinds)[number]

export interface OfferFilter {
  tab: OfferTab
  kind: OfferKind | null
  trigger: Offer['trigger'] | null
  search: string
}

export interface OfferPage {
  rows: Offer[]
  next: string | null
  previous: string | null
}

export const offerPageSize = 25

export const loadOffers = async (filter: OfferFilter, cursor: { after?: string | null; before?: string | null } = {}): Promise<OfferPage> => {
  const { offers } = await query(
    `query O($status: String, $kind: String, $trigger: String, $search: String, $first: Int, $after: String, $before: String) {
      offers(status: $status, kind: $kind, trigger: $trigger, search: $search, first: $first, after: $after, before: $before) { nodes { ${offerFields} } pageInfo { hasNextPage hasPreviousPage startCursor endCursor } }
    }`,
    z.object({ offers: z.object({ nodes: z.array(offerSchema), pageInfo: pageInfoSchema }) }),
    { status: filter.tab, kind: filter.kind, trigger: filter.trigger, search: filter.search.trim() || null, first: offerPageSize, after: cursor.after ?? null, before: cursor.before ?? null },
  )
  return { rows: offers.nodes, next: offers.pageInfo.hasNextPage ? offers.pageInfo.endCursor : null, previous: offers.pageInfo.hasPreviousPage ? offers.pageInfo.startCursor : null }
}

const countsSchema = z.object({ live: z.number().int(), scheduled: z.number().int(), off: z.number().int(), ended: z.number().int() })
export type OfferCounts = z.infer<typeof countsSchema>

/** The tabs' counts: Used up counts as Ended (B1). */
export const loadOfferCounts = async (): Promise<OfferCounts> => (await query('{ offerCounts { live scheduled off ended } }', z.object({ offerCounts: countsSchema }))).offerCounts

const checkSchema = z.object({
  code: z.string(),
  offer: offerSchema.nullable(),
  deleted: z.boolean(),
  singleUse: z.boolean(),
  usedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  // What a shopper typing it meets (O3).
  answer: z.enum(['WORKS', 'INVALID', 'EXPIRED', 'USED_UP']),
})
export type CodeCheck = z.infer<typeof checkSchema>

/** "Check a code a customer gives you": null for a code the store doesn't hold. Rate-limited by the API. */
export const checkCode = async (code: string): Promise<CodeCheck | null> =>
  (await query(`query C($code: String!) { checkCode(code: $code) { code deleted singleUse usedAt expiresAt answer offer { ${offerFields} } } }`, z.object({ checkCode: checkSchema.nullable() }), { code })).checkCode

/** "Turn off" (N2) and "Turn back on". */
export const setOfferOn = async (id: string, on: boolean): Promise<void> => {
  if (on) await query('mutation R($id: ID!) { resumeOffer(id: $id) }', z.object({ resumeOffer: z.boolean() }), { id })
  else await query('mutation P($id: ID!) { pauseOffer(id: $id) }', z.object({ pauseOffer: z.boolean() }), { id })
}

/** "End now" (N3): its end date becomes now. */
export const endOffer = async (id: string): Promise<void> => {
  await query('mutation E($id: ID!) { endOffer(id: $id) }', z.object({ endOffer: z.boolean() }), { id })
}

/** "Duplicate" (N4): a copy, Off, with no code and no uses; answers its id. */
export const duplicateOffer = async (id: string): Promise<string> => (await query('mutation D($id: ID!) { duplicateOffer(id: $id) }', z.object({ duplicateOffer: z.string() }), { id })).duplicateOffer

/** Soft: placed orders keep their discount, and its code stays reserved (fact 14). */
export const deleteOffer = async (id: string): Promise<void> => {
  await query('mutation D($id: ID!) { deleteOffer(id: $id) }', z.object({ deleteOffer: z.boolean() }), { id })
}


/** Where the store is: its time zone (dates, fact 9) and country (the region's words, T5). */
/** Refused when the store has no info yet, so no screen guesses a zone it would then name as the store's. */
export const loadOfferPlace = async (): Promise<{ timeZone: string; country: string | null }> => {
  const { storeInfo } = await query('{ storeInfo { timeZone country } }', z.object({ storeInfo: z.object({ timeZone: z.string(), country: z.string().nullable() }).nullable() }))
  if (!storeInfo) throw new Error('The store has no time zone yet.')
  return storeInfo
}

/** The names an offer's ids stand for: collections, filter values and customer groups, each the store's whole list. */
export const loadOfferNames = async () => {
  const [collections, filters, groups] = await Promise.all([loadCollections(), loadFilters(), loadCustomerGroups()])
  return {
    collections: new Map(collections.map((c) => [c.id, c.name])),
    filterValues: new Map(filters.flatMap((f) => f.values.map((v) => [v.id, `${f.name}: ${v.name}`] as const))),
    groups: new Map(groups.map((g) => [g.id, g.name])),
  }
}

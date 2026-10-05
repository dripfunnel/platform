import { z } from 'zod'
import { allPages } from './allPages'
import { query } from './client'

// Markets (SetMarkets, FIRST-RELEASE §15; #296's API): groups of countries, each with its currency, language and rules.

const pageInfoSchema = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() })

const marketSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  primary: z.boolean(),
  everywhereElse: z.boolean(),
  active: z.boolean(),
  countries: z.array(z.string()),
  currency: z.string(),
  language: z.string(),
  priceAdjustmentBps: z.number().int(),
  webMode: z.enum(['main', 'path']),
  pathPrefix: z.string().nullable(),
  products: z.enum(['all', 'some']),
  excludedProductIds: z.array(z.string()),
  /** The excluded products still in the catalogue, by name; an id without one here was deleted since. */
  excludedProducts: z.array(z.object({ id: z.string(), name: z.string() })),
  duties: z.object({ mode: z.enum(['none', 'by_code', 'flat']), rateBps: z.number().int().nullable(), thresholdAmount: z.string().nullable() }),
  revision: z.number().int(),
})
export type Market = z.infer<typeof marketSchema>

const fields = 'id name parentId primary everywhereElse active countries currency language priceAdjustmentBps webMode pathPrefix products excludedProductIds excludedProducts { id name } duties { mode rateBps thresholdAmount } revision'

/** Every market the store has, with all a market's settings: the one read of `markets`. */
export const loadAllMarkets = (): Promise<Market[]> =>
  allPages(async (after) => (await query(`query M($after: String) { markets(first: 50, after: $after) { nodes { ${fields} } pageInfo { hasNextPage endCursor } } }`, z.object({ markets: z.object({ nodes: z.array(marketSchema), pageInfo: pageInfoSchema }) }), { after })).markets)

export interface MarketInput {
  name: string
  parentId: string | null
  active: boolean
  countries: string[]
  currency: string
  language: string
  priceAdjustmentBps: number
  webMode: 'main' | 'path'
  pathPrefix: string | null
  products: 'all' | 'some'
  excludedProductIds: string[]
  dutiesMode: 'none' | 'by_code' | 'flat'
  dutiesRateBps: number | null
  dutiesThresholdAmount: string | null
}

/** A new market (no id), or the next revision of one; answers it as stored. */
export const saveMarket = async (id: string | null, revision: number | null, input: MarketInput): Promise<Market> =>
  (await query(`mutation S($id: ID, $r: Int, $input: MarketInput!) { saveMarket(id: $id, revision: $r, input: $input) { ${fields} } }`, z.object({ saveMarket: marketSchema }), { id, r: revision, input })).saveMarket

/** Never the primary market; its sub-markets become top-level. */
export const deleteMarket = async (id: string): Promise<void> => {
  await query('mutation D($id: ID!) { deleteMarket(id: $id) }', z.object({ deleteMarket: z.boolean() }), { id })
}

/** The market shoppers from anywhere else get, or none (they can't buy). */
export const setEverywhereElse = async (marketId: string | null): Promise<void> => {
  await query('mutation E($id: ID) { setEverywhereElse(marketId: $id) }', z.object({ setEverywhereElse: z.boolean() }), { id: marketId })
}

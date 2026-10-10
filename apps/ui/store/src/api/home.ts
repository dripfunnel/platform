import { z } from 'zod'
import { query } from './client'
import { moneySchema } from './orders'

// Home (FIRST-RELEASE §5, PortalHome; apps/api/schema/store.graphql, src/apis/store/home.ts): what a seat may not see
// comes back null from the server, so the screen leaves it out rather than hiding it.

const homeSchema = z.object({
  timeZone: z.string(),
  hasOrders: z.boolean(),
  toShip: z.number().int(),
  partlyShipped: z.number().int(),
  oldestToShipAt: z.string().nullable(),
  paymentsToCollect: z.object({ count: z.number().int(), firstOrderId: z.string().nullable() }).nullable(),
  awaitingApproval: z.number().int().nullable(),
  lowStock: z.object({ count: z.number().int(), names: z.array(z.string()) }).nullable(),
  rejectedCouriers: z.array(z.string()).nullable(),
  ordersToday: z.number().int(),
  ordersYesterday: z.number().int(),
  sales: z.array(z.object({ yesterday: moneySchema, dayBefore: moneySchema, averageWeek: moneySchema.nullable() })).nullable(),
  returningCustomers: z.number().int().nullable(),
  latestOrders: z.array(
    z.object({
      id: z.string(),
      number: z.string(),
      placedAt: z.string(),
      state: z.string(),
      paymentState: z.string().nullable(),
      fulfilmentState: z.string().nullable(),
      customerName: z.string().nullable(),
      items: z.number().int(),
      total: moneySchema.nullable(),
      test: z.boolean().nullable(),
    }),
  ),
  setup: z.object({ products: z.boolean().nullable(), collections: z.boolean().nullable(), payments: z.boolean().nullable(), shipping: z.boolean().nullable() }).nullable(),
})
export type StoreHome = z.infer<typeof homeSchema>
export type HomeOrder = StoreHome['latestOrders'][number]

export const loadHome = async (): Promise<StoreHome | null> =>
  (
    await query(
      `{ home { timeZone hasOrders toShip partlyShipped oldestToShipAt paymentsToCollect { count firstOrderId } awaitingApproval lowStock { count names }
        rejectedCouriers ordersToday ordersYesterday sales { yesterday { amount currency } dayBefore { amount currency } averageWeek { amount currency } }
        returningCustomers latestOrders { id number placedAt state paymentState fulfilmentState customerName items total { amount currency } test }
        setup { products collections payments shipping } } }`,
      z.object({ home: homeSchema.nullable() }),
    )
  ).home

const localeSchema = z.object({
  storeInfo: z.object({ country: z.string().nullable() }).nullable(),
  storeLocale: z.object({ pricingCurrency: z.string().nullable(), mainLanguage: z.string().nullable() }).nullable(),
})

/** The locale check's facts (§5): the country set at sign-up, the pricing currency and the main language. */
export interface StoreLocaleFacts {
  country: string | null
  currency: string | null
  language: string | null
}

export const loadLocaleFacts = async (): Promise<StoreLocaleFacts> => {
  const { storeInfo, storeLocale } = await query('{ storeInfo { country } storeLocale { pricingCurrency mainLanguage } }', localeSchema)
  return { country: storeInfo?.country ?? null, currency: storeLocale?.pricingCurrency ?? null, language: storeLocale?.mainLanguage ?? null }
}

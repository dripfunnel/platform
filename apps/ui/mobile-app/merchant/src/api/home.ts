import { z } from 'zod'
import { typedQuery, type ApiClient } from '../graphql'
import { moneySchema } from './orders'

// Home on the Store API (FIRST-RELEASE (store) §5; apps/api src/apis/store/home.ts): what a seat may not see comes back null, so the
// screen leaves it out. Every count and sum is the API's; money is a figure a currency, never converted.

const homeSchema = z.object({
  timeZone: z.string(),
  hasOrders: z.boolean(),
  toShip: z.number().int(),
  partlyShipped: z.number().int(),
  oldestToShipAt: z.string().nullable(),
  awaitingApproval: z.number().int().nullable(),
  lowStock: z.object({ count: z.number().int(), names: z.array(z.string()) }).nullable(),
  ordersToday: z.number().int(),
  ordersYesterday: z.number().int(),
  sales: z.array(z.object({ yesterday: moneySchema })).nullable(),
  latestOrders: z.array(
    z.object({
      id: z.string(),
      number: z.string(),
      state: z.string(),
      paymentState: z.string().nullable(),
      fulfilmentState: z.string().nullable(),
      customerName: z.string().nullable(),
      items: z.number().int(),
      total: moneySchema.nullable(),
    }),
  ),
  setup: z
    .object({
      products: z.boolean().nullable(),
      collections: z.boolean().nullable(),
      payments: z.boolean().nullable(),
      shipping: z.boolean().nullable(),
    })
    .nullable(),
})
export type StoreHome = z.infer<typeof homeSchema>
export type HomeOrder = StoreHome['latestOrders'][number]

/** The three newest orders are all the app draws. */
export const homeLatestOrders = 3

export const loadHome = async (client: ApiClient): Promise<StoreHome | null> =>
  (
    await typedQuery(client)(
      `{ home { timeZone hasOrders toShip partlyShipped oldestToShipAt awaitingApproval lowStock { count names } ordersToday ordersYesterday
        sales { yesterday { amount currency } }
        latestOrders { id number state paymentState fulfilmentState customerName items total { amount currency } }
        setup { products collections payments shipping } } }`,
      z.object({ home: homeSchema.nullable() }),
    )
  ).home

const localeSchema = z.object({
  storeInfo: z.object({ country: z.string().nullable() }).nullable(),
  storeLocale: z.object({ pricingCurrency: z.string().nullable(), mainLanguage: z.string().nullable() }).nullable(),
})

/** What sign-up set, for the checklist's first line: the API keeps no "confirmed" fact for it. */
export type LocaleFacts = { country: string; currency: string; language: string }

export const loadLocaleFacts = async (client: ApiClient): Promise<LocaleFacts | null> => {
  const { storeInfo, storeLocale } = await typedQuery(client)('{ storeInfo { country } storeLocale { pricingCurrency mainLanguage } }', localeSchema)
  const country = storeInfo?.country
  const currency = storeLocale?.pricingCurrency
  const language = storeLocale?.mainLanguage
  return country && currency && language ? { country, currency, language } : null
}

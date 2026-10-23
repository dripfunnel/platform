import { z } from 'zod'
import { typedQuery, type ApiClient } from '@dripfunnel/mobile-shared/graphql'

// Settings › Shipping (SetOps; FIRST-RELEASE (store) §15; apps/api src/apis/store/shipping.ts). Amounts are minor-unit digit strings of `currency`.

export const courierStatuses = ['pricing', 'standby', 'failed', 'off'] as const
const courierSchema = z.object({
  provider: z.string(),
  status: z.enum(courierStatuses),
  offered: z.boolean(),
  pickupMode: z.enum(['scheduled', 'on_request']),
  labelSize: z.string(),
  trackingEmails: z.boolean(),
  lastTestedAt: z.string().nullable(),
  lastTestResult: z.string().nullable(),
})
export type Courier = z.infer<typeof courierSchema>

const settingsSchema = z.object({
  revision: z.number().int(),
  savedAt: z.string().nullable(),
  currency: z.string(),
  courierRate: z.boolean(),
  flatRate: z.boolean(),
  flatAmount: z.string().nullable(),
  pickup: z.boolean(),
  pickupHours: z.string().nullable(),
  pickupAddress: z.string().nullable(),
  freeMode: z.enum(['never', 'always', 'over']),
  freeThresholdAmount: z.string().nullable(),
  areaMode: z.enum(['everywhere', 'list']),
  areaFileName: z.string().nullable(),
  areaCount: z.number().int(),
  areaSample: z.array(z.string()),
  labelSizes: z.array(z.string()),
  couriers: z.array(courierSchema),
})
export type ShippingSettings = z.infer<typeof settingsSchema>

const fields =
  'revision savedAt currency courierRate flatRate flatAmount pickup pickupHours pickupAddress freeMode freeThresholdAmount areaMode areaFileName areaCount areaSample labelSizes couriers { provider status offered pickupMode labelSize trackingEmails lastTestedAt lastTestResult }'

export const loadShipping = async (client: ApiClient): Promise<ShippingSettings | null> =>
  (await typedQuery(client)(`{ shippingSettings { ${fields} } }`, z.object({ shippingSettings: settingsSchema.nullable() }))).shippingSettings

export type ShippingInput = {
  courierRate: boolean
  flatRate: boolean
  flatAmount: string | null
  pickup: boolean
  pickupHours: string | null
  freeMode: ShippingSettings['freeMode']
  freeThresholdAmount: string | null
  areaMode: ShippingSettings['areaMode']
}

/** Saved over `revision` (`STALE` when someone saved since); answers the new revision. */
export const saveShipping = async (client: ApiClient, revision: number, input: ShippingInput): Promise<number> =>
  (await typedQuery(client)('mutation SaveShipping($r: Int!, $i: ShippingInput!) { saveShipping(revision: $r, input: $i) }', z.object({ saveShipping: z.number().int() }), { r: revision, i: input })).saveShipping

/** The codes typed in, replacing the list; answers how many were kept. */
export const replaceDeliveryArea = async (client: ApiClient, fileName: string, codes: readonly string[]): Promise<number> =>
  (await typedQuery(client)('mutation ReplaceDeliveryArea($f: String!, $c: [String!]!) { replaceDeliveryArea(fileName: $f, codes: $c) }', z.object({ replaceDeliveryArea: z.number().int() }), { f: fileName, c: codes })).replaceDeliveryArea

/** Answers its status: pricing when no other courier prices orders, otherwise standby. Connecting asks for no key: the couriers are the partner's accounts. */
export const connectCourier = async (client: ApiClient, provider: string): Promise<Courier['status']> =>
  (await typedQuery(client)('mutation ConnectCourier($p: String!) { connectCourier(provider: $p) }', z.object({ connectCourier: z.enum(courierStatuses) }), { p: provider })).connectCourier

export const makePricingCourier = async (client: ApiClient, provider: string): Promise<void> => {
  await typedQuery(client)('mutation MakePricingCourier($p: String!) { useCourierForPricing(provider: $p) }', z.object({ useCourierForPricing: z.boolean().nullable() }), { p: provider })
}

/** Answers the courier that prices orders now, if one took over. */
export const disconnectCourier = async (client: ApiClient, provider: string): Promise<string | null> =>
  (await typedQuery(client)('mutation DisconnectCourier($p: String!) { disconnectCourier(provider: $p) }', z.object({ disconnectCourier: z.string().nullable() }), { p: provider })).disconnectCourier

export const saveCourierOptions = async (client: ApiClient, provider: string, input: { pickupMode: Courier['pickupMode']; labelSize: string; trackingEmails: boolean }): Promise<void> => {
  await typedQuery(client)('mutation SaveCourierOptions($p: String!, $i: CourierOptionsInput!) { saveCourierOptions(provider: $p, input: $i) }', z.object({ saveCourierOptions: z.boolean().nullable() }), { p: provider, i: input })
}

const testSchema = z.object({ provider: z.string(), result: z.enum(['ok', 'rejected', 'unavailable', 'unserved']), ms: z.number().int() })
export type CourierTest = z.infer<typeof testSchema>

export const testCouriers = async (client: ApiClient): Promise<CourierTest[]> =>
  (await typedQuery(client)('mutation TestCouriers { testCouriers { provider result ms } }', z.object({ testCouriers: z.array(testSchema).nullable() }))).testCouriers ?? []

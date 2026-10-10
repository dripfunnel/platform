import { ApiError } from '@dripfunnel/shared/graphql'
import { z } from 'zod'
import { query } from './client'
import { moneySchema } from './orders'

// Billing (FIRST-RELEASE §16, PortalBilling; apps/api/schema/store.graphql, src/apis/store/billing.ts): the Owner's
// plan and its usage. Every amount, limit and refusal is the API's.

export const billingIntervals = ['MONTH', 'YEAR'] as const
export type BillingInterval = (typeof billingIntervals)[number]
export type PlanChangeWhen = 'NOW' | 'PERIOD_END'

const named = z.object({ id: z.string(), name: z.string() })

const subscriptionSchema = z.object({
  plan: named,
  status: z.enum(['trial', 'active', 'past_due', 'cancelled']),
  interval: z.enum(billingIntervals),
  price: moneySchema,
  periodStart: z.string(),
  periodEnd: z.string(),
  trialEndsAt: z.string().nullable(),
  cancelAt: z.string().nullable(),
  scheduled: z.object({ plan: named, interval: z.enum(billingIntervals), at: z.string() }).nullable(),
  card: z.object({ brand: z.string(), last4: z.string(), expires: z.string().nullable() }).nullable(),
  collectedBy: z.enum(['dripfunnel', 'partner']),
  partnerName: z.string(),
  asOf: z.string().nullable(),
})
export type Subscription = z.infer<typeof subscriptionSchema>

const planValueSchema = z.object({ key: z.string(), kind: z.string(), enabled: z.boolean().nullable(), amount: z.number().int().nullable(), unlimited: z.boolean() })
export type PlanValue = z.infer<typeof planValueSchema>

const planSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  current: z.boolean(),
  monthly: moneySchema.nullable(),
  yearly: moneySchema.nullable(),
  values: z.array(planValueSchema),
})
export type CataloguePlan = z.infer<typeof planSchema>

const usageSchema = z.object({ key: z.string(), used: z.number().int(), limit: z.number().int().nullable(), unlimited: z.boolean(), monthly: z.boolean() })
export type Usage = z.infer<typeof usageSchema>

export interface BillingRead {
  subscription: Subscription | null
  plans: CataloguePlan[]
  usage: Usage[]
}

const subscriptionFields =
  'plan { id name } status interval price { amount currency } periodStart periodEnd trialEndsAt cancelAt scheduled { plan { id name } interval at } card { brand last4 expires } collectedBy partnerName asOf'

export const loadBilling = async (): Promise<BillingRead> => {
  const r = await query(
    `{
      subscription { ${subscriptionFields} }
      planCatalogue { id name description current monthly { amount currency } yearly { amount currency } values { key kind enabled amount unlimited } }
      usage { key used limit unlimited monthly }
    }`,
    z.object({
      subscription: subscriptionSchema.nullable(),
      planCatalogue: z.array(planSchema).nullable(),
      usage: z.array(usageSchema).nullable(),
    }),
  )
  return {
    subscription: r.subscription,
    plans: r.planCatalogue ?? [],
    usage: r.usage ?? [],
  }
}

const quoteSchema = z.object({ offered: z.array(z.enum(['NOW', 'PERIOD_END'])), charge: moneySchema, credit: moneySchema, today: moneySchema, from: z.string(), nextPrice: moneySchema })
export type PlanChangeQuote = z.infer<typeof quoteSchema>

export const quotePlanChange = async (planId: string, interval: BillingInterval, when: PlanChangeWhen): Promise<PlanChangeQuote> =>
  (
    await query(
      'query Q($p: ID!, $i: BillingInterval!, $w: PlanChangeWhen!) { planChangeQuote(planId: $p, interval: $i, when: $w) { offered charge { amount currency } credit { amount currency } today { amount currency } from nextPrice { amount currency } } }',
      z.object({ planChangeQuote: quoteSchema }),
      { p: planId, i: interval, w: when },
    )
  ).planChangeQuote

export const changePlan = async (planId: string, interval: BillingInterval, when: PlanChangeWhen): Promise<Subscription> => {
  const { changePlan: sub } = await query(
    `mutation C($p: ID!, $i: BillingInterval!, $w: PlanChangeWhen!) { changePlan(planId: $p, interval: $i, when: $w) { ${subscriptionFields} } }`,
    z.object({ changePlan: subscriptionSchema.nullable() }),
    { p: planId, i: interval, w: when },
  )
  if (!sub) throw new ApiError('BAD_RESPONSE', 'The plan change answered nothing.')
  return sub
}

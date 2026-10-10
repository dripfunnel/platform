import { ApiError, exportJobSchema } from '@dripfunnel/shared/graphql'
import { z } from 'zod'
import { allPages } from './allPages'
import { query } from './client'
import { moneySchema } from './orders'

// Billing (FIRST-RELEASE §16, PortalBilling; apps/api/schema/store.graphql, src/apis/store/billing.ts): the Owner's
// plan, usage, invoices and the details on them, Choose what to keep (PortalKeep) and closing the store. Every amount,
// limit and refusal is the API's.

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

const addressSchema = z.object({ line1: z.string(), line2: z.string().nullable(), city: z.string(), region: z.string().nullable(), postal: z.string(), country: z.string() })
const detailsSchema = z.object({ legalName: z.string(), email: z.string(), address: addressSchema, taxId: z.string().nullable(), taxIdKind: z.enum(['gstin', 'vat']).nullable() })
export type BillingDetails = z.infer<typeof detailsSchema>
export type BillingDetailsInput = Omit<BillingDetails, 'taxIdKind'>

const invoiceSchema = z.object({
  id: z.string(),
  number: z.string().nullable(),
  kind: z.string(),
  status: z.enum(['paid', 'open', 'void', 'refunded']),
  amount: moneySchema,
  tax: moneySchema,
  issuedAt: z.string(),
  paidAt: z.string().nullable(),
  lines: z.array(z.object({ label: z.string(), kind: z.string() })),
})
export type Invoice = z.infer<typeof invoiceSchema>

const pageInfoSchema = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() })
const invoicePageSchema = z.object({ nodes: z.array(invoiceSchema), pageInfo: pageInfoSchema })

/** Where the store's own details stand, to start "On your invoices" from before any are saved (the prototype's). */
const storeInfoSchema = z.object({
  legalName: z.string().nullable(),
  name: z.string(),
  contactEmail: z.string().nullable(),
  country: z.string().nullable(),
  taxId: z.string().nullable(),
  address: z.object({ street: z.string().nullable(), city: z.string().nullable(), postal: z.string().nullable(), region: z.string().nullable() }).nullable(),
})
export type BillingStoreInfo = z.infer<typeof storeInfoSchema>

export interface InvoicePage {
  rows: Invoice[]
  next: string | null
}

export interface BillingRead {
  subscription: Subscription | null
  plans: CataloguePlan[]
  usage: Usage[]
  details: BillingDetails | null
  store: BillingStoreInfo | null
  invoices: InvoicePage
}

export const invoicePageSize = 10

const invoiceFields = 'nodes { id number kind status amount { amount currency } tax { amount currency } issuedAt paidAt lines { label kind } } pageInfo { hasNextPage endCursor }'
const subscriptionFields =
  'plan { id name } status interval price { amount currency } periodStart periodEnd trialEndsAt cancelAt scheduled { plan { id name } interval at } card { brand last4 expires } collectedBy partnerName asOf'

export const loadBilling = async (): Promise<BillingRead> => {
  const r = await query(
    `query B($first: Int) {
      subscription { ${subscriptionFields} }
      planCatalogue { id name description current monthly { amount currency } yearly { amount currency } values { key kind enabled amount unlimited } }
      usage { key used limit unlimited monthly }
      billingDetails { legalName email address { line1 line2 city region postal country } taxId taxIdKind }
      storeInfo { legalName name contactEmail country taxId address { street city postal region } }
      invoices(first: $first) { ${invoiceFields} }
    }`,
    z.object({
      subscription: subscriptionSchema.nullable(),
      planCatalogue: z.array(planSchema).nullable(),
      usage: z.array(usageSchema).nullable(),
      billingDetails: detailsSchema.nullable(),
      storeInfo: storeInfoSchema.nullable(),
      invoices: invoicePageSchema,
    }),
    { first: invoicePageSize },
  )
  return {
    subscription: r.subscription,
    plans: r.planCatalogue ?? [],
    usage: r.usage ?? [],
    details: r.billingDetails,
    store: r.storeInfo,
    invoices: { rows: r.invoices.nodes, next: r.invoices.pageInfo.hasNextPage ? r.invoices.pageInfo.endCursor : null },
  }
}

const readInvoices = async (after: string | null, first: number) =>
  (await query(`query I($first: Int, $after: String) { invoices(first: $first, after: $after) { ${invoiceFields} } }`, z.object({ invoices: invoicePageSchema }), { first, after })).invoices

export const loadMoreInvoices = async (after: string): Promise<InvoicePage> => {
  const page = await readInvoices(after, invoicePageSize)
  return { rows: page.nodes, next: page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null }
}

/** Every invoice, for "Export all". */
export const loadAllInvoices = (): Promise<Invoice[]> => allPages((after) => readInvoices(after, 50))

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

export const saveBillingDetails = async (input: BillingDetailsInput): Promise<BillingDetails> => {
  const { saveBillingDetails: saved } = await query(
    'mutation D($input: BillingDetailsInput!) { saveBillingDetails(input: $input) { legalName email address { line1 line2 city region postal country } taxId taxIdKind } }',
    z.object({ saveBillingDetails: detailsSchema.nullable() }),
    { input },
  )
  if (!saved) throw new ApiError('BAD_RESPONSE', 'The details answered nothing.')
  return saved
}

// Stripe's own link to the invoice, read fresh because it expires; only Stripe's https hosts are opened.
export const invoicePdf = async (id: string): Promise<string> => {
  const { downloadInvoice: url } = await query('query P($id: ID!) { downloadInvoice(id: $id) }', z.object({ downloadInvoice: z.string().nullable() }), { id })
  if (!url || !/^https:\/\/([a-z0-9-]+\.)*stripe\.com\//.test(url)) throw new ApiError('NO_PDF', 'The invoice link is not one of Stripe’s.')
  return url
}

const keepSchema = z.object({ plan: named, limit: z.number().int(), from: z.string().nullable(), products: z.number().int(), paused: z.number().int(), kept: z.array(z.string()), waiting: z.array(z.string()) })
export type PlanKeep = z.infer<typeof keepSchema>
const keepFields = 'plan { id name } limit from products paused kept waiting'

/** What a smaller plan keeps (SAAS §6.2); null when the plan has no product limit, so nothing pauses. */
export const loadPlanKeep = async (): Promise<PlanKeep | null> => (await query(`{ planKeep { ${keepFields} } }`, z.object({ planKeep: keepSchema.nullable() }))).planKeep

export const keepProducts = async (ids: readonly string[]): Promise<PlanKeep> => {
  const { keepProducts: keep } = await query(`mutation K($ids: [ID!]!) { keepProducts(ids: $ids) { ${keepFields} } }`, z.object({ keepProducts: keepSchema.nullable() }), { ids })
  if (!keep) throw new ApiError('BAD_RESPONSE', 'The picks answered nothing.')
  return keep
}

export const cancelStore = async (): Promise<Subscription> => {
  const { cancelStore: sub } = await query(`mutation { cancelStore { ${subscriptionFields} } }`, z.object({ cancelStore: subscriptionSchema.nullable() }))
  if (!sub) throw new ApiError('BAD_RESPONSE', 'Closing answered nothing.')
  return sub
}

export const storeDataKinds = ['products', 'orders', 'customers'] as const
const dataPartSchema = exportJobSchema.extend({ kind: z.enum(storeDataKinds) })
export type StoreDataPart = z.infer<typeof dataPartSchema>

/** "Download my data first": one job of three parts, products, orders and customers (`store.export`). */
export const exportStoreData = async (): Promise<string> => {
  const { exportStoreData: id } = await query('mutation { exportStoreData }', z.object({ exportStoreData: z.string().nullable() }))
  if (!id) throw new ApiError('BAD_RESPONSE', 'The export answered nothing.')
  return id
}

export const loadStoreDataExport = async (id: string): Promise<StoreDataPart[]> =>
  (await query('query X($id: ID!) { storeDataExport(id: $id) { id kind state rows truncated csv expiresAt } }', z.object({ storeDataExport: z.array(dataPartSchema).nullable() }), { id })).storeDataExport ?? []

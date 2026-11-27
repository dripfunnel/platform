import { ApiError, type PageRequest } from '@dripfunnel/shared/graphql'
import { z } from 'zod'
import { query } from './client'
import { pageInfoFields, pageInfoSchema, type Page } from './page'

// Billing on the Platform API (FIRST-RELEASE.md §11, §14.3, §16; #201): DripFunnel's invoices, and the
// payout account and card. Every figure, date and status is the API's; the console words them.

const money = z.object({ amount: z.number().int(), currency: z.string() })

const invoiceSchema = z.object({ id: z.string(), number: z.string().nullable(), at: z.string(), what: z.string(), amount: money, status: z.enum(['paid', 'open', 'overdue']) })
export type Invoice = z.infer<typeof invoiceSchema>

const payoutAccountSchema = z.object({ bank: z.string().nullable(), last4: z.string().nullable(), status: z.enum(['missing', 'verifying', 'verified', 'failed']), failure: z.string().nullable() })
export type PayoutAccount = z.infer<typeof payoutAccountSchema>

const paymentMethodSchema = z.object({ brand: z.string().nullable(), last4: z.string().nullable(), expires: z.string().nullable(), status: z.enum(['missing', 'on_file', 'declined']) })
export type PaymentMethod = z.infer<typeof paymentMethodSchema>

export interface BillingMoney {
  invoices: Page<Invoice>
  // When the payment provider last answered, and since when it has been slow (the stale strip).
  staleSince: string | null
}

const invoiceFields = `items { id number at what amount { amount currency } status } ${pageInfoFields}`

const page = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), pageInfo: pageInfoSchema })

export const loadBilling = async (): Promise<BillingMoney> => {
  const answer = await query(
    `{ partnerInvoices { ${invoiceFields} } billingSettings { staleSince } }`,
    z.object({ partnerInvoices: page(invoiceSchema), billingSettings: z.object({ staleSince: z.string().nullable() }) }),
  )
  return { invoices: answer.partnerInvoices, staleSince: answer.billingSettings.staleSince }
}

export const loadMoreInvoices = async ({ after }: PageRequest): Promise<Page<Invoice>> =>
  (await query(`query More($after: String) { partnerInvoices(after: $after) { ${invoiceFields} } }`, z.object({ partnerInvoices: page(invoiceSchema) }), { after })).partnerInvoices

/** Settings › Payout and payment (§14.3): what is on file, last 4 digits only. */
export const loadPayoutSettings = async (): Promise<{ payoutAccount: PayoutAccount; paymentMethod: PaymentMethod }> =>
  query(`{ payoutAccount { bank last4 status failure } paymentMethod { brand last4 expires status } }`, z.object({ payoutAccount: payoutAccountSchema, paymentMethod: paymentMethodSchema }))

/** The Stripe publishable key the console's Stripe.js acts with; null while the provider isn't switched on (#278). */
export const loadBillingClientConfig = async (): Promise<string | null> =>
  (await query(`{ billingClientConfig { publishableKey } }`, z.object({ billingClientConfig: z.object({ publishableKey: z.string().nullable() }) }))).billingClientConfig.publishableKey

export const billingRefusals = ['INVALID_INPUT', 'NOT_FOUND', 'NOT_CONNECTED', 'PROVIDER_UNAVAILABLE', 'TOKEN_REFUSED', 'NO_COUNTRY', 'NO_PDF'] as const
export type BillingRefusal = (typeof billingRefusals)[number]

const resultSchema = z.object({ ok: z.boolean(), reason: z.string().nullable() })

// A code this console doesn't know is an error with that code, never worded as a known one.
const refusalOf = (reason: string | null): BillingRefusal => {
  const known = billingRefusals.find((code) => code === reason)
  if (!known) throw new ApiError(reason ?? 'UNKNOWN', 'The API refused with a code this console does not know.')
  return known
}

// Stripe's own link to the tax invoice, read fresh because it expires; only Stripe's hosts.
export const invoicePdf = async (id: string): Promise<{ ok: true; url: string } | { ok: false; reason: BillingRefusal }> => {
  const { downloadInvoice: r } = await query(
    `query Pdf($id: ID!) { downloadInvoice(id: $id) { ok reason url } }`,
    z.object({ downloadInvoice: resultSchema.extend({ url: z.string().nullable() }) }),
    { id },
  )
  if (!r.ok) return { ok: false, reason: refusalOf(r.reason) }
  if (!r.url || !/^https:\/\/([a-z0-9-]+\.)*stripe\.com\//.test(r.url)) throw new ApiError('BAD_RESPONSE', 'The invoice link is not one of Stripe’s.')
  return { ok: true, url: r.url }
}

// Only Stripe's tokens go up (`btok_` for a bank account, `pm_` for a card); the numbers never reach this API.
const sendToken = async (field: 'setPayoutAccount' | 'setPaymentMethod', token: string): Promise<{ ok: true } | { ok: false; reason: BillingRefusal }> => {
  const answer = await query(`mutation Token($token: String!) { ${field}(token: $token) { ok reason } }`, z.object({ [field]: resultSchema }), { token })
  const r = answer[field]
  if (!r) throw new ApiError('BAD_RESPONSE', `No ${field} in the answer.`)
  return r.ok ? { ok: true } : { ok: false, reason: refusalOf(r.reason) }
}
export const setPayoutAccount = (token: string) => sendToken('setPayoutAccount', token)
export const setPaymentMethod = (token: string) => sendToken('setPaymentMethod', token)

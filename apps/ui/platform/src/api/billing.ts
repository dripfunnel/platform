import type { Money } from '@dripfunnel/shared/format'
import { ApiError, type PageRequest } from '@dripfunnel/shared/graphql'
import { z } from 'zod'
import { query } from './client'
import { pageInfoFields, pageInfoSchema, type Page } from './page'

// Billing on the Platform API (FIRST-RELEASE.md §11, §14.3, §16; #201): merchants' payments,
// payouts and DripFunnel's invoices, who bills, and the payout account and card. Every figure,
// date and status is the API's; the console words them.

const money = z.object({ amount: z.number().int(), currency: z.string() })

const paymentSchema = z.object({
  id: z.string(),
  at: z.string(),
  storeId: z.string(),
  storeName: z.string(),
  kind: z.enum(['subscription', 'proration', 'refund']),
  amount: money,
  status: z.enum(['paid', 'failed', 'recovered', 'refunded']),
  // Stripe's own sentence about a failure, shown as given.
  note: z.string().nullable(),
  cardLast4: z.string().nullable(),
})
export type MerchantPayment = z.infer<typeof paymentSchema>
export type PaymentStatus = MerchantPayment['status']

const failedSchema = z.object({
  storeId: z.string(),
  storeName: z.string(),
  amount: money,
  why: z.string().nullable(),
  cardLast4: z.string().nullable(),
  retryAt: z.string().nullable(),
  attempt: z.number().int(),
  attempts: z.number().int(),
})
export type FailedPayment = z.infer<typeof failedSchema>

// `heldContract` waits on the contract term's model (FIRST-RELEASE §18), so the API never answers it.
const nextSchema = z.object({ state: z.enum(['scheduled', 'heldNoAccount', 'heldVerifying', 'heldVerification', 'first']), date: z.string().nullable(), soFar: money.nullable(), toLast4: z.string().nullable() })
export type NextPayout = { state: 'scheduled'; date: string; soFar: Money; toLast4: string | null } | { state: 'heldNoAccount' | 'heldVerifying' | 'heldVerification' } | { state: 'first' }

const payoutSchema = z.object({
  id: z.string(),
  month: z.string(),
  collected: money,
  fee: money,
  adjustment: z.object({ amount: money, note: z.string().nullable() }).nullable(),
  payout: money,
  paidOn: z.string().nullable(),
  status: z.enum(['paid', 'scheduled', 'held', 'failed']),
  toLast4: z.string().nullable(),
})
export type Payout = z.infer<typeof payoutSchema>

const invoiceSchema = z.object({ id: z.string(), number: z.string().nullable(), at: z.string(), what: z.string(), amount: money, status: z.enum(['paid', 'open', 'overdue']) })
export type Invoice = z.infer<typeof invoiceSchema>

const payoutAccountSchema = z.object({ bank: z.string().nullable(), last4: z.string().nullable(), status: z.enum(['missing', 'verifying', 'verified', 'failed']), failure: z.string().nullable() })
export type PayoutAccount = z.infer<typeof payoutAccountSchema>

const paymentMethodSchema = z.object({ brand: z.string().nullable(), last4: z.string().nullable(), expires: z.string().nullable(), status: z.enum(['missing', 'on_file', 'declined']) })
export type PaymentMethod = z.infer<typeof paymentMethodSchema>

export interface BillingMoney {
  failed: readonly FailedPayment[]
  payments: Page<MerchantPayment>
  nextPayout: NextPayout
  payouts: Page<Payout>
  invoices: Page<Invoice>
  // When the payment provider last answered, and since when it has been slow (the stale strip).
  staleSince: string | null
  payoutAccount: PayoutAccount
}

const paymentFields = `items { id at storeId storeName kind amount { amount currency } status note cardLast4 } ${pageInfoFields}`
const payoutFields = `items { id month collected { amount currency } fee { amount currency } adjustment { amount { amount currency } note } payout { amount currency } paidOn status toLast4 } ${pageInfoFields}`
const invoiceFields = `items { id number at what amount { amount currency } status } ${pageInfoFields}`

const page = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), pageInfo: pageInfoSchema })

const nextOf = (n: z.infer<typeof nextSchema>): NextPayout => {
  if (n.state !== 'scheduled') return { state: n.state }
  if (!n.date || !n.soFar) throw new ApiError('BAD_RESPONSE', 'A scheduled payout came without its date or amount.')
  return { state: 'scheduled', date: n.date, soFar: n.soFar, toLast4: n.toLast4 }
}

export const loadBilling = async (): Promise<BillingMoney> => {
  const answer = await query(
    `{
      merchantPayments { failed { storeId storeName amount { amount currency } why cardLast4 retryAt attempt attempts } ${paymentFields} }
      nextPayout { state date soFar { amount currency } toLast4 }
      payouts { ${payoutFields} }
      partnerInvoices { ${invoiceFields} }
      billingSettings { staleSince payoutAccount { bank last4 status failure } }
    }`,
    z.object({
      merchantPayments: page(paymentSchema).extend({ failed: z.array(failedSchema) }),
      nextPayout: nextSchema,
      payouts: page(payoutSchema),
      partnerInvoices: page(invoiceSchema),
      billingSettings: z.object({ staleSince: z.string().nullable(), payoutAccount: payoutAccountSchema }),
    }),
  )
  const { failed, ...payments } = answer.merchantPayments
  return {
    failed,
    payments,
    nextPayout: nextOf(answer.nextPayout),
    payouts: answer.payouts,
    invoices: answer.partnerInvoices,
    staleSince: answer.billingSettings.staleSince,
    payoutAccount: answer.billingSettings.payoutAccount,
  }
}

export const loadMorePayments = async ({ after }: PageRequest): Promise<Page<MerchantPayment>> =>
  (await query(`query More($after: String) { merchantPayments(after: $after) { ${paymentFields} } }`, z.object({ merchantPayments: page(paymentSchema) }), { after })).merchantPayments

export const loadMorePayouts = async ({ after }: PageRequest): Promise<Page<Payout>> =>
  (await query(`query More($after: String) { payouts(after: $after) { ${payoutFields} } }`, z.object({ payouts: page(payoutSchema) }), { after })).payouts

export const loadMoreInvoices = async ({ after }: PageRequest): Promise<Page<Invoice>> =>
  (await query(`query More($after: String) { partnerInvoices(after: $after) { ${invoiceFields} } }`, z.object({ partnerInvoices: page(invoiceSchema) }), { after })).partnerInvoices

/** Settings › Payout and payment (§14.3): what is on file, last 4 digits only. */
export const loadPayoutSettings = async (): Promise<{ payoutAccount: PayoutAccount; paymentMethod: PaymentMethod }> =>
  query(`{ payoutAccount { bank last4 status failure } paymentMethod { brand last4 expires status } }`, z.object({ payoutAccount: payoutAccountSchema, paymentMethod: paymentMethodSchema }))

export const billingRefusals = ['INVALID_INPUT', 'NOT_FOUND', 'NOT_CONNECTED', 'PROVIDER_UNAVAILABLE', 'TOKEN_REFUSED', 'NO_COUNTRY', 'NO_PDF'] as const
export type BillingRefusal = (typeof billingRefusals)[number]

const resultSchema = z.object({ ok: z.boolean(), reason: z.string().nullable() })

// A code this console doesn't know is an error with that code, never worded as a known one.
const refusalOf = (reason: string | null): BillingRefusal => {
  const known = billingRefusals.find((code) => code === reason)
  if (!known) throw new ApiError(reason ?? 'UNKNOWN', 'The API refused with a code this console does not know.')
  return known
}

export const setBillingMode = async (mode: 'dripfunnel' | 'own'): Promise<{ ok: true } | { ok: false; reason: BillingRefusal }> => {
  const { setBillingMode: r } = await query(`mutation Mode($mode: String!) { setBillingMode(mode: $mode) { ok reason } }`, z.object({ setBillingMode: resultSchema }), { mode })
  return r.ok ? { ok: true } : { ok: false, reason: refusalOf(r.reason) }
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

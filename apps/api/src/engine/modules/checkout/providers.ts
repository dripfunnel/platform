import type { SecretBox } from '#auth/secretBox'
import { isCardProvider, type GatewayAccount, type PaymentMode } from '#core/payments'
import type { GatewayAccountRow } from '#db/scoped/payments'

// The first release's seven ways to pay (FIRST-RELEASE §1; THIRD-PARTY-ACCESS §3.1), by region.

export const paymentProviders = ['stripe', 'paypal', 'razorpay', 'cashfree', 'phonepe', 'cod', 'bank_transfer'] as const
export type PaymentProvider = (typeof paymentProviders)[number]
export const isPaymentProvider = (p: string): p is PaymentProvider => paymentProviders.some((q) => q === p)

/** Paid later, so the order is accepted and holds its stock when placed (decided 2026-10-05 on #284). */
const manualProviders = ['cod', 'bank_transfer'] as const
export type ManualProvider = (typeof manualProviders)[number]
export const isManual = (p: string): p is ManualProvider => manualProviders.some((m) => m === p)

/** Who may take payment where (FIRST-RELEASE §1): India's and the US's providers; no other region at launch. */
export const providersFor = (country: string | null): readonly PaymentProvider[] =>
  country === 'IN' ? ['razorpay', 'cashfree', 'phonepe', 'cod', 'bank_transfer'] : country === 'US' ? ['stripe', 'paypal', 'bank_transfer'] : []

export type PaymentKind = 'card' | 'cod' | 'bank_transfer'
export const kindOf = (p: PaymentProvider): PaymentKind => (p === 'cod' ? 'cod' : p === 'bank_transfer' ? 'bank_transfer' : 'card')

export const providerLabels: Record<PaymentProvider, string> = {
  stripe: 'Stripe',
  paypal: 'PayPal',
  razorpay: 'Razorpay',
  cashfree: 'Cashfree',
  phonepe: 'PhonePe',
  cod: 'Cash on delivery',
  bank_transfer: 'Bank transfer',
}

/** A transfer is due in 3 days (decided 2026-10-05 on #284); a card payment not completed in a day is let go (decided on #309). */
export const transferDaysMs = 3 * 86_400_000
export const cardPaymentMs = 86_400_000

/** The account as an adapter acts with it: the store's pasted keys opened only for the call (THIRD-PARTY-ACCESS §3.1). */
export const openAccount = async (row: GatewayAccountRow, mode: PaymentMode, secrets: SecretBox | null): Promise<GatewayAccount | null> => {
  if (!isCardProvider(row.provider)) return null
  if (!row.credentials_enc) return { mode, externalAccountId: row.external_account_id, credentials: {} }
  const opened = secrets ? await secrets.open(row.credentials_enc) : null
  if (!opened) return null
  const parsed: unknown = JSON.parse(opened)
  if (typeof parsed !== 'object' || parsed === null) return null
  const credentials = Object.fromEntries(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string'))
  return { mode, externalAccountId: row.external_account_id, credentials }
}

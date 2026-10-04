import type { Money } from '@dripfunnel/shared/format'

// Billing's money (FIRST-RELEASE.md §11, §16): merchants' payments, payouts and DripFunnel's
// invoices, which have no API until #201 connects the payment provider. Who bills is the shell's
// partnerState.billingMode; the screen draws these shapes only from the ?state= sample.

export type PaymentStatus = 'paid' | 'failed' | 'recovered' | 'refunded'

export interface MerchantPayment {
  id: string
  at: string
  storeId: string
  storeName: string
  amount: Money
  status: PaymentStatus
  // The status's own words from the API, such as why a payment failed.
  note: string | null
  cardLast4: string | null
}

export interface FailedPayment {
  storeId: string
  storeName: string
  amount: Money
  why: string
  cardLast4: string | null
  retryAt: string
  attempt: number
  attempts: number
}

export type NextPayout =
  | { state: 'scheduled'; date: string; soFar: Money; toLast4: string }
  | { state: 'heldVerification' }
  | { state: 'heldContract' }
  | { state: 'first' }

export interface Payout {
  month: string
  collected: Money
  fee: Money
  adjustment: { amount: Money; note: string } | null
  payout: Money
  paidOn: string | null
  status: 'paid' | 'scheduled' | 'failed'
  toLast4: string
}

export interface Invoice {
  id: string
  at: string
  what: string
  amount: Money
  status: 'paid' | 'open' | 'overdue'
  // The tax invoice's PDF, once the provider issues one.
  pdfUrl: string | null
}

export interface BillingMoney {
  failed: readonly FailedPayment[]
  payments: readonly MerchantPayment[]
  nextPayout: NextPayout
  payouts: readonly Payout[]
  invoices: readonly Invoice[]
  // When the payment provider last answered, when that was a while ago (the stale strip).
  staleSince: string | null
  // The payout account's last four digits, the only part of it ever shown (§11.4, §14.3).
  payoutAccountLast4: string | null
}

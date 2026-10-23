import { formatMoney } from '@dripfunnel/mobile-shared/format'
import { locale } from '../../../messages'

/** "₹500", or "$12.50": an amount as its chip and its choice name show it. */
export const amountLabel = (amount: string, currency: string): string => formatMoney({ amount, currency }, locale, { trimWhole: true })

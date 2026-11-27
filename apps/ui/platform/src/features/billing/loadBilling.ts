import { loadBilling, type BillingMoney } from '../../api/billing'
import type { PartnerRole } from '../shell/partnerRoles'

export type BillingData = { refused: true } | { refused: false; money: BillingMoney }

// Support has no Billing at all (§2.1), so it asks nothing; Owner and Finance connect Razorpay (#1744).
export const billingAccess = (role: PartnerRole): { denied: boolean; mayChange: boolean } => ({
  denied: role === 'partner-support',
  mayChange: role === 'partner-owner' || role === 'partner-finance',
})

export const loadBillingFor = async (role: PartnerRole): Promise<BillingData> => (billingAccess(role).denied ? { refused: true } : { refused: false, money: await loadBilling() })

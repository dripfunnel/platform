import { type CourierAccountKind, type CourierDirectory, type CourierGateway } from '#core/couriers'
import { CourierUnavailable } from '#core/couriers'
import { easyPostBook, easyPostPickup, easyPostQuote, type EasyPostCredentials } from './easypost'
import { shiprocketBook, shiprocketPickup, shiprocketQuote, type ShiprocketCredentials } from './shiprocket'

// A partner's couriers on its own accounts (THIRD-PARTY-ACCESS §4), read decrypted by #275; a missing account quotes
// nothing, so a store can't turn on a courier its partner hasn't connected.

export interface PartnerCourierAccounts {
  shiprocket: ShiprocketCredentials | null
  easypost: EasyPostCredentials | null
}

export const courierGateway = (accounts: PartnerCourierAccounts, fetchImpl: typeof fetch = fetch): CourierGateway => ({
  quote: async (provider, parcel, signal) => {
    if (provider === 'shiprocket') return accounts.shiprocket ? shiprocketQuote({ ...accounts.shiprocket, fetchImpl }, parcel, signal) : null
    return accounts.easypost ? easyPostQuote({ ...accounts.easypost, fetchImpl }, provider, parcel, signal) : null
  },
  book: async (provider, request, signal) => {
    if (provider === 'shiprocket') return accounts.shiprocket ? shiprocketBook({ ...accounts.shiprocket, fetchImpl }, request, signal) : null
    return accounts.easypost ? easyPostBook({ ...accounts.easypost, fetchImpl }, provider, request, signal) : null
  },
  pickup: async (provider, shipment, signal) => {
    // Booked through an account the partner has since removed: nobody can be asked.
    if (provider === 'shiprocket') return accounts.shiprocket ? shiprocketPickup({ ...accounts.shiprocket, fetchImpl }, shipment, signal) : Promise.reject(new CourierUnavailable('shiprocket: no account'))
    return accounts.easypost ? easyPostPickup({ ...accounts.easypost, fetchImpl }, shipment, signal) : Promise.reject(new CourierUnavailable('easypost: no account'))
  },
})

export const courierDirectory = (accountsOf: (partnerId: string) => Promise<PartnerCourierAccounts>, fetchImpl: typeof fetch = fetch): CourierDirectory => ({
  forPartner: async (partnerId) => {
    const accounts = await accountsOf(partnerId)
    const held = new Set<CourierAccountKind>([...(accounts.shiprocket ? ['shiprocket' as const] : []), ...(accounts.easypost ? ['easypost' as const] : [])])
    return { accounts: held, gateway: courierGateway(accounts, fetchImpl) }
  },
})

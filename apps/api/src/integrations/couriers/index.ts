import { type CourierAccountKind, type CourierDirectory, type CourierGateway, type LoginCheck } from '#core/couriers'
import { CourierUnavailable } from '#core/couriers'
import { easyPostBook, easyPostHook, easyPostPickup, easyPostQuote, type EasyPostCredentials } from './easypost'
import { shiprocketBook, shiprocketCheck, shiprocketHook, shiprocketPickup, shiprocketQuote, type ShiprocketCredentials } from './shiprocket'

// A store's couriers on its own accounts (THIRD-PARTY-ACCESS §4, #1489), read decrypted; a missing account quotes
// nothing, so a store can't turn on a courier it hasn't connected.

export interface StoreCourierAccounts {
  shiprocket: ShiprocketCredentials | null
  easypost: EasyPostCredentials | null
}

export const courierGateway = (accounts: StoreCourierAccounts, fetchImpl: typeof fetch = fetch): CourierGateway => ({
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
  readHook: (account, hook) => (account === 'shiprocket' ? shiprocketHook(accounts.shiprocket?.webhookToken, hook) : easyPostHook(accounts.easypost?.webhookSecret, hook)),
})

const connectable = new Set<CourierAccountKind>(['shiprocket'])

export const courierDirectory = (accountsOf: (storeId: string) => Promise<StoreCourierAccounts>, fetchImpl: typeof fetch = fetch): CourierDirectory => ({
  forStore: async (storeId) => {
    const accounts = await accountsOf(storeId)
    const held = new Set<CourierAccountKind>([...(accounts.shiprocket ? ['shiprocket' as const] : []), ...(accounts.easypost ? ['easypost' as const] : [])])
    return { accounts: held, connectable, gateway: courierGateway(accounts, fetchImpl) }
  },
  check: async (provider, login, signal): Promise<LoginCheck> => {
    // Only Shiprocket's login is a merchant's to give; a provider asked about otherwise is refused, never guessed.
    if (provider !== 'shiprocket') return 'rejected'
    return shiprocketCheck({ ...login, fetchImpl }, signal)
  },
})

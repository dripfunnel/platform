// The Customers operations on the Admin API (FIRST-RELEASE.md §5.4, §12): the only place this
// app talks to the API about shoppers' accounts. Email and phone arrive already masked for a
// role that may not see them; the screens display what they are given and never unmask.
import type { StaffRole } from '../features/shell/staffRoles'
import { customersServer } from './customersSample'
import type { PageInfo, PageRequest } from '@dripfunnel/shared/graphql'
import { harnessEnabled } from '../harness'

export const customerStatuses = ['active', 'unverified', 'deleted'] as const
export type CustomerStatus = (typeof customerStatuses)[number]

export const signInMethods = ['email', 'mobile', 'both'] as const
export type SignInMethod = (typeof signInMethods)[number]

export const customerWindows = ['7d', '30d'] as const
export type CustomerWindow = (typeof customerWindows)[number]

// No search term here: it is never in the URL (decided on #42), so it travels on its own.
export interface CustomerFilter {
  partner?: string | undefined
  store?: string | undefined
  status?: CustomerStatus | undefined
  via?: SignInMethod | undefined
  created?: CustomerWindow | undefined
  lastSignIn?: CustomerWindow | undefined
}

// `phoneRegion` is the country the number belongs to, so a digits-only match across countries
// reads as different people (decided on #42). A deleted customer has no name or contacts left.
export interface CustomerRow {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  phoneRegion: string | null
  store: { id: string; name: string }
  partner: { id: string; name: string }
  signsInWith: SignInMethod | null
  status: CustomerStatus
  orders: number
  createdAt: string
  lastSignInAt: string | null
}

// What an exact email or phone search found across every page, not only the one returned:
// how many store accounts, and for a phone the countries its numbers belong to, so a match
// spanning countries reads as different people (decided on #42). Null for a name search or
// none. An exact search matches a handful of accounts, so counting them all is cheap.
export interface CustomerMatch {
  kind: 'email' | 'phone'
  accounts: number
  regions: readonly string[]
}

export interface CustomerPage {
  items: readonly CustomerRow[]
  pageInfo: PageInfo
  match: CustomerMatch | null
  partners: readonly { id: string; name: string }[]
  stores: readonly { id: string; name: string }[]
}

// `contactsMasked` is the API saying it withheld the full values from this caller, so the
// page can say who may see them.
export interface Customer extends CustomerRow {
  emailVerified: boolean
  phoneVerified: boolean
  contactsMasked: boolean
  deletedAt: string | null
  storeSuspension: { reason: string } | null
}

// The API's cap on a page; it answers with fewer when there are fewer.
export const customerPageSize = 25

const notConnected = () => Promise.reject(new Error('The Admin API has no customers queries yet (#36).'))

// Seam: replace the sample with the Admin API's `customers(filter, after, before)` and
// `customer(id)` queries through createApiClient from @dripfunnel/shared/graphql once #36 lands
// (https://github.com/dripfunnel/platform/issues/36). The search term goes in the POST body,
// never a URL. `customer(id)` writes the `customer.viewed` entry on the server (LOGGING.md §3).
// `caller` stands in for the session the API reads the staff role from, and goes with the
// sample. The sample is invented, so it appears only where the ?state= harness does.
export const loadCustomers = (filter: CustomerFilter, page: PageRequest, search: string | null): Promise<CustomerPage> =>
  harnessEnabled ? Promise.resolve(customersServer.list(filter, page, search, customerPageSize)) : notConnected()

export const loadCustomer = (id: string, caller: StaffRole): Promise<Customer | null> =>
  harnessEnabled ? Promise.resolve(customersServer.get(id, caller)) : notConnected()

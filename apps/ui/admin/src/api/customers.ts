// The Customers operations on the Admin API (FIRST-RELEASE.md §5.4, §12): the only place this
// app talks to the API about shoppers' accounts. Email and phone arrive already masked for a
// role that may not see them; the screens display what they are given and never unmask.
import type { PageInfo, PageRequest } from '@dripfunnel/shared/graphql'
import { z } from 'zod'
import { query } from './client'
import { filterOf, isoString, pageInfoSchema, refSchema } from './decode'

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

const account = {
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  phoneRegion: z.string().nullable(),
  store: refSchema,
  partner: refSchema,
  signsInWith: z.enum(signInMethods).nullable(),
  status: z.enum(customerStatuses),
  orders: z.number().int().nonnegative(),
  createdAt: isoString,
  lastSignInAt: isoString.nullable(),
}
const accountFields = 'id name email phone phoneRegion store { id name } partner { id name } signsInWith status orders createdAt lastSignInAt'

const pageSchema = z.object({
  customers: z.object({
    items: z.array(z.object(account)),
    pageInfo: pageInfoSchema,
    match: z.object({ kind: z.enum(['email', 'phone']), accounts: z.number().int().nonnegative(), regions: z.array(z.string()) }).nullable(),
    partners: z.array(refSchema),
    stores: z.array(refSchema),
  }),
})

const customerSchema = z.object({
  customer: z
    .object({
      ...account,
      emailVerified: z.boolean(),
      phoneVerified: z.boolean(),
      contactsMasked: z.boolean(),
      deletedAt: isoString.nullable(),
      storeSuspension: z.object({ reason: z.string() }).nullable(),
    })
    .nullable(),
})

// The search term travels as a variable in the POST body, never in a URL (decided on #42).
export const loadCustomers = async (filter: CustomerFilter, page: PageRequest, search: string | null): Promise<CustomerPage> =>
  (
    await query(
      `query Customers($filter: CustomerFilter, $search: String, $after: String, $before: String) {
        customers(filter: $filter, search: $search, after: $after, before: $before) {
          items { ${accountFields} } pageInfo { startCursor endCursor hasPreviousPage hasNextPage }
          match { kind accounts regions } partners { id name } stores { id name }
        }
      }`,
      pageSchema,
      { filter: filterOf(filter, ['partner', 'store', 'status', 'via', 'created', 'lastSignIn']), search, after: page.after, before: page.before },
    )
  ).customers

// Opening a customer writes the `customer.viewed` entry on the server (LOGGING.md §3); the
// contacts arrive unmasked only for a role with `customers.contact.read`.
export const loadCustomer = async (id: string): Promise<Customer | null> =>
  (
    await query(
      `query Customer($id: ID!) { customer(id: $id) { ${accountFields} emailVerified phoneVerified contactsMasked deletedAt storeSuspension { reason } } }`,
      customerSchema,
      { id },
    )
  ).customer

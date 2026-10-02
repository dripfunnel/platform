// The prototype's sample shoppers (designs/admin-data.js), served the way the Admin API would
// serve them: filtered, matched, masked and paged here, never in a component. Every contact is
// invented (example.com addresses, made-up numbers), and the file holds them in full: what is
// masked is each answer, by the caller's role. It stands in for the server until #36.
import type { StaffRole } from '../features/shell/staffRoles'
import type { Customer, CustomerFilter, CustomerMatch, CustomerPage, CustomerRow, CustomerStatus, SignInMethod } from './customers'
import type { PageRequest } from '@dripfunnel/shared/ui'
import { samplePage } from './samplePage'
import { sampleStores } from './storesSample'

interface SamplePhone {
  display: string
  callingCode: string
  region: string
}

export interface SampleCustomer {
  id: string
  name: string | null
  email: string | null
  phone: SamplePhone | null
  store: string
  signsInWith: SignInMethod
  status: CustomerStatus
  orders: number
  createdAt: string
  lastSignInAt: string | null
  emailVerified: boolean
  phoneVerified: boolean
  deletedAt: string | null
}

// Full email and phone for Super admin and Support only (settled by #31).
const fullContactRoles: readonly StaffRole[] = ['staff-super-admin', 'staff-support']

const india = (display: string): SamplePhone => ({ display, callingCode: '91', region: 'IN' })
const us = (display: string): SamplePhone => ({ display, callingCode: '1', region: 'US' })

type Seed = [
  id: string,
  name: string | null,
  email: string | null,
  phone: SamplePhone | null,
  store: string,
  signsInWith: SignInMethod,
  status: CustomerStatus,
  orders: number,
  createdAt: string,
  lastSignInAt: string | null,
  emailVerified: boolean,
  phoneVerified: boolean,
  deletedAt?: string,
]

const customer = ([id, name, email, phone, store, signsInWith, status, orders, createdAt, lastSignInAt, emailVerified, phoneVerified, deletedAt]: Seed): SampleCustomer => ({
  id,
  name,
  email,
  phone,
  store,
  signsInWith,
  status,
  orders,
  createdAt: `${createdAt}T00:00:00Z`,
  lastSignInAt,
  emailVerified,
  phoneVerified,
  deletedAt: deletedAt ? `${deletedAt}T00:00:00Z` : null,
})

// c12 shares c1's national number in another country, so a digits-only search finds two
// different people (decided on #42).
export const sampleCustomers: readonly SampleCustomer[] = (
  [
    ['c1', 'Priya Sharma', 'priya.sharma@example.com', india('+91 98765 43210'), 's1', 'mobile', 'active', 12, '2026-03-03', '2026-09-26T18:40:00Z', true, true],
    ['c2', 'Priya Sharma', 'priya.sharma@example.com', india('+91 98765 43210'), 's9', 'both', 'active', 4, '2026-09-24', '2026-09-27T09:15:00Z', true, true],
    ['c3', 'Priya Sharma', 'priya.sharma@example.com', null, 's11', 'email', 'active', 1, '2026-05-19', '2026-08-30T11:02:00Z', true, false],
    ['c4', 'Daniel Brooks', 'daniel.brooks@example.org', us('+1 415 555 0182'), 's15', 'email', 'unverified', 3, '2026-07-08', '2026-09-22T20:31:00Z', false, false],
    ['c5', null, null, null, 's1', 'email', 'deleted', 7, '2025-09-14', null, false, false, '2026-08-12'],
    ['c6', 'Marcus Reid', 'marcus.reid@example.com', us('+1 312 555 0147'), 's4', 'both', 'active', 9, '2025-11-02', '2026-09-23T16:05:00Z', true, true],
    ['c7', 'Aditi Rao', 'aditi.rao@example.com', india('+91 99887 76655'), 's1', 'email', 'active', 0, '2026-09-28', '2026-09-28T09:44:00Z', true, false],
    ['c8', 'Sofia Lindqvist', 'sofia.l@example.net', { display: '+44 7700 900123', callingCode: '44', region: 'GB' }, 's8', 'email', 'active', 21, '2025-12-11', '2026-09-27T21:48:00Z', true, false],
    ['c9', 'Hamad Al Mansoori', null, { display: '+971 50 555 4567', callingCode: '971', region: 'AE' }, 's3', 'mobile', 'active', 5, '2026-01-20', '2026-09-25T13:10:00Z', false, true],
    ['c10', 'Emily Chen', 'emily.chen@example.com', us('+1 206 555 0199'), 's2', 'email', 'active', 2, '2026-09-16', '2026-09-27T15:20:00Z', true, false],
    ['c11', 'Karan Singh', null, india('+91 91234 56780'), 's1', 'mobile', 'unverified', 0, '2026-09-27', '2026-09-27T07:30:00Z', false, false],
    ['c12', 'Jordan Miles', 'jordan.miles@example.org', us('+1 987 654 3210'), 's13', 'both', 'active', 6, '2026-04-02', '2026-09-24T14:02:00Z', true, true],
  ] satisfies Seed[]
).map(customer)

const digitsOf = (value: string) => value.replace(/\D/g, '')

const maskEmail = (email: string) => {
  const [user = '', domain = ''] = email.split('@')
  return `${user.slice(0, 2)}***@${domain}`
}

const maskPhone = (phone: SamplePhone) => `+${phone.callingCode} ***** ${digitsOf(phone.display).slice(-5)}`

// What a typed search is: an address is matched exactly, a number by its digits with or
// without its country code (decided on #42), anything else as part of a name.
const searchKind = (term: string): CustomerMatch['kind'] | 'name' => {
  if (term.includes('@')) return 'email'
  return /^[+\d\s().-]+$/.test(term) && digitsOf(term).length >= 8 ? 'phone' : 'name'
}

const matchesSearch = (seed: SampleCustomer, search: string) => {
  const term = search.trim().toLowerCase()
  if (seed.status === 'deleted') return false
  switch (searchKind(term)) {
    case 'email':
      return seed.email?.toLowerCase() === term
    case 'phone': {
      if (!seed.phone) return false
      const full = digitsOf(seed.phone.display)
      return digitsOf(term) === full || digitsOf(term) === full.slice(seed.phone.callingCode.length)
    }
    case 'name':
      return seed.name?.toLowerCase().includes(term) ?? false
  }
}

// Worked out over every match, so the count and the countries don't change from page to page.
const matchOf = (search: string | null, all: readonly SampleCustomer[]): CustomerMatch | null => {
  const kind = search ? searchKind(search.trim()) : 'name'
  if (kind === 'name' || all.length === 0) return null
  const regions = kind === 'phone' ? [...new Set(all.flatMap((one) => (one.phone ? [one.phone.region] : [])))] : []
  return { kind, accounts: all.length, regions }
}

const dayMs = 86_400_000

const withinDays = (iso: string | null, days: number, now: string) => iso !== null && Date.parse(now) - Date.parse(iso) <= days * dayMs

const windowDays = { '7d': 7, '30d': 30 } as const

const storeOf = (id: string) => sampleStores.find((store) => store.id === id)

const matches = (seed: SampleCustomer, filter: CustomerFilter, now: string) => {
  const store = storeOf(seed.store)
  return (
    (!filter.partner || store?.partner.id === filter.partner) &&
    (!filter.store || seed.store === filter.store) &&
    (!filter.status || seed.status === filter.status) &&
    (!filter.via || seed.signsInWith === filter.via) &&
    (!filter.created || withinDays(seed.createdAt, windowDays[filter.created], now)) &&
    (!filter.lastSignIn || withinDays(seed.lastSignInAt, windowDays[filter.lastSignIn], now))
  )
}

const newestFirst = (a: SampleCustomer, b: SampleCustomer) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)

const rowOf = (seed: SampleCustomer, full: boolean): CustomerRow => {
  const store = storeOf(seed.store)
  const deleted = seed.status === 'deleted'
  return {
    id: seed.id,
    name: deleted ? null : seed.name,
    email: deleted || !seed.email ? null : full ? seed.email : maskEmail(seed.email),
    phone: deleted || !seed.phone ? null : full ? seed.phone.display : maskPhone(seed.phone),
    phoneRegion: deleted || !seed.phone ? null : seed.phone.region,
    store: { id: seed.store, name: store?.name ?? seed.store },
    partner: store?.partner ?? { id: '', name: '' },
    signsInWith: deleted ? null : seed.signsInWith,
    status: seed.status,
    orders: seed.orders,
    createdAt: seed.createdAt,
    lastSignInAt: deleted ? null : seed.lastSignInAt,
  }
}

const uniqueBy = <Item extends { id: string }>(items: readonly Item[]) => [...new Map(items.map((item) => [item.id, item])).values()]

export const createCustomersServer = (seed: readonly SampleCustomer[], now: () => string = () => new Date().toISOString()) => {
  // The list is masked for every role: full values are matched, never shown in it (§5.4).
  const list = (filter: CustomerFilter, page: PageRequest, search: string | null, size: number): CustomerPage => {
    const all = seed.filter((one) => matches(one, filter, now()) && (!search || matchesSearch(one, search))).sort(newestFirst)
    const { items, pageInfo } = samplePage(all, page, size)
    return {
      items: items.map((one) => rowOf(one, false)),
      pageInfo,
      match: matchOf(search, all),
      partners: uniqueBy(sampleStores.map((store) => store.partner)),
      stores: sampleStores.map((store) => ({ id: store.id, name: store.name })),
    }
  }

  const get = (id: string, caller: StaffRole): Customer | null => {
    const one = seed.find((candidate) => candidate.id === id)
    if (!one) return null
    const deleted = one.status === 'deleted'
    const full = fullContactRoles.includes(caller)
    const store = storeOf(one.store)
    return {
      ...rowOf(one, full),
      emailVerified: one.emailVerified,
      phoneVerified: one.phoneVerified,
      contactsMasked: !full && !deleted,
      deletedAt: one.deletedAt,
      storeSuspension: store?.state.kind === 'suspended' ? { reason: store.state.reason } : null,
    }
  }

  return { list, get }
}

export const customersServer = createCustomersServer(sampleCustomers)

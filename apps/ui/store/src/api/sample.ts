import { parseScreenState } from '@dripfunnel/shared/ui'
import { harnessEnabled } from '../harness'
import type { NavBadgeSource } from '../nav'
import type { Brand } from './brand'
import type { Me, StoreChoice, StoreState } from './shell'

// The harness's shell, as the prototype's controls show it (ui/README.md §6): `?as=` a role or
// supplier tier, `?store=` a standing, `?brand=partner` the partner look. Only in a harness build,
// where Vite folds the condition so production carries none of it.

export const sampleSeats = ['owner', 'manager', 'staff', 'supplier-stock', 'supplier-catalogue', 'supplier-orders', 'supplier-admin'] as const
export type SampleSeat = (typeof sampleSeats)[number]
export const sampleStandings = ['active', 'trial', 'trial-ending', 'pastdue', 'suspended', 'cancelled', 'provisioning', 'support'] as const
export type SampleStanding = (typeof sampleStandings)[number]

export interface ShellSample {
  me: Me
  stores: StoreChoice[]
  state: StoreState
  badges: Record<NavBadgeSource, number>
}

const day = 24 * 60 * 60 * 1000
const kesari = { id: 'store-kesari', name: 'Kesari Threads' }
const northwind = { id: 'seller-northwind', name: 'Northwind Textiles' }
const business = { id: 'plan-business', name: 'Business' }

const seatFacts: Record<SampleSeat, { name: string; email: string; role: string; tier: string | null; seller: typeof northwind | null }> = {
  owner: { name: 'Farhan Ali', email: 'farhan@kesarithreads.in', role: 'owner', tier: null, seller: null },
  manager: { name: 'Meera Iyer', email: 'meera@kesarithreads.in', role: 'manager', tier: null, seller: null },
  staff: { name: 'Arjun Das', email: 'arjun@kesarithreads.in', role: 'staff', tier: null, seller: null },
  'supplier-stock': { name: 'Nadia Tran', email: 'nadia@northwind.example', role: 'supplier-member', tier: 'vendor-stock', seller: northwind },
  'supplier-catalogue': { name: 'Nadia Tran', email: 'nadia@northwind.example', role: 'supplier-member', tier: 'vendor-catalogue', seller: northwind },
  'supplier-orders': { name: 'Nadia Tran', email: 'nadia@northwind.example', role: 'supplier-member', tier: 'vendor-orders-fulfil', seller: northwind },
  'supplier-admin': { name: 'Nadia Tran', email: 'nadia@northwind.example', role: 'supplier-admin', tier: 'vendor-orders-fulfil', seller: northwind },
}

const stateFor = (standing: SampleStanding, now: Date): StoreState => ({
  readOnly: standing === 'pastdue' || standing === 'cancelled',
  status: standing === 'trial' || standing === 'trial-ending' ? 'trial' : standing === 'pastdue' ? 'past_due' : standing === 'suspended' ? 'suspended' : standing === 'cancelled' ? 'cancelled' : 'active',
  trialEndsAt: standing === 'trial' ? new Date(now.getTime() + 7 * day).toISOString() : standing === 'trial-ending' ? new Date(now.getTime() + day).toISOString() : null,
  pastDueSince: standing === 'pastdue' ? new Date(now.getTime() - 3 * day).toISOString() : null,
  provisioning: standing === 'provisioning' ? { state: 'running', step: 'firstBuild' } : null,
  support: standing === 'support' ? { partnerName: 'Northstar Commerce', agentFirstName: 'Priya', endsAt: new Date(now.getTime() + 28 * 60_000).toISOString() } : null,
})

/** The sample shell for `?as=`, or null outside the harness or without it. */
export const shellSample = (search: { as?: string | undefined; store?: string | undefined }, now = new Date()): ShellSample | null => {
  if (!harnessEnabled) return null
  const seat = parseScreenState(search.as, sampleSeats)
  if (!seat) return null
  const facts = seatFacts[seat]
  const standing = parseScreenState(search.store, sampleStandings) ?? 'trial'
  const supplier = facts.seller !== null
  const permissions = supplier ? ['catalog.read'] : ['catalog.read', 'orders.read']
  return {
    me: { id: `sample-${seat}`, name: facts.name, email: facts.email, acting: { store: kesari, role: facts.role, tier: facts.tier, seller: facts.seller, plan: supplier ? null : business, permissions } },
    stores: [
      { membershipId: 'm-kesari', store: kesari, role: facts.role, tier: facts.tier, seller: facts.seller },
      ...(supplier ? [] : [{ membershipId: 'm-aurelia', store: { id: 'store-aurelia', name: 'Aurelia Home' }, role: 'manager', tier: null, seller: null }]),
    ],
    state: stateFor(standing, now),
    badges: { ordersToShip: 3, productsToApprove: seat === 'owner' || seat === 'manager' ? 2 : 0 },
  }
}

/** The prototype's partner sample (Northstar Commerce), for `?brand=partner`. */
export const brandSample = (search: URLSearchParams): Brand | null =>
  harnessEnabled && search.get('brand') === 'partner'
    ? { productName: 'Northstar Shops', primaryColor: '#1B3A5B', accentColor: '#2BB673', font: null, corner: null, background: null, files: { logoLight: null, logoDark: null, mark: null, favicon: null }, supportEmail: 'help@northstar.shop', supportUrl: null, helpUrl: null, poweredBy: true }
    : null

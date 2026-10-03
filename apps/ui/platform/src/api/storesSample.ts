import { csvLink, type Money } from '@dripfunnel/shared/format'
import { pageByCursor, type ExportJob, type PageRequest } from '@dripfunnel/shared/graphql'
import type { PartnerRole } from '../features/shell/partnerRoles'
import { storesCsv } from '../features/stores/storesCsv'
import type { PartnerState } from './me'
import {
  createStoreInput,
  provisioningSteps,
  storePageSize,
  type ActionPermission,
  type BillingMode,
  type BillingStatus,
  type BillingStatusResult,
  type ChangePlanOptions,
  type CreatePermission,
  type CreateStoreForm,
  type CreateStoreInput,
  type CreateStoreResult,
  type LimitKey,
  type ProvisioningProgress,
  type Store,
  type StoreAction,
  type StoreActionInput,
  type StoreActionResult,
  type StoreFilter,
  type StorePage,
  type StorePermissions,
  type StoreRow,
  type StoreState,
  type StoreStatus,
  type StorefrontState,
} from './stores'

// Northstar's stores from the prototype (designs/partner-data.js), served the way the Platform API
// would: filtered, sorted, paged and permission-checked here. Its calendar is frozen at `today`.
const today = Date.parse('2026-09-29T17:42:00Z')
const dayMs = 86_400_000

type Country = 'United States' | 'Canada'

const countries: readonly { name: Country; currency: string }[] = [
  { name: 'United States', currency: 'USD' },
  { name: 'Canada', currency: 'CAD' },
]

// Northstar's plans as #117 drew them, until #166 replaces this fixture with the Platform API.
const planCatalogue: readonly { id: string; name: string; status: string; prices: Record<string, readonly (number | null)[]>; limits: Record<LimitKey, number> }[] = [{"id": "starter", "name": "Starter", "status": "live", "prices": {"USD": [2900, 29000], "CAD": [3900, 39000]}, "limits": {"products": 500, "staff": 2, "suppliers": 0, "ai": 50, "publish": 20}}, {"id": "growth", "name": "Growth", "status": "live", "prices": {"USD": [4900, 49000], "CAD": [6500, 65000]}, "limits": {"products": 5000, "staff": 5, "suppliers": 5, "ai": 200, "publish": 60}}, {"id": "pro", "name": "Pro", "status": "live", "prices": {"USD": [9900, 99000], "CAD": [12900, 129000]}, "limits": {"products": 10000, "staff": 15, "suppliers": 20, "ai": 500, "publish": 150}}, {"id": "basic24", "name": "Basic (2024)", "status": "retired", "prices": {"USD": [1900, 19000], "CAD": [2500, 25000]}, "limits": {"products": 200, "staff": 1, "suppliers": 0, "ai": 0, "publish": 10}}]

const catalogue = () =>
  planCatalogue.map((plan) => ({
    id: plan.id,
    name: plan.name,
    status: plan.status,
    price: Object.fromEntries(Object.entries(plan.prices).map(([currency, [monthly]]) => [currency, monthly ?? 0])),
    limits: { products: plan.limits.products, staff: plan.limits.staff, suppliers: plan.limits.suppliers, ai: plan.limits.ai, publish: plan.limits.publish } satisfies Record<LimitKey, number>,
  }))
const livePlans = () => catalogue().filter((plan) => plan.status === 'live')

type Usage = [products: number, staff: number, suppliers: number, ai: number, publish: number]

interface Seed {
  id: string
  name: string
  code: string
  owner: [name: string, email: string]
  country: Country
  plan: string
  status: StoreStatus
  trialEnd?: string
  pastDueSince?: string
  reason?: string | undefined
  cancelledOn?: string
  created: string
  sales: number
  storefront?: StorefrontState
  domain: { host: string; custom: boolean; status?: 'waiting'; since?: string }
  usage: Usage
  orders?: number
  people?: number
  card?: string | null
  overrides?: readonly { what: string; reason: string; at: string; by: string; limit: LimitKey; amount: number }[]
  users?: readonly [name: string, email: string, role: string, status: 'active' | 'invited' | 'suspended', lastSignInAt: string | null, supplier?: string][]
  allowSupport?: boolean
  stuckMinutes?: number | undefined
  suspendedOn?: string
  previous?: Exclude<StoreStatus, 'suspended'>
  history?: readonly { at: string; text: string; by: string }[]
}

const named: Seed[] = [
  { id: 'st-juniper', name: 'Juniper & Co.', code: 'juniper-co', owner: ['Anjali Nair', 'anjali@juniperco.com'], country: 'United States', plan: 'pro', status: 'active', created: '2025-12-01', sales: 18420, orders: 612, people: 9, card: '4417', domain: { host: 'juniperco.com', custom: true }, usage: [2140, 6, 3, 212, 48], overrides: [{ what: '+10 “Publish now” presses this month', reason: 'Diwali and holiday launches', at: '2026-09-02', by: 'Diego Alvarez', limit: 'publish', amount: 10 }], users: [['Anjali Nair', 'anjali@juniperco.com', 'Owner', 'active', '2026-09-28T14:02:00Z'], ['Daniel Cho', 'daniel@juniperco.com', 'Manager', 'active', '2026-09-28T16:40:00Z'], ['Farhan Ali', 'farhan@loomcraft.com', 'Supplier admin', 'active', '2026-09-25T13:20:00Z', 'Loomcraft']], history: [{ at: '2026-03-01', text: 'Growth → Pro', by: 'Diego Alvarez' }] },
  { id: 'st-harbor', name: 'Harbor Coffee Co.', code: 'harbor-coffee', owner: ['Jenna Park', 'jenna@harborcoffee.co'], country: 'United States', plan: 'growth', status: 'trial', trialEnd: '2026-10-01', created: '2026-09-15', sales: 1240, orders: 38, people: 2, card: null, domain: { host: 'harbor-coffee.shops.northstar.com', custom: false }, usage: [84, 2, 0, 41, 9], users: [['Jenna Park', 'jenna@harborcoffee.co', 'Owner', 'active', '2026-09-28T16:10:00Z'], ['Luis Ortega', 'luis@harborcoffee.co', 'Staff', 'active', '2026-09-27T16:02:00Z']] },
  { id: 'st-redline', name: 'Redline Moto Parts', code: 'redline-moto', owner: ['Dale Kowalski', 'dale@redlinemoto.com'], country: 'United States', plan: 'growth', status: 'suspended', reason: 'Chargebacks on 3 orders ($2,840).', suspendedOn: '2026-09-24', previous: 'active', history: [{ at: '2026-09-24', text: 'Active → Suspended', by: 'Diego Alvarez' }], created: '2025-11-02', sales: 0, orders: 0, people: 3, card: '0019', domain: { host: 'redlinemoto.com', custom: true }, usage: [1320, 3, 1, 20, 4], users: [['Dale Kowalski', 'dale@redlinemoto.com', 'Owner', 'active', '2026-09-24T18:00:00Z'], ['Ben Ortiz', 'ben@redlinemoto.com', 'Staff', 'suspended', '2026-09-20T12:00:00Z']] },
  { id: 'st-maple', name: 'Maple & Pine', code: 'maple-pine', owner: ['Chloé Tremblay', 'chloe@mapleandpine.ca'], country: 'Canada', plan: 'growth', status: 'active', created: '2026-04-18', sales: 8760, orders: 301, people: 4, card: '7730', allowSupport: false, domain: { host: 'shop.mapleandpine.ca', custom: true, status: 'waiting', since: '2026-09-26' }, usage: [640, 3, 1, 88, 22], users: [['Chloé Tremblay', 'chloe@mapleandpine.ca', 'Owner', 'active', '2026-09-27T22:10:00Z'], ['Hannah Cole', 'hannah@northwindwool.ca', 'Supplier admin', 'active', '2026-09-28T16:31:00Z', 'Northwind Wool']] },
  { id: 'st-tidewater', name: 'Tidewater Surf', code: 'tidewater-surf', owner: ['Marco Silva', 'marco@tidewatersurf.com'], country: 'United States', plan: 'starter', status: 'pastdue', pastDueSince: '2026-09-20', created: '2026-02-10', sales: 2310, orders: 74, people: 2, card: '1881', domain: { host: 'tidewater-surf.shops.northstar.com', custom: false }, usage: [212, 2, 0, 12, 6], users: [['Marco Silva', 'marco@tidewatersurf.com', 'Owner', 'active', '2026-09-28T17:50:00Z']] },
  { id: 'st-fieldnote', name: 'Fieldnote Paper', code: 'fieldnote-paper', owner: ['Hana Sato', 'hana@fieldnotepaper.com'], country: 'United States', plan: 'starter', status: 'trial', trialEnd: '2026-10-11', created: '2026-09-27', sales: 0, orders: 0, people: 1, card: null, storefront: 'building', stuckMinutes: 43, domain: { host: 'fieldnote-paper.shops.northstar.com', custom: false }, usage: [0, 1, 0, 3, 0], users: [['Hana Sato', 'hana@fieldnotepaper.com', 'Owner', 'invited', null]] },
  { id: 'st-copperline', name: 'Copperline Audio', code: 'copperline-audio', owner: ['Owen Price', 'owen@copperline.audio'], country: 'United States', plan: 'pro', status: 'active', created: '2025-10-05', sales: 9800, orders: 188, people: 4, card: '5520', allowSupport: false, storefront: 'own', domain: { host: 'copperline.audio', custom: true }, usage: [310, 4, 0, 0, 0] },
  { id: 'st-birch', name: 'Birch & Bramble', code: 'birch-bramble', owner: ['Leah Morgan', 'leah@birchandbramble.ca'], country: 'Canada', plan: 'starter', status: 'active', created: '2026-01-22', sales: 3120, domain: { host: 'birch-bramble.shops.northstar.com', custom: false }, usage: [481, 2, 0, 44, 17] },
  { id: 'st-prairie', name: 'Prairie Goods Co.', code: 'prairie-goods', owner: ['Tom Lindgren', 'tom@prairiegoods.ca'], country: 'Canada', plan: 'growth', status: 'active', created: '2026-03-09', sales: 4480, domain: { host: 'prairiegoods.ca', custom: true }, usage: [920, 3, 2, 60, 19] },
  { id: 'st-summit', name: 'Summit Supply', code: 'summit-supply', owner: ['Grace Liu', 'grace@summitsupply.com'], country: 'United States', plan: 'starter', status: 'cancelled', cancelledOn: '2026-09-02', history: [{ at: '2026-09-02', text: 'Active → Cancelled', by: 'Grace Liu' }], created: '2025-12-19', sales: 0, orders: 0, people: 1, card: '6621', domain: { host: 'summit-supply.shops.northstar.com', custom: false }, usage: [120, 1, 0, 0, 0] },
  { id: 'st-oakline', name: 'Oakline Home', code: 'oakline-home', owner: ['Priya Raman', 'priya@oaklinehome.com'], country: 'United States', plan: 'growth', status: 'active', created: '2025-09-30', sales: 7650, orders: 244, people: 6, card: '9902', domain: { host: 'oaklinehome.com', custom: true }, usage: [4210, 5, 4, 190, 58], users: [['Priya Raman', 'priya@oaklinehome.com', 'Owner', 'active', '2026-09-28T13:45:00Z'], ['Mateo Cruz', 'mateo@oaklinehome.com', 'Manager', 'invited', null]] },
  { id: 'st-lumen', name: 'Lumen Candle Co.', code: 'lumen-candle', owner: ['Nora Fitz', 'nora@lumencandle.com'], country: 'United States', plan: 'growth', status: 'trial', trialEnd: '2026-10-04', created: '2026-09-20', sales: 420, domain: { host: 'lumen-candle.shops.northstar.com', custom: false }, usage: [36, 1, 0, 22, 5] },
  { id: 'st-bayside', name: 'Bayside Pets', code: 'bayside-pets', owner: ['Ethan Wells', 'ethan@baysidepets.com'], country: 'United States', plan: 'growth', status: 'pastdue', pastDueSince: '2026-09-26', created: '2026-05-14', sales: 3890, orders: 131, people: 3, card: '2210', domain: { host: 'baysidepets.com', custom: true }, usage: [760, 2, 0, 31, 12] },
  { id: 'st-northfork', name: 'Northfork Outfitters', code: 'northfork', owner: ['Sam Becker', 'sam@northforkoutfitters.com'], country: 'United States', plan: 'pro', status: 'active', created: '2025-08-11', sales: 12900, orders: 402, people: 11, card: '4150', domain: { host: 'northforkoutfitters.com', custom: true }, usage: [3380, 9, 6, 301, 71], users: [['Sam Becker', 'sam@northforkoutfitters.com', 'Owner', 'active', '2026-09-28T12:30:00Z'], ['Kofi Mensah', 'kofi@trailmakers.com', 'Supplier member', 'active', '2026-09-27T14:12:00Z', 'Trailmakers']] },
]

// A seeded generator, so the 72 other stores are the same on every load.
const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const firstWords = ['Alder', 'Amber', 'Aspen', 'Beacon', 'Blue Fern', 'Bramble', 'Cedar', 'Cinder', 'Clover', 'Coastal', 'Copper', 'Crescent', 'Driftwood', 'Ember', 'Fernwood', 'Flint', 'Foxglove', 'Golden', 'Granite', 'Hollow', 'Indigo', 'Ivy', 'Juniper Hill', 'Kestrel', 'Lark', 'Linden', 'Meadow', 'Mesa', 'Moss', 'Nimbus', 'Oak & Ash', 'Orchard', 'Pebble', 'Pine', 'Quarry', 'Raven', 'Redwood', 'Ridge', 'Rowan', 'Saltwater', 'Sierra', 'Slate', 'Sparrow', 'Spruce', 'Stone', 'Sunday', 'Tamarack', 'Thistle', 'Timber', 'Tundra', 'Valley', 'Verde', 'Willow', 'Wren', 'Yarrow', 'Zephyr', 'Harvest', 'Lantern', 'Marigold', 'Oasis', 'Pioneer', 'Sage', 'Canyon', 'Highland', 'Riverbend', 'Seabright', 'Evergreen', 'Birchwood', 'Larkspur', 'Fjord', 'Dune', 'Harbor Light']
const secondWords = ['Goods', 'Studio', 'Supply', 'Co.', 'Market', 'Kitchen', 'Apparel', 'Home', 'Botanics', 'Books', 'Ceramics', 'Outfitters', 'Tea', 'Leather', 'Prints', 'Bakery']
const firstNames = ['Ava', 'Liam', 'Mia', 'Noah', 'Zoe', 'Eli', 'Ruby', 'Leo', 'Ivy', 'Owen', 'Nina', 'Jack', 'Isla', 'Theo', 'Lena', 'Max', 'Aria', 'Finn', 'Cora', 'Jude']
const lastNames = ['Hart', 'Brooks', 'Nguyen', 'Patel', 'Reyes', 'Kim', 'Walsh', 'Ford', 'Lam', 'Ross', 'Diaz', 'Shaw', 'Cole', 'Grant', 'Bishop', 'Hale', 'Moreau', 'Singh']

const pad = (n: number) => String(n).padStart(2, '0')

const generated = (): Seed[] => {
  const next = random(20260929)
  const planPool: string[] = [...Array<string>(27).fill('starter'), ...Array<string>(37).fill('growth'), ...Array<string>(8).fill('pro')]
  const statusPool: StoreStatus[] = [...Array<StoreStatus>(5).fill('trial'), 'pastdue', 'cancelled', ...Array<StoreStatus>(65).fill('active')]
  for (const pool of [planPool, statusPool]) {
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1))
      const a = pool[i]
      const b = pool[j]
      if (a !== undefined && b !== undefined) [pool[i], pool[j]] = [b, a]
    }
  }
  let trialsSeen = 0
  return planPool.map((plan, i) => {
    const name = `${firstWords[i % firstWords.length] ?? 'Store'} ${secondWords[(i * 7) % secondWords.length] ?? 'Co.'}`
    const code = name.toLowerCase().replace(/[^a-z]+/g, '-').replace(/-$/, '')
    const canada = next() < 0.3
    const first = firstNames[i % firstNames.length] ?? 'Ava'
    const last = lastNames[(i * 5) % lastNames.length] ?? 'Hart'
    const status = statusPool[i] ?? 'active'
    const month = 1 + Math.floor(next() * 12)
    const created = status === 'trial' ? `2026-09-${16 + Math.floor(next() * 10)}` : `${month > 9 ? '2025' : '2026'}-${pad(month)}-${pad(1 + Math.floor(next() * 27))}`
    const base = plan === 'pro' ? 6000 : plan === 'growth' ? 2600 : 900
    const sales = status === 'cancelled' ? 0 : Math.round(base * (0.3 + next() * 1.2))
    const limits = catalogue().find((candidate) => candidate.id === plan)?.limits ?? { products: 500, staff: 2, suppliers: 0, ai: 50, publish: 20 }
    const custom = plan !== 'starter' && next() < 0.5
    const tld = canada ? '.ca' : '.com'
    return {
      id: `st-${code}`,
      name,
      code,
      owner: [`${first} ${last}`, `${first.toLowerCase()}@${code.replace(/-/g, '')}${tld}`],
      country: canada ? 'Canada' : 'United States',
      plan,
      status,
      ...(status === 'trial' ? { trialEnd: trialsSeen++ === 0 ? '2026-09-30' : `2026-10-${pad(3 + Math.floor(next() * 10))}` } : {}),
      ...(status === 'pastdue' ? { pastDueSince: '2026-09-23' } : {}),
      ...(status === 'cancelled' ? { cancelledOn: '2026-08-30' } : {}),
      created,
      sales,
      domain: { host: custom ? `${code.replace(/-/g, '')}${tld}` : `${code}.shops.northstar.com`, custom },
      usage: [Math.round(limits.products * (0.05 + next() * 0.7)), 1 + Math.floor(next() * Math.min(3, limits.staff)), 0, Math.round(next() * limits.ai), Math.round(next() * limits.publish)],
      orders: Math.round(sales / (30 + next() * 30)),
      people: 1 + Math.floor(next() * 4),
      card: status === 'trial' ? null : String(1000 + Math.floor(next() * 8999)),
    }
  })
}

const stateOf = (seed: Seed): StoreState => {
  switch (seed.status) {
    case 'trial': {
      const trialEndsAt = `${seed.trialEnd ?? '2026-10-13'}T00:00:00Z`
      return { kind: 'trial', trialEndsAt, daysLeft: Math.max(0, Math.ceil((Date.parse(trialEndsAt) - today) / dayMs)) }
    }
    case 'pastdue':
      return { kind: 'pastdue', daysPastDue: Math.floor((today - Date.parse(`${seed.pastDueSince ?? '2026-09-23'}T00:00:00Z`)) / dayMs) }
    case 'suspended':
      return { kind: 'suspended', reason: seed.reason ?? '' }
    case 'cancelled':
      return { kind: 'cancelled', since: `${seed.cancelledOn ?? '2026-09-01'}T00:00:00Z` }
    case 'active':
      return { kind: 'active' }
  }
}

const limitOrder: readonly LimitKey[] = ['products', 'staff', 'suppliers', 'ai', 'publish']

const nearOf = (seed: Seed): StoreRow['near'] => {
  const limits = catalogue().find((plan) => plan.id === seed.plan)?.limits
  if (!limits) return null
  const ratios = limitOrder.map((limit, index) => ({ limit, ratio: limits[limit] === 0 ? 0 : (seed.usage[index] ?? 0) / limits[limit] }))
  const best = ratios.reduce((top, candidate) => (candidate.ratio > top.ratio ? candidate : top))
  return best.ratio >= 0.8 ? { percent: Math.round(best.ratio * 100), limit: best.limit } : null
}

const money = (amount: number, country: Country): Money => ({ amount, currency: countries.find((c) => c.name === country)?.currency ?? 'USD' })

const rowOf = (seed: Seed): StoreRow => ({
  id: seed.id,
  name: seed.name,
  code: seed.code,
  owner: { name: seed.owner[0], email: seed.owner[1] },
  plan: { id: seed.plan, name: catalogue().find((plan) => plan.id === seed.plan)?.name ?? seed.plan },
  near: nearOf(seed),
  state: stateOf(seed),
  salesLastMonth: seed.sales > 0 ? money(seed.sales * 100, seed.country) : null,
  storefront: seed.storefront ?? 'live',
  domain: { host: seed.domain.host, custom: seed.domain.custom, status: seed.domain.status ?? 'live' },
  createdAt: `${seed.created}T00:00:00Z`,
  billingStatus: null,
})

// In own-billing mode the partner's status for each store, from its account state (§11.4); a cancelled store has none.
const billingStatusOf = (seed: Seed): BillingStatus | null => (seed.status === 'cancelled' ? null : seed.status === 'trial' ? 'active' : seed.status)

const createdSince: Record<NonNullable<StoreFilter['created']>, number> = {
  month: Date.parse('2026-09-01T00:00:00Z'),
  '30d': today - 30 * dayMs,
  '90d': today - 90 * dayMs,
}

const matches = (row: StoreRow, filter: StoreFilter): boolean => {
  const q = filter.q?.trim().toLowerCase()
  return (
    (!filter.status || row.state.kind === filter.status) &&
    (!filter.plan || row.plan.id === filter.plan) &&
    (!filter.created || Date.parse(row.createdAt) >= createdSince[filter.created]) &&
    (!filter.storefront || row.storefront === filter.storefront) &&
    (!filter.near || row.near !== null) &&
    (!q || `${row.name} ${row.code} ${row.domain.host} ${row.owner.email} ${row.owner.name}`.toLowerCase().includes(q))
  )
}

const newestFirst = (a: StoreRow, b: StoreRow) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)

const canCreate = (caller: PartnerRole, partnerState: PartnerState): CreatePermission => {
  if (partnerState !== 'live') return { allowed: false, reason: 'PARTNER_NOT_LIVE' }
  return caller === 'partner-owner' || caller === 'partner-admin' ? { allowed: true } : { allowed: false, reason: 'OWNERS_AND_ADMINS_ONLY' }
}

// A step every 900 ms, as the prototype animates it; the real job reports its own steps (SAAS.md §5).
const stepMs = 900

const trials = [0, 7, 14, 30]

const chargedBy = 'DripFunnel for Northstar'
const nextBillingAt = '2026-10-01T00:00:00Z'
const edge = 'shops.edge.dripfunnel.net'

const statusWords: Record<StoreStatus, string> = { trial: 'Trial', active: 'Active', pastdue: 'Past due', suspended: 'Suspended', cancelled: 'Cancelled' }

const limitWords: Record<LimitKey, string> = { products: 'products', staff: 'staff seats', suppliers: 'suppliers', ai: 'AI design prompts', publish: '“Publish now” presses' }

// Who acts, per role, as the API records the actor (the prototype's Northstar team).
const actorFor: Record<PartnerRole, string> = {
  'partner-owner': 'Maya Ortiz',
  'partner-admin': 'Diego Alvarez',
  'partner-support': 'Priya Nair',
  'partner-finance': 'Sam Ortega',
  'partner-read-only': 'Alex Kim',
}

const billers: readonly PartnerRole[] = ['partner-owner', 'partner-admin', 'partner-finance']

const prepareMs = 3000
const exportLinkMs = 60 * 60_000

export interface StoresServerOptions {
  now?: () => number
  wait?: (ms: number, then: () => void) => void
  link?: (csvText: string) => string
}

const roleCan: Record<StoreAction, readonly PartnerRole[]> = {
  changePlan: ['partner-owner', 'partner-admin'],
  extendTrial: ['partner-owner', 'partner-admin', 'partner-finance'],
  addOverride: ['partner-owner', 'partner-admin'],
  suspend: ['partner-owner', 'partner-admin'],
  restore: ['partner-owner', 'partner-admin'],
  resendInvite: ['partner-owner', 'partner-admin'],
  retryStep: ['partner-owner', 'partner-admin'],
}

const isStuck = (seed: Seed) => seed.storefront === 'building' || seed.storefront === 'failed'

// Which actions a store's state offers (FIRST-RELEASE.md §6.4 "Offered when"), then who may take them (ACCESS.md §5.3).
const offered = (seed: Seed): readonly StoreAction[] => [
  ...(seed.status !== 'cancelled' ? (['changePlan', 'addOverride'] as const) : []),
  ...(seed.status === 'trial' ? (['extendTrial'] as const) : []),
  ...(seed.status === 'active' || seed.status === 'trial' || seed.status === 'pastdue' ? (['suspend'] as const) : []),
  ...(seed.status === 'suspended' ? (['restore'] as const) : []),
  'resendInvite',
  ...(isStuck(seed) ? (['retryStep'] as const) : []),
]

const permissionsFor = (seed: Seed, caller: PartnerRole): StorePermissions =>
  Object.fromEntries(
    offered(seed).map((action): [StoreAction, ActionPermission] => [
      action,
      roleCan[action].includes(caller) ? { allowed: true } : { allowed: false, reason: action === 'extendTrial' ? 'FINANCE_TRIAL_ONLY' : 'OWNERS_AND_ADMINS_ONLY' },
    ]),
  )

const firstName = (name: string) => name.split(' ')[0] ?? name
const dayOf = (iso: string) => iso.slice(0, 10)
const noon = (day: string) => `${day}T12:00:00Z`
const planOf = (seed: Seed) => catalogue().find((plan) => plan.id === seed.plan)

const usageOf = (seed: Seed): Store['usage'] =>
  limitOrder.map((limit, index) => {
    const base = planOf(seed)?.limits[limit] ?? 0
    const extra = (seed.overrides ?? []).filter((override) => override.limit === limit).reduce((sum, override) => sum + override.amount, 0)
    const cap = base + extra
    const used = seed.usage[index] ?? 0
    return { limit, used, cap: cap > 0 ? cap : null, percent: cap > 0 ? Math.round((used / cap) * 100) : null, monthly: limit === 'ai' || limit === 'publish' }
  })

const detailOf = (seed: Seed, caller: PartnerRole): Store => {
  const row = rowOf(seed)
  const plan = planOf(seed)
  const currency = countries.find((c) => c.name === seed.country)?.currency ?? 'USD'
  const price: Money = { amount: plan?.price[currency] ?? 0, currency }
  const card = seed.card ?? null
  const people = (seed.users ?? [[seed.owner[0], seed.owner[1], 'Owner', 'active', null] as const]).map(([name, email, role, status, lastSignInAt, supplier], index) => ({
    id: `${seed.id}-u${index + 1}`,
    name,
    email,
    role: supplier ? `${role} · ${supplier}` : role,
    status,
    lastSignInAt,
    supplier: supplier ?? null,
  }))
  const stuck = isStuck(seed)
  const reached = stuck ? 3 : provisioningSteps.length
  const startedAt = Date.parse(`${seed.created}T16:00:00Z`)
  const created = `${seed.created}T00:00:00Z`
  const history = [
    ...[...(seed.history ?? [])].reverse().map((entry) => ({ ...entry, at: noon(entry.at) })),
    { at: created, text: `${seed.status === 'trial' ? 'Trial started' : 'Created'} on ${plan?.name ?? seed.plan}`, by: 'Signup' },
  ].sort((a, b) => b.at.localeCompare(a.at))
  const trialEnd = seed.status === 'trial' ? noon(seed.trialEnd ?? '2026-10-13') : null
  return {
    ...row,
    country: seed.country,
    planPrice: price,
    people: { count: seed.people ?? 1, suppliers: seed.usage[2] ?? 0 },
    ordersLastMonth: seed.sales > 0 ? (seed.orders ?? 0) : null,
    contacts: people.filter((person) => !person.supplier).map(({ name, email, role }) => ({ name, email, role })),
    history,
    usage: usageOf(seed),
    overrides: (seed.overrides ?? []).map((override, index) => ({ id: `${seed.id}-o${index + 1}`, what: override.what, reason: override.reason, by: override.by, at: noon(override.at) })),
    billing: {
      cycle: 'monthly',
      price,
      next:
        seed.status === 'trial' ? { kind: 'firstCharge', at: `${seed.trialEnd ?? '2026-10-13'}T00:00:00Z` } : seed.status === 'suspended' || seed.status === 'cancelled' ? { kind: 'none' } : { kind: 'charge', at: nextBillingAt },
      payment: seed.status === 'pastdue' ? 'failed' : card ? 'paid' : 'noCard',
      cardLast4: card,
      mode: 'dripfunnel',
      chargedBy,
    },
    invoices: card
      ? ['2026-09-01', '2026-08-01', '2026-07-01'].map((day, index) => ({
          id: `INV-${seed.code.toUpperCase().replace(/-/g, '').slice(0, 6)}-${2609 - index}`,
          at: `${day}T06:00:00Z`,
          amount: price,
          status: seed.status === 'pastdue' && index === 0 ? ('failed' as const) : ('paid' as const),
          cardLast4: card,
        }))
      : [],
    site: { previewHost: `${seed.code}.preview.northstar.com`, lastPublishAt: seed.storefront === 'building' || seed.storefront === 'failed' ? null : '2026-09-26T16:00:00Z' },
    records: seed.domain.custom ? [{ type: 'CNAME', name: seed.domain.host.split('.')[0] ?? seed.domain.host, value: edge, found: row.domain.status === 'live' ? edge : null }] : [],
    waitingSince: row.domain.status === 'waiting' ? `${seed.domain.since ?? seed.created}T00:00:00Z` : null,
    setup: {
      stuck,
      steps: provisioningSteps.map((key, index) => ({
        key,
        state: index < reached ? 'done' : index === reached ? (seed.storefront === 'failed' ? 'failed' : 'slow') : 'waiting',
        detail:
          index < reached
            ? { kind: 'at', at: new Date(startedAt + index * 20_000).toISOString() }
            : index === reached
              ? { kind: 'text', text: `Running for ${seed.stuckMinutes ?? 0} min. It usually takes under two minutes.` }
              : null,
      })),
    },
    trialExtensions: trialEnd ? [3, 7, 14].map((days) => ({ days, endsAt: `${dayOf(new Date(Date.parse(trialEnd) + days * dayMs).toISOString())}T00:00:00Z` })) : [],
    support: {
      allowed: seed.allowSupport ?? true,
      people: people.map(({ id, name, email, role, status, lastSignInAt }) => ({ id, name, email, role, status, lastSignInAt })),
      sessions: seed.id === 'st-juniper' ? [{ who: 'Priya Nair as Anjali Nair', reason: 'Ticket 4821: checkout failing on Safari', at: '2026-09-25T13:20:00Z', how: 'ended' }] : [],
    },
    activity: history.map((entry, index) => ({
      id: `${seed.id}-a${index + 1}`,
      at: entry.at,
      who: entry.by,
      text: entry.text,
      result: 'success',
      facts: [
        { label: 'Who', value: entry.by },
        { label: 'Store', value: seed.name },
      ],
    })),
    notice:
      row.state.kind === 'suspended'
        ? { tone: 'danger', text: `Suspended on ${new Date(noon(seed.suspendedOn ?? seed.created)).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}: ${seed.reason ?? ''}` }
        : row.state.kind === 'pastdue'
          ? {
              tone: 'warning',
              text: `Past due for ${row.state.daysPastDue} days. ${firstName(seed.owner[0])}’s team can’t make changes, but the shop is still selling. We retry the card on ${new Date('2026-09-30T00:00:00Z').toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}.`,
            }
          : null,
    actions: permissionsFor(seed, caller),
  }
}

// `now` is the signup and export jobs' clock, the only thing here that moves.
export const createStoresServer = (initial: readonly Seed[], options: StoresServerOptions = {}) => {
  const now = options.now ?? Date.now
  const wait = options.wait ?? ((ms, then) => void setTimeout(then, ms))
  const link = options.link ?? csvLink
  let seeds = [...initial]
  const jobs = new Map<string, { startedAt: number }>()
  const exports = new Map<string, ExportJob & { expiresAtMs: number | null }>()
  const find = (id: string) => seeds.find((seed) => seed.id === id)
  const update = (id: string, change: (seed: Seed) => Seed) => {
    seeds = seeds.map((seed) => (seed.id === id ? change(seed) : seed))
  }

  const matching = (filter: StoreFilter, billing: BillingMode) =>
    seeds
      .map((seed) => ({ ...rowOf(seed), billingStatus: billing === 'own' ? billingStatusOf(seed) : null }))
      .filter((row) => matches(row, filter))
      .sort(newestFirst)

  const list = (filter: StoreFilter, page: PageRequest, caller: PartnerRole, billing: BillingMode = 'dripfunnel'): StorePage => ({
    ...pageByCursor(matching(filter, billing), page, storePageSize),
    plans: catalogue().map(({ id, name }) => ({ id, name })),
    billingMode: billing,
    actions: {
      create: canCreate(caller, 'live'),
      export: { allowed: true as const },
      ...(billing === 'own' ? { billingStatus: billers.includes(caller) ? { allowed: true as const } : { allowed: false as const, reason: 'FINANCE_TRIAL_ONLY' as const } } : {}),
    },
  })

  // Every role may export (ACCESS.md §5.3 `exports`).
  const startExport = (filter: StoreFilter): ExportJob => {
    const found = matching(filter, 'dripfunnel')
    const id = `sx${exports.size + 1}`
    const job = { id, state: 'preparing' as const, entries: null, url: null, expiresAt: null, expiresAtMs: null }
    exports.set(id, job)
    wait(prepareMs, () => {
      const expiresAtMs = now() + exportLinkMs
      exports.set(id, { ...job, state: 'ready', entries: found.length, url: link(storesCsv(found)), expiresAt: new Date(expiresAtMs).toISOString(), expiresAtMs })
    })
    return job
  }

  const exportJob = (id: string): ExportJob | null => {
    const job = exports.get(id)
    if (!job) return null
    if (job.state === 'ready' && job.expiresAtMs !== null && now() >= job.expiresAtMs) {
      const expired = { ...job, state: 'expired' as const, url: null }
      exports.set(id, expired)
      return expired
    }
    return job
  }

  // Own-billing mode only (§11.4): the status the partner sets is the store's account state.
  const setBillingStatus = (id: string, status: BillingStatus, caller: PartnerRole): BillingStatusResult => {
    if (!find(id)) throw new Error('No such store.')
    if (!billers.includes(caller)) return { ok: false, reason: 'FINANCE_TRIAL_ONLY' }
    update(id, (current) => ({ ...current, status, ...(status === 'pastdue' ? { pastDueSince: dayOf(new Date(today).toISOString()) } : {}), ...(status === 'suspended' ? { suspendedOn: dayOf(new Date(today).toISOString()), previous: current.status === 'suspended' ? 'active' : current.status } : {}) }))
    return { ok: true }
  }

  const get = (id: string, caller: PartnerRole): Store | null => {
    const seed = find(id)
    return seed ? detailOf(seed, caller) : null
  }

  const changePlanOptions = (id: string): ChangePlanOptions => {
    const seed = find(id)
    if (!seed) throw new Error('No such store.')
    const currency = countries.find((c) => c.name === seed.country)?.currency ?? 'USD'
    const current = planOf(seed)?.price[currency] ?? 0
    const others = livePlans().filter((plan) => plan.id !== seed.plan)
    return {
      plans: others.map((plan) => ({ id: plan.id, name: plan.name, price: { amount: plan.price[currency] ?? 0, currency } })),
      nextBillingAt,
      proration: Object.fromEntries(
        others.map((plan) => {
          const diff = (plan.price[currency] ?? 0) - current
          return [plan.id, diff > 0 ? { kind: 'charge', amount: { amount: Math.round((diff * 2) / 30), currency } } : diff < 0 ? { kind: 'credit' } : { kind: 'none' }]
        }),
      ),
    }
  }

  const run = (id: string, input: StoreActionInput, caller: PartnerRole): StoreActionResult => {
    const seed = find(id)
    if (!seed) throw new Error('No such store.')
    const permission = permissionsFor(seed, caller)[input.action]
    if (!permission) throw new Error('The store’s state does not offer this action.')
    if (!permission.allowed) return { ok: false, reason: permission.reason }
    const by = actorFor[caller]
    const todayDay = dayOf(new Date(today).toISOString())
    const note = (text: string) => [...(seed.history ?? []), { at: todayDay, text, by }]
    switch (input.action) {
      case 'changePlan': {
        const target = livePlans().find((plan) => plan.id === input.planId)
        if (!target) throw new Error('Unknown plan.')
        update(id, (current) => ({ ...current, plan: target.id, history: note(`${planOf(current)?.name ?? ''} → ${target.name}`) }))
        return { ok: true }
      }
      case 'extendTrial':
        update(id, (current) => {
          const end = new Date(Date.parse(noon(current.trialEnd ?? todayDay)) + input.days * dayMs).toISOString()
          return { ...current, trialEnd: dayOf(end), history: note(`Trial ends ${current.trialEnd ?? ''} → ${dayOf(end)}`) }
        })
        return { ok: true }
      case 'addOverride':
        update(id, (current) => ({
          ...current,
          overrides: [
            ...(current.overrides ?? []),
            { what: `+${input.amount} ${limitWords[input.limit]}${input.duration === 'month' ? ' this month' : ''}`, reason: input.reason, at: todayDay, by, limit: input.limit, amount: input.amount },
          ],
        }))
        return { ok: true }
      case 'suspend':
        update(id, (current) => ({
          ...current,
          status: 'suspended',
          reason: input.reason,
          suspendedOn: todayDay,
          previous: current.status === 'suspended' ? 'active' : current.status,
          history: note(`${statusWords[current.status]} → Suspended`),
        }))
        return { ok: true }
      case 'restore':
        update(id, (current) => ({ ...current, status: current.previous ?? 'active', reason: undefined, history: note(`Suspended → ${statusWords[current.previous ?? 'active']}`) }))
        return { ok: true }
      case 'resendInvite':
        return { ok: true }
      case 'retryStep':
        update(id, (current) => ({ ...current, storefront: 'live', stuckMinutes: undefined }))
        return { ok: true }
    }
  }

  const recheck = (id: string) => {
    const seed = find(id)
    return seed ? rowOf(seed).domain.status : 'waiting'
  }

  const form = (caller: PartnerRole, partnerState: PartnerState): CreateStoreForm => ({
    permission: canCreate(caller, partnerState),
    countries,
    plans: livePlans().map(({ id, name, price }) => ({ id, name, price: Object.fromEntries(Object.entries(price).map(([currency, amount]) => [currency, { amount, currency }])) })),
    trials,
    defaultTrial: 14,
    chargedBy,
  })

  const create = (input: CreateStoreInput, caller: PartnerRole, partnerState: PartnerState): CreateStoreResult => {
    const permission = canCreate(caller, partnerState)
    if (!permission.allowed) return { ok: false, reason: permission.reason }
    const valid = createStoreInput.parse(input)
    const plan = livePlans().find((candidate) => candidate.id === valid.planId)
    const country = countries.find((candidate) => candidate.name === valid.country)
    if (!plan || !country || !trials.includes(valid.trialDays)) throw new Error('Unknown plan, country or trial.')
    const code = valid.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const id = `st-${code}-${seeds.length + 1}`
    seeds = [
      {
        id,
        name: valid.name,
        code,
        owner: [valid.ownerName, valid.ownerEmail],
        country: country.name,
        plan: plan.id,
        status: valid.trialDays === 0 ? 'active' : 'trial',
        trialEnd: dayOf(new Date(today + valid.trialDays * dayMs).toISOString()),
        created: dayOf(new Date(today).toISOString()),
        sales: 0,
        storefront: 'building',
        domain: { host: `${code}.shops.northstar.com`, custom: false },
        usage: [0, 1, 0, 0, 0],
        people: 1,
        card: null,
        users: [[valid.ownerName, valid.ownerEmail, 'Owner', 'invited', null]],
      },
      ...seeds,
    ]
    jobs.set(id, { startedAt: now() })
    return { ok: true, storeId: id }
  }

  const progress = (storeId: string): ProvisioningProgress => {
    const job = jobs.get(storeId)
    if (!job) throw new Error('No such signup job.')
    const elapsedMs = now() - job.startedAt
    const reached = Math.min(provisioningSteps.length - 1, Math.floor(elapsedMs / stepMs))
    const done = reached >= provisioningSteps.length - 1
    if (done) update(storeId, (current) => ({ ...current, storefront: 'live' }))
    return {
      steps: provisioningSteps.map((key, index) => ({ key, state: index < reached || done ? 'done' : index === reached ? 'running' : 'waiting' })),
      done,
      elapsedSeconds: done ? Math.round(((provisioningSteps.length - 1) * stepMs) / 1000) : Math.floor(elapsedMs / 1000),
    }
  }

  return { list, get, changePlanOptions, run, recheck, form, create, progress, startExport, exportJob, setBillingStatus }
}

export const sampleStores: readonly Seed[] = [...named, ...generated()]

export const storesServer = createStoresServer(sampleStores)

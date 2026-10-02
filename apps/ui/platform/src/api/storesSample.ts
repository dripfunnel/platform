import type { Money } from '@dripfunnel/shared/format'
import { pageByCursor, type PageRequest } from '@dripfunnel/shared/graphql'
import type { PartnerRole } from '../features/shell/partnerRoles'
import type { PartnerState } from './me'
import {
  createStoreInput,
  provisioningSteps,
  searchMaxResults,
  storePageSize,
  type CreatePermission,
  type CreateStoreForm,
  type CreateStoreInput,
  type CreateStoreResult,
  type LimitKey,
  type ProvisioningProgress,
  type StoreFilter,
  type StoreMatch,
  type StorePage,
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
type PlanId = 'starter' | 'growth' | 'pro'

const countries: readonly { name: Country; currency: string }[] = [
  { name: 'United States', currency: 'USD' },
  { name: 'Canada', currency: 'CAD' },
]

const plans: readonly { id: PlanId; name: string; price: Record<string, number>; limits: Record<LimitKey, number> }[] = [
  { id: 'starter', name: 'Starter', price: { USD: 2900, CAD: 3900 }, limits: { products: 500, staff: 2, suppliers: 0, ai: 50, publish: 20 } },
  { id: 'growth', name: 'Growth', price: { USD: 4900, CAD: 6500 }, limits: { products: 5000, staff: 5, suppliers: 5, ai: 200, publish: 60 } },
  { id: 'pro', name: 'Pro', price: { USD: 9900, CAD: 12900 }, limits: { products: 10000, staff: 15, suppliers: 20, ai: 500, publish: 150 } },
]

type Usage = [products: number, staff: number, suppliers: number, ai: number, publish: number]

interface Seed {
  id: string
  name: string
  code: string
  owner: [name: string, email: string]
  country: Country
  plan: PlanId
  status: StoreStatus
  trialEnd?: string
  pastDueSince?: string
  reason?: string
  cancelledOn?: string
  created: string
  sales: number
  storefront?: StorefrontState
  domain: { host: string; custom: boolean; status?: 'waiting' }
  usage: Usage
}

const named: Seed[] = [
  { id: 'st-juniper', name: 'Juniper & Co.', code: 'juniper-co', owner: ['Anjali Nair', 'anjali@juniperco.com'], country: 'United States', plan: 'pro', status: 'active', created: '2025-12-01', sales: 18420, domain: { host: 'juniperco.com', custom: true }, usage: [2140, 6, 3, 212, 48] },
  { id: 'st-harbor', name: 'Harbor Coffee Co.', code: 'harbor-coffee', owner: ['Jenna Park', 'jenna@harborcoffee.co'], country: 'United States', plan: 'growth', status: 'trial', trialEnd: '2026-10-01', created: '2026-09-15', sales: 1240, domain: { host: 'harbor-coffee.shops.northstar.com', custom: false }, usage: [84, 2, 0, 41, 9] },
  { id: 'st-redline', name: 'Redline Moto Parts', code: 'redline-moto', owner: ['Dale Kowalski', 'dale@redlinemoto.com'], country: 'United States', plan: 'growth', status: 'suspended', reason: 'Chargebacks on 3 orders ($2,840).', created: '2025-11-02', sales: 0, domain: { host: 'redlinemoto.com', custom: true }, usage: [1320, 3, 1, 20, 4] },
  { id: 'st-maple', name: 'Maple & Pine', code: 'maple-pine', owner: ['Chloé Tremblay', 'chloe@mapleandpine.ca'], country: 'Canada', plan: 'growth', status: 'active', created: '2026-04-18', sales: 8760, domain: { host: 'shop.mapleandpine.ca', custom: true, status: 'waiting' }, usage: [640, 3, 1, 88, 22] },
  { id: 'st-tidewater', name: 'Tidewater Surf', code: 'tidewater-surf', owner: ['Marco Silva', 'marco@tidewatersurf.com'], country: 'United States', plan: 'starter', status: 'pastdue', pastDueSince: '2026-09-20', created: '2026-02-10', sales: 2310, domain: { host: 'tidewater-surf.shops.northstar.com', custom: false }, usage: [212, 2, 0, 12, 6] },
  { id: 'st-fieldnote', name: 'Fieldnote Paper', code: 'fieldnote-paper', owner: ['Hana Sato', 'hana@fieldnotepaper.com'], country: 'United States', plan: 'starter', status: 'trial', trialEnd: '2026-10-11', created: '2026-09-27', sales: 0, storefront: 'building', domain: { host: 'fieldnote-paper.shops.northstar.com', custom: false }, usage: [0, 1, 0, 3, 0] },
  { id: 'st-copperline', name: 'Copperline Audio', code: 'copperline-audio', owner: ['Owen Price', 'owen@copperline.audio'], country: 'United States', plan: 'pro', status: 'active', created: '2025-10-05', sales: 9800, storefront: 'own', domain: { host: 'copperline.audio', custom: true }, usage: [310, 4, 0, 0, 0] },
  { id: 'st-birch', name: 'Birch & Bramble', code: 'birch-bramble', owner: ['Leah Morgan', 'leah@birchandbramble.ca'], country: 'Canada', plan: 'starter', status: 'active', created: '2026-01-22', sales: 3120, domain: { host: 'birch-bramble.shops.northstar.com', custom: false }, usage: [481, 2, 0, 44, 17] },
  { id: 'st-prairie', name: 'Prairie Goods Co.', code: 'prairie-goods', owner: ['Tom Lindgren', 'tom@prairiegoods.ca'], country: 'Canada', plan: 'growth', status: 'active', created: '2026-03-09', sales: 4480, domain: { host: 'prairiegoods.ca', custom: true }, usage: [920, 3, 2, 60, 19] },
  { id: 'st-summit', name: 'Summit Supply', code: 'summit-supply', owner: ['Grace Liu', 'grace@summitsupply.com'], country: 'United States', plan: 'starter', status: 'cancelled', cancelledOn: '2026-09-02', created: '2025-12-19', sales: 0, domain: { host: 'summit-supply.shops.northstar.com', custom: false }, usage: [120, 1, 0, 0, 0] },
  { id: 'st-oakline', name: 'Oakline Home', code: 'oakline-home', owner: ['Priya Raman', 'priya@oaklinehome.com'], country: 'United States', plan: 'growth', status: 'active', created: '2025-09-30', sales: 7650, domain: { host: 'oaklinehome.com', custom: true }, usage: [4210, 5, 4, 190, 58] },
  { id: 'st-lumen', name: 'Lumen Candle Co.', code: 'lumen-candle', owner: ['Nora Fitz', 'nora@lumencandle.com'], country: 'United States', plan: 'growth', status: 'trial', trialEnd: '2026-10-04', created: '2026-09-20', sales: 420, domain: { host: 'lumen-candle.shops.northstar.com', custom: false }, usage: [36, 1, 0, 22, 5] },
  { id: 'st-bayside', name: 'Bayside Pets', code: 'bayside-pets', owner: ['Ethan Wells', 'ethan@baysidepets.com'], country: 'United States', plan: 'growth', status: 'pastdue', pastDueSince: '2026-09-26', created: '2026-05-14', sales: 3890, domain: { host: 'baysidepets.com', custom: true }, usage: [760, 2, 0, 31, 12] },
  { id: 'st-northfork', name: 'Northfork Outfitters', code: 'northfork', owner: ['Sam Becker', 'sam@northforkoutfitters.com'], country: 'United States', plan: 'pro', status: 'active', created: '2025-08-11', sales: 12900, domain: { host: 'northforkoutfitters.com', custom: true }, usage: [3380, 9, 6, 301, 71] },
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
  const planPool: PlanId[] = [...Array<PlanId>(27).fill('starter'), ...Array<PlanId>(37).fill('growth'), ...Array<PlanId>(8).fill('pro')]
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
    const limits = plans.find((candidate) => candidate.id === plan)?.limits ?? { products: 500, staff: 2, suppliers: 0, ai: 50, publish: 20 }
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
  const limits = plans.find((plan) => plan.id === seed.plan)?.limits
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
  plan: { id: seed.plan, name: plans.find((plan) => plan.id === seed.plan)?.name ?? seed.plan },
  near: nearOf(seed),
  state: stateOf(seed),
  salesLastMonth: seed.sales > 0 ? money(seed.sales * 100, seed.country) : null,
  storefront: seed.storefront ?? 'live',
  domain: { host: seed.domain.host, custom: seed.domain.custom, status: seed.domain.status ?? 'live' },
  createdAt: `${seed.created}T00:00:00Z`,
})

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

// `now` is the signup job's clock, the only thing here that moves.
export const createStoresServer = (seeds: readonly Seed[], now: () => number = Date.now) => {
  let stores = seeds.map(rowOf)
  const jobs = new Map<string, { startedAt: number }>()

  const list = (filter: StoreFilter, page: PageRequest, caller: PartnerRole): StorePage => {
    const all = stores.filter((row) => matches(row, filter)).sort(newestFirst)
    return {
      ...pageByCursor(all, page, storePageSize),
      plans: plans.map(({ id, name }) => ({ id, name })),
      actions: { create: canCreate(caller, 'live') },
    }
  }

  const search = (query: string): readonly StoreMatch[] => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return stores
      .filter((row) => `${row.name} ${row.code} ${row.domain.host} ${row.owner.email}`.toLowerCase().includes(q))
      .sort(newestFirst)
      .slice(0, searchMaxResults)
      .map((row) => ({ id: row.id, name: row.name, email: row.owner.email, host: row.domain.host, state: row.state }))
  }

  const form = (caller: PartnerRole, partnerState: PartnerState): CreateStoreForm => ({
    permission: canCreate(caller, partnerState),
    countries,
    plans: plans.map(({ id, name, price }) => ({ id, name, price: Object.fromEntries(Object.entries(price).map(([currency, amount]) => [currency, { amount, currency }])) })),
    trials,
    defaultTrial: 14,
    chargedBy: 'DripFunnel for Northstar',
  })

  const create = (input: CreateStoreInput, caller: PartnerRole, partnerState: PartnerState): CreateStoreResult => {
    const permission = canCreate(caller, partnerState)
    if (!permission.allowed) return { ok: false, reason: permission.reason }
    const valid = createStoreInput.parse(input)
    const plan = plans.find((candidate) => candidate.id === valid.planId)
    const country = countries.find((candidate) => candidate.name === valid.country)
    if (!plan || !country || !trials.includes(valid.trialDays)) throw new Error('Unknown plan, country or trial.')
    const code = valid.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const id = `st-${code}-${stores.length + 1}`
    const trialEnd = new Date(today + valid.trialDays * dayMs).toISOString().slice(0, 10)
    const seed: Seed = {
      id,
      name: valid.name,
      code,
      owner: [valid.ownerName, valid.ownerEmail],
      country: country.name,
      plan: plan.id,
      status: valid.trialDays === 0 ? 'active' : 'trial',
      trialEnd,
      created: new Date(today).toISOString().slice(0, 10),
      sales: 0,
      storefront: 'building',
      domain: { host: `${code}.shops.northstar.com`, custom: false },
      usage: [0, 1, 0, 0, 0],
    }
    stores = [rowOf(seed), ...stores]
    jobs.set(id, { startedAt: now() })
    return { ok: true, storeId: id }
  }

  const progress = (storeId: string): ProvisioningProgress => {
    const job = jobs.get(storeId)
    if (!job) throw new Error('No such signup job.')
    const elapsedMs = now() - job.startedAt
    const reached = Math.min(provisioningSteps.length - 1, Math.floor(elapsedMs / stepMs))
    const done = reached >= provisioningSteps.length - 1
    if (done) stores = stores.map((row) => (row.id === storeId ? { ...row, storefront: 'live' } : row))
    return {
      steps: provisioningSteps.map((key, index) => ({ key, state: index < reached || done ? 'done' : index === reached ? 'running' : 'waiting' })),
      done,
      elapsedSeconds: done ? Math.round(((provisioningSteps.length - 1) * stepMs) / 1000) : Math.floor(elapsedMs / 1000),
    }
  }

  return { list, search, form, create, progress }
}

export const sampleStores: readonly Seed[] = [...named, ...generated()]

export const storesServer = createStoresServer(sampleStores)

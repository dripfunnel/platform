// Thousands of seeded entries over the sample partners, stores and customers, served the way
// #38 would: filtered, newest first, paged by cursor, never counted. Goes with #68.
import { activityCsv } from '../features/common/activityCsv'
import type { StaffRole } from '../features/shell/staffRoles'
import type {
  ActivityEntry,
  ActivityExport,
  ActivityFilter,
  ActivityPage,
  ActivityPerson,
  ActorKind,
  PersonKind,
  PersonMatch,
} from './activity'
import { activityActions, type ActionCode } from './activityActions'
import { pageByCursor, type PageRequest } from '@dripfunnel/shared/graphql'
import { csvLink } from '@dripfunnel/shared/format'
import { sampleCustomers } from './customersSample'
import { sampleStores } from './storesSample'

interface SamplePerson extends ActivityPerson {
  staffRole?: StaffRole
}

const person = (id: string, name: string, email: string, kind: PersonKind, memberships: [string, string][], staffRole?: StaffRole): SamplePerson => ({
  id,
  name,
  email,
  kind,
  where: memberships[0]?.[0] ?? '',
  memberships: memberships.map(([where, role]) => ({ where, role })),
  sameEmailAccounts: 0,
  ...(staffRole ? { staffRole } : {}),
})

const staff = [
  person('st-arjun', 'Arjun Menon', 'arjun@dripfunnel.com', 'staff', [['DripFunnel', 'Super admin']], 'staff-super-admin'),
  person('st-priya', 'Priya Shah', 'priya.shah@dripfunnel.com', 'staff', [['DripFunnel', 'Partner manager']], 'staff-partner-manager'),
  person('st-maya', 'Maya Ortiz', 'maya.ortiz@dripfunnel.com', 'staff', [['DripFunnel', 'Partner manager']], 'staff-partner-manager'),
  person('st-neha', 'Neha Rao', 'neha@dripfunnel.com', 'staff', [['DripFunnel', 'Support']], 'staff-support'),
  person('st-lena', 'Lena Fischer', 'lena@dripfunnel.com', 'staff', [['DripFunnel', 'Engineer on call']], 'staff-engineer'),
  person('st-tom', 'Tom Becker', 'tom@dripfunnel.com', 'staff', [['DripFunnel', 'Finance']], 'staff-finance'),
]

const partnerUsers = [
  person('pu-mayachen', 'Maya Chen', 'maya@northstar.com', 'partner_user', [['Northstar Commerce', 'Owner']]),
  person('pu-diego', 'Diego Alvarez', 'diego@northstar.com', 'partner_user', [['Northstar Commerce', 'Admin']]),
  person('pu-vikram', 'Vikram Rao', 'vikram@bazaarcloud.in', 'partner_user', [['Bazaar Cloud', 'Owner']]),
  person('pu-sana', 'Sana Qureshi', 'sana@bazaarcloud.ae', 'partner_user', [['Bazaar Cloud', 'Admin']]),
  person('pu-jonas', 'Jonas Weber', 'jonas@kaufladen.de', 'partner_user', [['Kaufladen Digital', 'Owner']]),
  person('pu-olivia', 'Olivia Grant', 'olivia@loomandthread.co.uk', 'partner_user', [['Loom & Thread', 'Owner']]),
]

const storePeople = [
  ...sampleStores.map((store) => person(`pe-${store.id}`, store.owner.name, store.owner.email, 'person', [[`${store.name} · ${store.partner.name}`, 'Owner']])),
  person('pe-hannah', 'Hannah Cole', 'hannah@northwindwool.co.uk', 'person', [['Loom & Thread · Loom & Thread', 'Vendor (Northwind Wool)']]),
]

const shoppers = sampleCustomers.map((customer) => {
  const store = sampleStores.find((candidate) => candidate.id === customer.store)
  return person(`cu-${customer.id}`, customer.name ?? 'Deleted user', customer.email ?? '', 'customer', [[store ? `${store.name} · ${store.partner.name}` : '', 'Shopper']])
})

// Accounts are per partner (LOGGING.md §6), so one email can be several people.
const withSameEmail = (people: readonly SamplePerson[]): SamplePerson[] =>
  people.map((candidate) => ({
    ...candidate,
    sameEmailAccounts: candidate.email ? people.filter((other) => other.id !== candidate.id && other.email === candidate.email).length : 0,
  }))

export const samplePeople: readonly SamplePerson[] = withSameEmail([...staff, ...partnerUsers, ...storePeople, ...shoppers])

const byId = (id: string) => samplePeople.find((candidate) => candidate.id === id)

// Mulberry32: the same seed gives the same log on every load, so cursors stay meaningful.
const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

type Draft = Omit<ActivityEntry, 'id' | 'occurredAt' | 'level' | 'requestId' | 'ip' | 'userAgent'>

const agents = ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) Chrome/129.0', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/131.0', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604.1']

const actorOf = (who: SamplePerson): ActivityEntry['actor'] => ({
  kind: who.kind as ActorKind,
  id: who.id,
  label: who.name,
})

const scopeOf = (storeId: string) => {
  const store = sampleStores.find((candidate) => candidate.id === storeId) ?? sampleStores[0]
  if (!store) throw new Error('No sample stores.')
  return { store: { id: store.id, name: store.name }, partner: store.partner }
}

const base = (action: ActionCode, actor: ActivityEntry['actor']): Draft => ({
  action,
  result: 'success',
  actor,
  onBehalfOf: null,
  access: null,
  partner: null,
  store: null,
  target: null,
  changes: [],
  reason: null,
})

const pick = <Item,>(next: () => number, items: readonly Item[]): Item => {
  const item = items[Math.floor(next() * items.length)]
  if (item === undefined) throw new Error('Nothing to pick from.')
  return item
}

const products = ['Silk scarf', 'Handloom saree', 'Cold brew kit', 'Trail jacket', 'Linen throw', 'Ceramic mug']
const plans = ['Launch', 'Scale', 'Pro', 'Growth', 'Starter']
const reasons = ['Chargeback', 'Merchant asked for more time', 'Fraud check', 'Ticket #4821', 'Contract under review']

// One random entry; the weights keep merchant and shopper activity commonest, as in production.
const randomDraft = (next: () => number): Draft => {
  const staffer = pick(next, staff)
  const storeId = pick(next, sampleStores).id
  const scope = scopeOf(storeId)
  const owner = byId(`pe-${storeId}`) ?? staffer
  const customer = pick(next, sampleCustomers.filter((candidate) => candidate.status !== 'deleted'))
  const shopper = byId(`cu-${customer.id}`) ?? staffer
  const shopperScope = scopeOf(customer.store)
  const partnerUser = pick(next, partnerUsers)
  const roll = next()
  if (roll < 0.18) return next() < 0.9 ? { ...base('customer.signed_in', actorOf(shopper)), ...shopperScope } : { ...base('customer.sign_in_failed', actorOf(shopper)), ...shopperScope, result: 'failed' }
  if (roll < 0.26) return { ...base('customer.order_placed', actorOf(shopper)), ...shopperScope, target: { type: 'order', id: `o${Math.floor(next() * 9000) + 1000}`, label: `#${Math.floor(next() * 9000) + 1000}` } }
  if (roll < 0.29) return { ...base(pick(next, ['customer.address_changed', 'customer.password_reset'] as const), actorOf(shopper)), ...shopperScope }
  if (roll < 0.42) return { ...base('person.signed_in', actorOf(owner)), ...scope }
  if (roll < 0.55) {
    const price = Math.floor(next() * 80) + 10
    return {
      ...base('product.updated', actorOf(owner)),
      ...scope,
      target: { type: 'product', id: `p${Math.floor(next() * 500)}`, label: pick(next, products) },
      changes: [{ field: 'Price', before: `$${price}.00`, after: `$${price + 5}.00`, redacted: false }],
    }
  }
  if (roll < 0.6) return { ...base('stock.updated', actorOf(owner)), ...scope }
  if (roll < 0.63) return { ...base('storefront.published', actorOf(owner)), ...scope, target: { type: 'domain', id: `v${Math.floor(next() * 60)}`, label: `version ${Math.floor(next() * 60) + 1}` } }
  if (roll < 0.65) return { ...base('order.refunded', actorOf(owner)), ...scope, target: { type: 'order', id: `o${Math.floor(next() * 9000)}`, label: `#${Math.floor(next() * 9000) + 1000}` }, reason: 'Damaged in transit' }
  if (roll < 0.7) return next() < 0.94 ? base('staff.signed_in', actorOf(staffer)) : { ...base('staff.sign_in_failed', actorOf(staffer)), result: 'failed' }
  if (roll < 0.72) return { ...base('customer.viewed', actorOf(staffer)), ...shopperScope, target: { type: 'customer', id: customer.id, label: customer.name ?? 'Deleted user' } }
  if (roll < 0.76) return { ...base('partner_user.signed_in', actorOf(partnerUser)), partner: { id: partnerIdOf(partnerUser), name: partnerUser.memberships[0]?.where ?? '' } }
  if (roll < 0.78) {
    const plan = pick(next, plans)
    return {
      ...base('plan.price_changed', actorOf(partnerUser)),
      partner: { id: partnerIdOf(partnerUser), name: partnerUser.memberships[0]?.where ?? '' },
      target: { type: 'plan', id: plan.toLowerCase(), label: plan },
      changes: [{ field: 'Monthly price', before: '$29.00', after: '$39.00', redacted: false }],
    }
  }
  if (roll < 0.8) {
    const extended = next() < 0.85
    return {
      ...base('store.trial_extended', actorOf(extended ? pick(next, [staff[0], staff[1], staff[3]].filter(isPerson)) : staffer)),
      ...scope,
      target: { type: 'store', id: scope.store.id, label: scope.store.name },
      result: extended ? 'success' : 'denied',
      changes: extended ? [{ field: 'Trial ends', before: 'Oct 3, 2026', after: 'Oct 17, 2026', redacted: false }] : [],
      reason: extended ? pick(next, reasons) : null,
    }
  }
  if (roll < 0.82) return { ...base('products.created', { kind: 'api_key', id: 'key-ns-prod', label: 'Northstar production key' }), ...scopeOf('s2') }
  if (roll < 0.84) return { ...base('billing.payment_failed', { kind: 'provider', id: null, label: 'Stripe' }), ...scope, result: 'failed', reason: 'Card declined' }
  if (roll < 0.86) return { ...base('security.sign_in_blocked', { kind: 'anonymous', id: null, label: 'Unknown' }), ...scope, result: 'denied' }
  if (roll < 0.87) {
    const elsewhere = scopeOf(pick(next, sampleStores.filter((store) => store.partner.id !== partnerIdOf(partnerUser))).id)
    return { ...base('security.tenant_crossing', actorOf(partnerUser)), ...elsewhere, target: { type: 'store', id: elsewhere.store.id, label: elsewhere.store.name }, result: 'denied' }
  }
  if (roll < 0.9) return { ...base('staff.signed_out', actorOf(staffer)) }
  if (roll < 0.92) return { ...base('branding.updated', actorOf(partnerUser)), partner: { id: partnerIdOf(partnerUser), name: partnerUser.memberships[0]?.where ?? '' }, changes: [{ field: 'Primary colour', before: '#1B3A5B', after: '#2BB673', redacted: false }] }
  if (roll < 0.94) return { ...base('stock.updated', actorOf(byId('pe-hannah') ?? owner)), ...scopeOf('s8') }
  if (roll < 0.96) return { ...base('customer.signed_up', actorOf(shopper)), ...shopperScope }
  if (roll < 0.98) {
    // A partner supports only its own merchants (USERS-AND-DOMAINS.md §4).
    const agent = partnerUsers.find((candidate) => partnerIdOf(candidate) === scope.partner.id)
    if (!agent) return { ...base('stock.updated', actorOf(owner)), ...scope }
    const session = `ss-${Math.floor(next() * 900) + 100}`
    return { ...base('support_session.started', { kind: 'support_session', id: session, label: agent.name }), ...scope, onBehalfOf: { id: agent.id, label: agent.name }, access: { kind: 'supportSession', id: session }, target: { type: 'store', id: scope.store.id, label: scope.store.name }, reason: pick(next, reasons) }
  }
  return { ...base('api_key.created', actorOf(owner)), ...scope, target: { type: 'api_key', id: 'key', label: 'Warehouse sync' }, changes: [{ field: 'Secret', before: null, after: null, redacted: true }] }
}

function isPerson(candidate: SamplePerson | undefined): candidate is SamplePerson {
  return candidate !== undefined
}

function partnerIdOf(who: SamplePerson) {
  return { 'pu-mayachen': 'ns', 'pu-diego': 'ns', 'pu-vikram': 'bz', 'pu-sana': 'bz', 'pu-jonas': 'kl', 'pu-olivia': 'lt' }[who.id] ?? 'ns'
}

const actorById = (id: string) => {
  const found = byId(id)
  if (!found) throw new Error(`No sample person ${id}.`)
  return actorOf(found)
}

// The prototype's stories, so an impersonation, a setup session and a refusal can be followed.
const curated = (): [Draft, number][] => {
  const mehta = scopeOf('s1')
  const kl = { partner: { id: 'kl', name: 'Kaufladen Digital' } }
  const imp = { kind: 'impersonation' as const, id: 'imp-7Q2' }
  const asPriya = { onBehalfOf: { id: 'st-neha', label: 'Neha Rao' }, access: imp }
  const su = { kind: 'setupSession' as const, id: 'su-4K9' }
  return [
    [{ ...base('impersonation.started', actorById('st-neha')), ...mehta, access: imp, target: { type: 'staff', id: 'pe-s1', label: 'Priya Mehta' }, reason: 'Ticket #4821: Diwali collection missing' }, 7],
    [{ ...base('product.updated', actorById('pe-s1')), ...mehta, ...asPriya, target: { type: 'product', id: 'p-diwali', label: 'Diwali collection' }, changes: [{ field: 'Visible', before: 'No', after: 'Yes', redacted: false }] }, 5],
    [{ ...base('storefront.published', actorById('pe-s1')), ...mehta, ...asPriya, target: { type: 'domain', id: 'v48', label: 'version 48' } }, 4],
    [{ ...base('impersonation.ended', actorById('st-neha')), ...mehta, access: imp, target: { type: 'staff', id: 'pe-s1', label: 'Priya Mehta' } }, 2],
    [{ ...base('setup_session.started', actorById('st-priya')), ...kl, access: su, target: { type: 'partner', id: 'kl', label: 'Kaufladen Digital' }, reason: 'Partner asked for help with branding' }, 60 * 30],
    [{ ...base('branding.updated', actorById('st-priya')), ...kl, access: su, changes: [{ field: 'Primary colour', before: '#000000', after: '#2A2F8F', redacted: false }] }, 60 * 30 - 10],
    [{ ...base('plan.created', actorById('st-priya')), ...kl, access: su, target: { type: 'plan', id: 'kl-plus', label: 'Plus' } }, 60 * 30 - 20],
    [{ ...base('setup_session.ended', actorById('st-priya')), ...kl, access: su, target: { type: 'partner', id: 'kl', label: 'Kaufladen Digital' } }, 60 * 30 - 25],
    [{ ...base('partner.submitted', actorById('pu-jonas')), ...kl }, 60 * 24 * 4],
    [{ ...base('store.suspended', actorById('st-arjun')), ...scopeOf('s4'), target: { type: 'store', id: 's4', label: 'Redline Moto Parts' }, reason: 'Chargeback' }, 60 * 26],
    [{ ...base('provisioning.step_failed', { kind: 'job', id: 'job-s13', label: 'Provisioning' }), ...scopeOf('s13'), target: { type: 'store', id: 's13', label: 'Peak Supply Co.' }, result: 'failed', reason: 'GitHub didn’t respond' }, 95],
    [{ ...base('job.retried', actorById('st-lena')), ...scopeOf('s5'), target: { type: 'job', id: 'job-s5', label: 'First build' } }, 43],
    [{ ...base('security.authorization_denied', actorById('st-tom')), ...scopeOf('s2'), target: { type: 'store', id: 's2', label: 'Harbor Coffee Co.' }, result: 'denied' }, 50],
    [{ ...base('staff.role_changed', actorById('st-arjun')), target: { type: 'staff', id: 'st-maya', label: 'Maya Ortiz' }, changes: [{ field: 'Role', before: 'Support', after: 'Partner manager', redacted: false }] }, 60 * 24 * 3],
    [{ ...base('partner.created', actorById('st-maya')), ...kl, target: { type: 'partner', id: 'kl', label: 'Kaufladen Digital' } }, 60 * 24 * 23],
  ]
}

const sampleSize = 3000
const days = 60

const hex = (next: () => number) => Math.floor(next() * 0xffffffff).toString(16).padStart(8, '0')

const authLike = (action: ActionCode) => ['auth', 'security'].includes(activityActions[action].category)

export const generateActivity = (now: number, size = sampleSize): ActivityEntry[] => {
  const next = random(44)
  const drafts: [Draft, number][] = [...curated(), ...Array.from({ length: size }, (): [Draft, number] => [randomDraft(next), Math.floor(next() * days * 24 * 60)])]
  return drafts
    .map(([draft, minutesAgo]) => ({ draft, at: now - minutesAgo * 60_000 - Math.floor(next() * 59_000) }))
    .sort((a, b) => b.at - a.at)
    .map(({ draft, at }, index) => ({
      ...draft,
      id: `e${String(index + 1).padStart(5, '0')}`,
      occurredAt: new Date(at).toISOString(),
      level: activityActions[draft.action].level,
      requestId: `req_${hex(next)}${hex(next)}`,
      ip: authLike(draft.action) ? `103.21.${Math.floor(next() * 255)}.${Math.floor(next() * 255)}` : null,
      userAgent: authLike(draft.action) ? pick(next, agents) : null,
    }))
}

const dayMs = 86_400_000
const startOfDay = (time: number) => time - (time % dayMs)

const windowOf = (filter: ActivityFilter, now: number): [number, number] => {
  if (filter.from || filter.to) return [filter.from ? Date.parse(`${filter.from}T00:00:00Z`) : 0, filter.to ? Date.parse(`${filter.to}T00:00:00Z`) + dayMs : Infinity]
  switch (filter.date) {
    case 'today':
      return [startOfDay(now), Infinity]
    case '7d':
      return [startOfDay(now) - 6 * dayMs, Infinity]
    case '30d':
      return [startOfDay(now) - 29 * dayMs, Infinity]
    default:
      return [0, Infinity]
  }
}

const customerOf = (entry: ActivityEntry) => (entry.actor.kind === 'customer' ? entry.actor.id?.replace(/^cu-/, '') : entry.target && entry.target.type === 'customer' ? entry.target.id : undefined)

const matches = (entry: ActivityEntry, filter: ActivityFilter, [from, to]: [number, number]) => {
  const at = Date.parse(entry.occurredAt)
  const [targetType, targetId] = filter.target?.split(':') ?? []
  return (
    (!filter.person || entry.actor.id === filter.person || entry.onBehalfOf?.id === filter.person) &&
    (!filter.actor || entry.actor.kind === filter.actor) &&
    (!filter.level || entry.level === filter.level) &&
    (!filter.action || entry.action === filter.action) &&
    (!filter.result || entry.result === filter.result) &&
    (!filter.partner || entry.partner?.id === filter.partner) &&
    (!filter.store || entry.store?.id === filter.store) &&
    // A customer's tab is their own account events, not staff opening their page (LOGGING.md §3).
    (!filter.customer || (customerOf(entry) === filter.customer && entry.level === 'storefront')) &&
    (!filter.target || (entry.target !== null && entry.target.type === targetType && entry.target.id === targetId)) &&
    (!filter.ip || (entry.ip ?? '').startsWith(filter.ip)) &&
    (!filter.imp || (entry.access?.kind === 'impersonation' && entry.access.id === filter.imp)) &&
    (!filter.su || (entry.access?.kind === 'setupSession' && entry.access.id === filter.su)) &&
    at >= from &&
    at < to
  )
}

const exporters: readonly StaffRole[] = ['staff-super-admin', 'staff-engineer']

interface SampleExport extends ActivityExport {
  expiresAtMs: number | null
}

export interface ActivityServerOptions {
  now?: () => number
  wait?: (ms: number, then: () => void) => void
  cap?: number
  link?: (csv: string) => string
}

const prepareMs = 3000

export const createActivityServer = (seed: readonly ActivityEntry[], options: ActivityServerOptions = {}) => {
  const now = options.now ?? Date.now
  const wait = options.wait ?? ((ms, then) => void setTimeout(then, ms))
  const cap = options.cap ?? 100_000
  const link = options.link ?? csvLink
  let entries = [...seed]
  const exports = new Map<string, SampleExport>()

  const matching = (filter: ActivityFilter) => {
    const window = windowOf(filter, now())
    return entries.filter((entry) => matches(entry, filter, window))
  }

  const list = (filter: ActivityFilter, page: PageRequest, size: number, caller: StaffRole): ActivityPage => {
    const { items, pageInfo } = pageByCursor(matching(filter), page, size)
    return {
      items,
      pageInfo,
      export: exporters.includes(caller) ? { allowed: true } : { allowed: false, reason: 'EXPORTERS_ONLY' },
      partners: [...new Map(sampleStores.map((store) => [store.partner.id, store.partner])).values()],
      stores: sampleStores.map((store) => ({ id: store.id, name: store.name, partnerId: store.partner.id })),
    }
  }

  const people = (query: string, max: number): PersonMatch[] => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    return samplePeople
      .filter((candidate) => candidate.name.toLowerCase().includes(q) || candidate.email.toLowerCase().includes(q))
      .slice(0, max)
      .map(({ id, name, email, kind, where }) => ({ id, name, email, kind, where }))
  }

  const personOf = (id: string): ActivityPerson | null => {
    const found = byId(id)
    if (!found) return null
    return { id: found.id, name: found.name, email: found.email, kind: found.kind, where: found.where, memberships: found.memberships, sameEmailAccounts: found.sameEmailAccounts }
  }

  // The export is itself an entry (LOGGING.md §6), written as the job starts.
  const startExport = (filter: ActivityFilter, caller: StaffRole): ActivityExport => {
    if (!exporters.includes(caller)) throw new Error('Only a Super admin or the Engineer on call can export.')
    const rows = matching(filter)
    const id = `x${exports.size + 1}`
    const job: SampleExport = { id, state: 'preparing', entries: null, url: null, expiresAt: null, expiresAtMs: null }
    exports.set(id, job)
    const exporter = staff.find((candidate) => candidate.staffRole === caller)
    if (exporter) {
      entries = [exportEntry(now(), exporter, id), ...entries]
    }
    wait(prepareMs, () => {
      if (rows.length > cap) {
        exports.set(id, { ...job, state: 'tooLarge', entries: rows.length })
        return
      }
      const expiresAtMs = now() + 60 * 60_000
      exports.set(id, { ...job, state: 'ready', entries: rows.length, url: link(activityCsv(rows)), expiresAt: new Date(expiresAtMs).toISOString(), expiresAtMs })
    })
    return job
  }

  const exportJob = (id: string): ActivityExport | null => {
    const job = exports.get(id)
    if (!job) return null
    if (job.state === 'ready' && job.expiresAtMs !== null && now() >= job.expiresAtMs) {
      const expired: SampleExport = { ...job, state: 'expired', url: null }
      exports.set(id, expired)
      return expired
    }
    return job
  }

  return { list, people, person: personOf, startExport, exportJob }
}

const exportEntry = (at: number, exporter: SamplePerson, exportId: string): ActivityEntry => ({
  ...base('activity.exported', actorOf(exporter)),
  id: `e-${exportId}-${at}`,
  occurredAt: new Date(at).toISOString(),
  level: 'admin',
  target: { type: 'export', id: exportId, label: exportId },
  requestId: `req_${exportId}${at.toString(16)}`,
  ip: null,
  userAgent: null,
})

export const activityServer = createActivityServer(generateActivity(Date.now()))


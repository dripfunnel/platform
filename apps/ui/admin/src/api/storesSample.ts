// The prototype's sample stores (designs/admin-data.js) as the Admin API serves them: the
// screen tests' fixture and the seed of the provisioning sample (#37).
import type { StaffRole } from '../features/shell/staffRoles'
import { jobPermissionsFor, stateOf, stepsFor, type SampleSetup } from './jobSample'
import type { ActionPermission } from './permissions'
import { pageByCursor, type PageRequest } from '@dripfunnel/shared/graphql'
import { samplePartners } from './partnersSample'
import { impersonatePermission } from './sessionRules'
import { storeNoteMaxLength } from './stores'
import type {
  Store,
  StoreAction,
  StoreDnsRecord,
  StoreFilter,
  StoreHistoryEntry,
  StorePage,
  StorePermission,
  StorePermissions,
  StoreRefusal,
  StoreRow,
  StoreState,
  StoreUser,
} from './stores'

// A suspended store remembers the whole state it had, so Restore can put it back exactly. Its
// signup is the Workflow's own record, which the provisioning sample runs (#43).
export type SampleStore = Omit<Store, 'actions' | 'impersonate' | 'job' | 'setup'> & { setup: SampleSetup; before: StoreState | null }

const partnerNames: Record<string, string> = {
  df: 'DripFunnel',
  ns: 'Northstar Commerce',
  bz: 'Bazaar Cloud',
  kl: 'Kaufladen Digital',
  lt: 'Loom & Thread',
}

const shopsDomain: Record<string, string> = {
  df: 'dripfunnel.com',
  ns: 'northstar.com',
  bz: 'bazaarcloud.in',
  kl: 'kaufladen.de',
  lt: 'loomandthread.co.uk',
}

const edge = 'shops.edge.dripfunnel.net'

type Event = [at: string, action: string, by?: string | null, note?: string | null]
type Person = [name: string, email: string, role: StoreUser['role'], status: StoreUser['status'], lastSignInAt: string | null, supplier?: string]

interface Seed {
  id: string
  name: string
  code: string
  partner: string
  owner: [string, string]
  country: string
  plan: string
  state: StoreState
  created: string
  storefront?: StoreRow['storefront']
  domain?: { host: string; custom: boolean; status?: StoreDnsRecord['status'] }
  setup?: Pick<SampleSetup, 'step' | 'attempts' | 'startedAt' | 'stepMinutes'> &
    Partial<Pick<SampleSetup, 'details' | 'failsAgain'>> & { state: 'running' | 'failed' }
  error?: string
  people: [owners: number, managers: number, staff: number, suppliers: number]
  version?: string
  built?: [build: string, publish: string] | null
  history: Event[]
  users: Person[]
  supportAccess?: boolean
  notes?: Store['notes']
}

const recordsFor = (host: string, custom: boolean, status: StoreDnsRecord['status'], code: string): StoreDnsRecord[] => {
  const found = (value: string) => (status === 'waiting' ? null : value)
  if (!custom) return [{ kind: 'shopAddress', host, record: null, expected: null, found: status === 'live' ? host : null, status }]
  return [
    { kind: 'custom', host, record: 'CNAME', expected: edge, found: found(edge), status },
    { kind: 'ownership', host: `_df-verify.${host}`, record: 'TXT', expected: `df-verify=${code}`, found: found(`df-verify=${code}`), status },
  ]
}

const setupOf = (seed: Seed): SampleSetup => {
  const steps = stepsFor(seed.storefront === 'own')
  const done = { jobId: null, state: 'done', step: steps.at(-1) ?? 'done', attempts: 1, startedAt: null, stepMinutes: 0 } as const
  return { details: null, failsAgain: false, steps, ...(seed.setup ? { ...seed.setup, jobId: `job-${seed.id}` } : done) }
}

const sample = (seed: Seed): SampleStore => {
  const shops = shopsDomain[seed.partner] ?? 'dripfunnel.com'
  const host = seed.domain?.host ?? `${seed.code}.shops.${shops}`
  const custom = seed.domain?.custom ?? false
  const status = seed.domain?.status ?? 'live'
  const built = seed.built === undefined ? (['2026-09-26T11:20:00Z', '2026-09-26T11:32:00Z'] as const) : seed.built
  return {
    id: seed.id,
    name: seed.name,
    code: seed.code,
    partner: { id: seed.partner, name: partnerNames[seed.partner] ?? seed.partner },
    owner: { name: seed.owner[0], email: seed.owner[1] },
    plan: { name: seed.plan },
    state: seed.state,
    storefront: seed.storefront ?? 'live',
    domain: { host, custom, status },
    setup: setupOf(seed),
    createdAt: `${seed.created}T00:00:00Z`,
    country: seed.country,
    history: seed.history.map(([at, action, by = null, note = null]) => ({ at: `${at}T00:00:00Z`, action, by, note })),
    counts: { owners: seed.people[0], managers: seed.people[1], staff: seed.people[2], suppliers: seed.people[3] },
    site: {
      version: seed.version ?? null,
      lastBuildAt: built?.[0] ?? null,
      lastPublishAt: built?.[1] ?? null,
      previewHost: `${seed.code}.preview.${shops}`,
    },
    provisioning: { error: seed.error ?? null },
    records: recordsFor(host, custom, status, seed.code),
    users: seed.users.map(([name, email, role, userStatus, lastSignInAt, supplier], index) => ({
      id: `${seed.id}-u${index + 1}`,
      name,
      email,
      role,
      supplier: supplier ?? null,
      status: userStatus,
      lastSignInAt,
    })),
    supportAccess: seed.supportAccess ?? true,
    notes: seed.notes ?? [],
    before: null,
  }
}

// The prototype's clock stands still on 28 Sep 2026, so its trials count down from there.
const trial = (trialEndsAt: string, daysLeft: number): StoreState => ({ kind: 'trial', trialEndsAt: `${trialEndsAt}T00:00:00Z`, daysLeft })
const active: StoreState = { kind: 'active' }

export const sampleStores: readonly SampleStore[] = [
  sample({
    id: 's1',
    name: 'Mehta Textiles',
    code: 'mehta-textiles',
    partner: 'bz',
    owner: ['Priya Mehta', 'priya@mehtatextiles.in'],
    country: 'IN',
    plan: 'Growth',
    state: active,
    created: '2025-06-11',
    domain: { host: 'mehtatextiles.in', custom: true },
    people: [1, 2, 6, 3],
    version: 'v48',
    built: ['2026-09-28T09:12:00Z', '2026-09-28T09:20:00Z'],
    history: [
      ['2025-06-11', 'store.trial_started'],
      ['2025-06-21', 'store.activated'],
    ],
    users: [
      ['Priya Mehta', 'priya@mehtatextiles.in', 'owner', 'active', '2026-09-28T08:52:00Z'],
      ['Rohan Verma', 'rohan@mehtatextiles.in', 'manager', 'active', '2026-09-28T10:30:00Z'],
      ['Dev Patel', 'dev@mehtatextiles.in', 'staff', 'active', '2026-09-27T16:44:00Z'],
      ['Aisha Khan', 'aisha@mehtatextiles.in', 'staff', 'invited', null],
      ['Lakshmi Iyer', 'lakshmi@kaveriweaves.in', 'supplierAdmin', 'active', '2026-09-26T10:05:00Z', 'Kaveri Weaves'],
    ],
  }),
  sample({
    id: 's2',
    name: 'Harbor Coffee Co.',
    code: 'harbor-coffee',
    partner: 'ns',
    owner: ['Jenna Park', 'jenna@harborcoffee.co'],
    country: 'US',
    plan: 'Scale',
    state: trial('2026-09-29', 1),
    created: '2026-09-15',
    people: [1, 0, 1, 0],
    version: 'v6',
    history: [['2026-09-15', 'store.trial_started']],
    users: [['Jenna Park', 'jenna@harborcoffee.co', 'owner', 'active', '2026-09-28T09:10:00Z']],
  }),
  sample({
    id: 's3',
    name: 'Kiko Kids',
    code: 'kiko-kids',
    partner: 'bz',
    owner: ['Fatima Al Nuaimi', 'fatima@kikokids.ae'],
    country: 'AE',
    plan: 'Growth UAE',
    state: { kind: 'pastdue', daysPastDue: 9 },
    created: '2025-11-02',
    domain: { host: 'kikokids.ae', custom: true },
    people: [1, 1, 3, 0],
    version: 'v21',
    history: [
      ['2025-11-02', 'store.trial_started'],
      ['2025-11-12', 'store.activated'],
      ['2026-09-19', 'store.past_due', null, '3 failed payments'],
    ],
    users: [['Fatima Al Nuaimi', 'fatima@kikokids.ae', 'owner', 'active', '2026-09-28T10:21:00Z']],
    notes: [{ id: 's3-n1', by: 'Priya Shah', at: '2026-09-28T10:52:00Z', text: 'Merchant says the card was replaced. Walking her to Billing → Card in the session.' }],
  }),
  sample({
    id: 's4',
    name: 'Redline Moto Parts',
    code: 'redline-moto',
    partner: 'ns',
    owner: ['Dale Kowalski', 'dale@redlinemoto.com'],
    country: 'US',
    plan: 'Pro',
    state: { kind: 'suspended', reason: 'Chargeback', by: 'Arjun Menon', since: '2026-09-24T00:00:00Z', previous: 'active' },
    created: '2025-08-19',
    people: [1, 1, 2, 0],
    version: 'v33',
    history: [
      ['2025-08-19', 'store.trial_started'],
      ['2025-08-29', 'store.activated'],
      ['2026-09-24', 'store.suspended', 'Arjun Menon', 'chargeback'],
    ],
    users: [
      ['Dale Kowalski', 'dale@redlinemoto.com', 'owner', 'active', '2026-09-24T18:00:00Z'],
      ['Ben Ortiz', 'ben@redlinemoto.com', 'staff', 'suspended', '2026-09-20T12:00:00Z'],
    ],
    notes: [{ id: 's4-n1', by: 'Arjun Menon', at: '2026-09-24T14:12:00Z', text: 'Card network notice CB-2291. Waiting for the merchant’s evidence before we restore.' }],
  }),
  sample({
    id: 's5',
    name: 'Fjord Outdoor',
    code: 'fjord-outdoor',
    partner: 'df',
    owner: ['Ingrid Solberg', 'ingrid@fjordoutdoor.no'],
    country: 'NO',
    plan: 'Growth',
    state: trial('2026-10-08', 10),
    created: '2026-09-28',
    storefront: 'building',
    setup: {
      state: 'running',
      step: 'firstBuild',
      attempts: 2,
      startedAt: '2026-09-28T10:04:00Z',
      stepMinutes: 48,
      details: 'build bld_7Qx2 state=running runner=eu-2 last_heartbeat=10:39:12Z last_log="Installing theme dependencies"',
    },
    error: 'The first storefront build has been running for 48 minutes. It usually takes under 5.',
    people: [1, 0, 0, 0],
    built: null,
    history: [['2026-09-28', 'store.trial_started']],
    users: [['Ingrid Solberg', 'ingrid@fjordoutdoor.no', 'owner', 'active', '2026-09-28T10:00:00Z']],
  }),
  sample({
    id: 's6',
    name: 'Maple & Pine Home',
    code: 'maple-pine',
    partner: 'ns',
    owner: ['Chloé Tremblay', 'chloe@mapleandpine.ca'],
    country: 'CA',
    plan: 'Scale',
    state: active,
    created: '2026-04-03',
    domain: { host: 'shop.mapleandpine.ca', custom: true, status: 'waiting' },
    people: [1, 1, 1, 0],
    version: 'v17',
    history: [
      ['2026-04-03', 'store.trial_started'],
      ['2026-04-13', 'store.activated'],
    ],
    users: [['Chloé Tremblay', 'chloe@mapleandpine.ca', 'owner', 'active', '2026-09-27T22:10:00Z']],
  }),
  sample({
    id: 's7',
    name: 'Atelier Nove',
    code: 'atelier-nove',
    partner: 'df',
    owner: ['Giulia Conti', 'giulia@ateliernove.it'],
    country: 'IT',
    plan: 'Growth Pro',
    state: active,
    created: '2025-12-09',
    storefront: 'own',
    domain: { host: 'ateliernove.it', custom: true },
    people: [1, 0, 2, 0],
    built: null,
    supportAccess: false,
    history: [
      ['2025-12-09', 'store.trial_started'],
      ['2025-12-19', 'store.activated'],
    ],
    users: [['Giulia Conti', 'giulia@ateliernove.it', 'owner', 'active', '2026-09-28T06:40:00Z']],
  }),
  sample({
    id: 's8',
    name: 'Loom & Thread',
    code: 'loom-thread',
    partner: 'lt',
    owner: ['Olivia Grant', 'olivia@loomandthread.co.uk'],
    country: 'GB',
    plan: 'Marketplace',
    state: active,
    created: '2025-10-01',
    domain: { host: 'loomandthread.co.uk', custom: true },
    people: [1, 4, 22, 64],
    version: 'v112',
    history: [['2025-10-01', 'store.activated']],
    users: [
      ['Olivia Grant', 'olivia@loomandthread.co.uk', 'owner', 'active', '2026-09-27T19:30:00Z'],
      ['Hannah Cole', 'hannah@northwindwool.co.uk', 'supplierAdmin', 'active', '2026-09-28T09:31:00Z', 'Northwind Wool'],
    ],
  }),
  sample({
    id: 's9',
    name: 'Saffron Street',
    code: 'saffron-street',
    partner: 'bz',
    owner: ['Kavya Iyer', 'kavya@saffronstreet.in'],
    country: 'IN',
    plan: 'Starter',
    state: active,
    created: '2026-09-23',
    people: [1, 0, 1, 0],
    version: 'v3',
    history: [['2026-09-23', 'store.activated']],
    users: [['Kavya Iyer', 'kavya@saffronstreet.in', 'owner', 'active', '2026-09-27T18:30:00Z']],
  }),
  sample({
    id: 's10',
    name: 'Brightside Pets',
    code: 'brightside-pets',
    partner: 'df',
    owner: ['Tanya Brooks', 'tanya@brightsidepets.com'],
    country: 'US',
    plan: 'Growth',
    state: { kind: 'cancelled', since: '2026-09-02T00:00:00Z' },
    created: '2025-05-20',
    people: [1, 0, 0, 0],
    version: 'v9',
    history: [
      ['2025-05-20', 'store.trial_started'],
      ['2025-05-30', 'store.activated'],
      ['2026-09-02', 'store.cancelled'],
    ],
    users: [['Tanya Brooks', 'tanya@brightsidepets.com', 'owner', 'active', '2026-09-02T12:44:00Z']],
  }),
  sample({
    id: 's11',
    name: 'Oud House',
    code: 'oud-house',
    partner: 'bz',
    owner: ['Khalid Rahman', 'khalid@oudhouse.ae'],
    country: 'AE',
    plan: 'Pro UAE',
    state: active,
    created: '2026-02-14',
    domain: { host: 'oudhouse.ae', custom: true },
    people: [1, 1, 4, 0],
    version: 'v27',
    history: [
      ['2026-02-14', 'store.trial_started'],
      ['2026-02-24', 'store.activated'],
    ],
    users: [['Khalid Rahman', 'khalid@oudhouse.ae', 'owner', 'active', '2026-09-28T04:15:00Z']],
  }),
  sample({
    id: 's12',
    name: 'Grünwerk',
    code: 'gruenwerk',
    partner: 'kl',
    owner: ['Lea Braun', 'lea@gruenwerk.de'],
    country: 'DE',
    plan: 'Plus',
    state: trial('2026-10-06', 8),
    created: '2026-09-26',
    people: [1, 0, 0, 0],
    version: 'v2',
    history: [['2026-09-26', 'store.trial_started']],
    users: [['Lea Braun', 'lea@gruenwerk.de', 'owner', 'active', '2026-09-27T20:05:00Z']],
  }),
  sample({
    id: 's13',
    name: 'Peak Supply Co.',
    code: 'peak-supply',
    partner: 'df',
    owner: ['Owen Hart', 'owen@peaksupply.com'],
    country: 'US',
    plan: 'Growth',
    state: trial('2026-10-08', 10),
    created: '2026-09-28',
    storefront: 'failed',
    setup: {
      state: 'failed',
      step: 'repo',
      attempts: 2,
      startedAt: '2026-09-28T09:12:00Z',
      stepMinutes: 0,
      details: 'POST https://api.github.com/orgs/df-shops/repos → 502 Bad Gateway after 30s (request 9C1E:4A2B:1F0E)',
      failsAgain: true,
    },
    error: 'GitHub didn’t respond while creating the storefront.',
    people: [1, 0, 0, 0],
    built: null,
    history: [['2026-09-28', 'store.trial_started']],
    users: [['Owen Hart', 'owen@peaksupply.com', 'owner', 'active', '2026-09-28T09:12:00Z']],
  }),
  sample({
    id: 's14',
    name: 'Tidewater Surf',
    code: 'tidewater-surf',
    partner: 'ns',
    owner: ['Marco Silva', 'marco@tidewatersurf.com'],
    country: 'US',
    plan: 'Launch',
    state: trial('2026-10-08', 10),
    created: '2026-09-28',
    storefront: 'own',
    domain: { host: 'tidewater-surf.shops.northstar.com', custom: false, status: 'waiting' },
    setup: { state: 'running', step: 'hostnames', attempts: 1, startedAt: '2026-09-28T10:50:00Z', stepMinutes: 1 },
    people: [1, 0, 0, 0],
    built: null,
    history: [['2026-09-28', 'store.trial_started']],
    users: [['Marco Silva', 'marco@tidewatersurf.com', 'owner', 'active', '2026-09-28T10:50:00Z']],
  }),
  sample({
    id: 's15',
    name: 'Juniper & Co.',
    code: 'juniper-co',
    partner: 'ns',
    owner: ['Anjali Nair', 'anjali@juniperco.com'],
    country: 'US',
    plan: 'Pro',
    state: active,
    created: '2025-12-01',
    domain: { host: 'juniperco.com', custom: true },
    people: [1, 1, 3, 4],
    version: 'v31',
    history: [
      ['2025-12-01', 'store.trial_started'],
      ['2025-12-11', 'store.activated'],
    ],
    users: [
      ['Anjali Nair', 'anjali@juniperco.com', 'owner', 'active', '2026-09-28T07:02:00Z'],
      ['Priya Mehta', 'priya@mehtatextiles.in', 'supplierAdmin', 'active', '2026-09-28T08:52:00Z', 'Loomcraft'],
      ['Farhan Ali', 'farhan@loomcraft.in', 'supplierMember', 'active', '2026-09-25T13:20:00Z', 'Loomcraft'],
    ],
  }),
]

const allowed = { allowed: true } as const

const partnerClosed = (id: string) => samplePartners.find((partner) => partner.id === id)?.state === 'closed'

const onlyFor = (caller: StaffRole, roles: readonly StaffRole[], reason: StoreRefusal): ActionPermission<StoreRefusal> =>
  roles.includes(caller) ? allowed : { allowed: false, reason }

// FIRST-RELEASE.md §5.3 with the #20 decisions: which actions a store offers in its state,
// and whether this caller may use each.
export const storePermissionsFor = (store: SampleStore, caller: StaffRole): StorePermissions => {
  const actions: StorePermissions = {}
  const kind = store.state.kind
  if (kind !== 'suspended' && kind !== 'cancelled' && kind !== 'closed') {
    const suspend: StorePermission =
      caller === 'staff-engineer' ? { allowed: true, emergency: true } : onlyFor(caller, ['staff-super-admin'], 'SUSPENDERS_ONLY')
    actions.suspend = suspend
  }
  if (kind === 'suspended') actions.restore = onlyFor(caller, ['staff-super-admin'], 'SUPER_ADMIN_ONLY')
  if (kind === 'trial') actions.extendTrial = onlyFor(caller, ['staff-super-admin'], 'SUPER_ADMIN_ONLY')
  actions.resendInvite = onlyFor(caller, ['staff-super-admin', 'staff-support'], 'INVITERS_ONLY')
  actions.addNote = onlyFor(caller, ['staff-super-admin', 'staff-partner-manager', 'staff-support', 'staff-engineer'], 'NOTERS_ONLY')
  return actions
}

const dayMs = 86_400_000

const withinDays = (iso: string, days: number, now: string) => Date.parse(now) - Date.parse(iso) <= days * dayMs

const matches = (store: SampleStore, filter: StoreFilter, now: string) => {
  const q = filter.q?.trim().toLowerCase()
  return (
    (!filter.partner || store.partner.id === filter.partner) &&
    (!filter.status || store.state.kind === filter.status) &&
    (!filter.storefront || store.storefront === filter.storefront) &&
    (!filter.setup || stateOf(store.setup) === filter.setup) &&
    (!filter.created || withinDays(store.createdAt, filter.created === '7d' ? 7 : 30, now)) &&
    (!q || [store.name, store.code, store.domain.host, store.owner.email ?? '', store.owner.name ?? ''].some((value) => value.toLowerCase().includes(q)))
  )
}

const newestFirst = (a: SampleStore, b: SampleStore) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)

const rowOf = (store: SampleStore): StoreRow => ({
  id: store.id,
  name: store.name,
  code: store.code,
  partner: store.partner,
  owner: store.owner,
  plan: store.plan,
  state: store.state,
  storefront: store.storefront,
  domain: store.domain,
  setup: { state: stateOf(store.setup), step: store.setup.step, steps: store.setup.steps, attempts: store.setup.attempts },
  createdAt: store.createdAt,
})

export const createStoresServer = (seed: readonly SampleStore[], now: () => string = () => new Date().toISOString()) => {
  let stores = seed.map((store) => structuredClone(store))

  const find = (id: string) => stores.find((store) => store.id === id)

  const update = (id: string, change: (store: SampleStore) => SampleStore) => {
    stores = stores.map((store) => (store.id === id ? change(store) : store))
  }

  const list = (filter: StoreFilter, page: PageRequest, size: number): StorePage => {
    const all = stores.filter((store) => matches(store, filter, now())).sort(newestFirst)
    const { items, pageInfo } = pageByCursor(all, page, size)
    return {
      items: items.map(rowOf),
      pageInfo,
      partners: Object.entries(partnerNames).map(([id, name]) => ({ id, name })),
    }
  }

  const get = (id: string, caller: StaffRole): Store | null => {
    const store = find(id)
    if (!store) return null
    const { before, setup, ...rest } = store
    const state = stateOf(setup)
    return {
      ...rest,
      setup: rowOf(store).setup,
      job: setup.jobId && state !== 'done' ? { id: setup.jobId, actions: jobPermissionsFor(state, caller) } : null,
      impersonate: Object.fromEntries(rest.users.map((user) => [user.id, impersonatePermission(caller, user.status, partnerClosed(rest.partner.id))])),
      actions: storePermissionsFor({ ...rest, setup, before }, caller),
    }
  }

  const record = (store: SampleStore, action: string, note: string | null): StoreHistoryEntry[] => [...store.history, { at: now(), action, by: 'Arjun Menon', note }]

  const run = (id: string, action: StoreAction, reason: string | null, value: string | null) => {
    const store = find(id)
    if (!store) throw new Error('No such store.')
    switch (action) {
      case 'suspend':
        if (store.state.kind === 'suspended' || !reason) return
        update(id, (current) => {
          const previous = current.state.kind === 'suspended' || current.state.kind === 'cancelled' || current.state.kind === 'closed' ? 'active' : current.state.kind
          return {
            ...current,
            before: current.state,
            state: { kind: 'suspended', reason, by: 'Arjun Menon', since: now(), previous },
            history: record(current, 'store.suspended', reason),
          }
        })
        return
      case 'restore':
        update(id, (current) => ({ ...current, state: current.before ?? { kind: 'active' }, before: null, history: record(current, 'store.restored', reason) }))
        return
      case 'extendTrial':
        if (!value) return
        update(id, (current) => ({
          ...current,
          state: { kind: 'trial', trialEndsAt: `${value}T00:00:00Z`, daysLeft: Math.ceil((Date.parse(`${value}T00:00:00Z`) - Date.parse(now())) / dayMs) },
          history: record(current, 'store.trial_extended', null),
        }))
        return
      case 'addNote':
        if (!value?.trim()) return
        if (value.trim().length > storeNoteMaxLength) throw new Error('The note is too long.')
        update(id, (current) => ({ ...current, notes: [{ id: `${id}-n${current.notes.length + 1}`, by: 'Arjun Menon', at: now(), text: value.trim() }, ...current.notes] }))
        return
      case 'resendInvite':
        return
    }
  }

  // What the provisioning sample runs a signup Workflow on: the same records, so a Retry from
  // the Provisioning list shows on the store's tab too.
  const signups = {
    all: (): readonly SampleStore[] => stores,
    update,
    remove: (id: string) => {
      stores = stores.filter((store) => store.id !== id)
    },
  }

  return { list, get, run, signups }
}

export const storesServer = createStoresServer(sampleStores)

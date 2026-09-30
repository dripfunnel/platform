// The prototype's sample partners (designs/admin-data.js), served the way the Admin API would
// serve them: filtered, sorted and paged here, and every permission worked out here, never in a
// component. It stands in for the server until #33, and goes with it.
import type { StaffRole } from '../features/shell/staffRoles'
import type {
  ActionPermission,
  DomainKind,
  GoLiveCheck,
  HistoryEntry,
  Partner,
  PartnerAction,
  PartnerDomain,
  PartnerFilter,
  PartnerPage,
  PartnerPermissions,
  PartnerPlan,
  PartnerUser,
  SetupRow,
} from './partners'
import type { PageRequest } from './pageInfo'
import { samplePage } from './samplePage'

export type SamplePartner = Omit<Partner, 'actions' | 'setup' | 'portalHost'> & { checks: Record<GoLiveCheck, boolean> }

const edge = 'edge.dripfunnel.net'

const domainsFor = (base: string, portal: string, waiting: readonly DomainKind[] = []): PartnerDomain[] => {
  const spec: [DomainKind, string, string, string][] = [
    ['portal', portal, 'CNAME', `portal.${edge}`],
    ['preview', `*.preview.${base}`, 'CNAME', `preview.${edge}`],
    ['shops', `*.shops.${base}`, 'CNAME', `shops.${edge}`],
    ['email', `mail.${base}`, 'TXT', 'v=spf1 include:mail.dripfunnel.net ~all'],
  ]
  return spec.map(([kind, host, record, expected]) => {
    const isWaiting = waiting.includes(kind)
    return { kind, host, status: isWaiting ? 'waiting' : 'live', record, expected, found: isWaiting ? null : expected }
  })
}

const done = (name: string, org: string) => ({ status: 'done' as const, by: { name, org } })
const allDone = (name: string, org: string): SetupRow[] =>
  (['companyDetails', 'ownerAccepted', 'branding', 'portalHost', 'emailSender', 'plans', 'legalPages', 'payoutDetails'] as const).map(
    (item) => ({ item, ...done(name, org) }),
  )

const plan = (id: string, name: string, price: PartnerPlan['price'], maxProducts: number | null, maxStaff: number | null, stores: number): PartnerPlan => ({
  id,
  name,
  price,
  maxProducts,
  maxStaff,
  stores,
})
const usd = (dollars: number) => ({ amount: dollars * 100, currency: 'USD' })

const user = (id: string, name: string, email: string, role: PartnerUser['role'], lastSignInAt: string | null): PartnerUser => ({
  id,
  name,
  email,
  role,
  status: lastSignInAt ? 'active' : 'invited',
  lastSignInAt,
})

const event = (at: string, kind: HistoryEntry['event'], by: string | null = null, note: string | null = null): HistoryEntry => ({
  at,
  event: kind,
  by,
  note,
})

const passing: Record<GoLiveCheck, boolean> = { portalHost: true, emailDomain: true, pricedPlan: true, legalPages: true, testSignup: true }

export const samplePartners: readonly SamplePartner[] = [
  {
    id: 'df',
    name: 'DripFunnel',
    house: true,
    kind: 'House partner',
    region: 'Global',
    country: 'IN',
    state: 'live',
    stores: 1240,
    owner: { name: 'Ravi Kapoor', email: 'ravi@dripfunnel.com', invitation: 'active', invitationSentAt: null },
    createdAt: '2024-02-03T00:00:00Z',
    contacts: [
      { name: 'Ravi Kapoor', role: 'Owner', email: 'ravi@dripfunnel.com' },
      { name: 'Arjun Menon', role: 'Platform lead', email: 'arjun@dripfunnel.com' },
    ],
    history: [event('2024-02-03T00:00:00Z', 'created', 'Arjun Menon'), event('2024-02-03T00:00:00Z', 'approved', 'Arjun Menon')],
    checklist: allDone('Ravi', 'DripFunnel'),
    branding: { productName: 'DripFunnel', primaryColor: '#EC844F', accentColor: '#0A2A4A', poweredBy: 'house' },
    domains: domainsFor('dripfunnel.com', 'store.dripfunnel.com'),
    plans: [
      plan('df-starter', 'Starter', usd(0), 10, 1, 402),
      plan('df-growth', 'Growth', usd(29), 100, 2, 511),
      plan('df-growth-pro', 'Growth Pro', usd(79), 5000, 5, 244),
      plan('df-business', 'Business', usd(149), null, 15, 83),
    ],
    team: [],
    checks: passing,
  },
  {
    id: 'ns',
    name: 'Northstar Commerce',
    house: false,
    kind: 'Agency',
    region: 'US, Canada',
    country: 'US',
    state: 'live',
    stores: 86,
    owner: { name: 'Maya Chen', email: 'maya@northstar.com', invitation: 'active', invitationSentAt: null },
    createdAt: '2025-03-14T00:00:00Z',
    contacts: [
      { name: 'Maya Chen', role: 'Owner', email: 'maya@northstar.com' },
      { name: 'Diego Alvarez', role: 'Technical contact', email: 'diego@northstar.com' },
    ],
    history: [
      event('2025-03-14T00:00:00Z', 'created', 'Maya Ortiz'),
      event('2025-03-19T00:00:00Z', 'submitted'),
      event('2025-03-20T00:00:00Z', 'approved', 'Arjun Menon', 'Contract signed, KYC passed'),
    ],
    checklist: allDone('Maya', 'Northstar Commerce'),
    branding: { productName: 'Northstar Stores', primaryColor: '#1B3A5B', accentColor: '#2BB673', poweredBy: 'on' },
    domains: domainsFor('northstar.com', 'store.northstar.com'),
    plans: [
      plan('ns-launch', 'Launch', usd(29), 250, 1, 31),
      plan('ns-scale', 'Scale', usd(79), 2000, 3, 42),
      plan('ns-pro', 'Pro', usd(149), 5000, 10, 13),
    ],
    team: [
      user('mayachen', 'Maya Chen', 'maya@northstar.com', 'owner', '2026-09-28T08:30:00Z'),
      user('diego', 'Diego Alvarez', 'diego@northstar.com', 'admin', '2026-09-27T21:02:00Z'),
      user('jess', 'Jess Moreno', 'jess@northstar.com', 'support', '2026-09-28T07:15:00Z'),
    ],
    checks: passing,
  },
  {
    id: 'bz',
    name: 'Bazaar Cloud',
    house: false,
    kind: 'Reseller',
    region: 'India, UAE',
    country: 'IN',
    state: 'live',
    stores: 312,
    owner: { name: 'Vikram Rao', email: 'vikram@bazaarcloud.in', invitation: 'active', invitationSentAt: null },
    createdAt: '2025-01-22T00:00:00Z',
    contacts: [
      { name: 'Vikram Rao', role: 'Owner', email: 'vikram@bazaarcloud.in' },
      { name: 'Sana Qureshi', role: 'UAE lead', email: 'sana@bazaarcloud.ae' },
    ],
    history: [
      event('2025-01-22T00:00:00Z', 'created', 'Maya Ortiz'),
      event('2025-01-30T00:00:00Z', 'submitted'),
      event('2025-02-03T00:00:00Z', 'approved', 'Arjun Menon', 'Contract signed, KYC passed'),
    ],
    checklist: allDone('Vikram', 'Bazaar Cloud'),
    branding: { productName: 'Bazaar Cloud Commerce', primaryColor: '#0F6E5C', accentColor: '#F2B134', poweredBy: 'off' },
    domains: [
      ...domainsFor('bazaarcloud.in', 'portal.bazaarcloud.in'),
      { kind: 'shops', host: '*.shops.bazaarcloud.ae', status: 'failed', record: 'CNAME', expected: `shops.${edge}`, found: 'shops-old.bzhost.ae' },
    ],
    plans: [
      plan('bz-starter', 'Starter', { amount: 149900, currency: 'INR' }, 250, 1, 120),
      plan('bz-growth', 'Growth', { amount: 499900, currency: 'INR' }, 2000, 3, 96),
      plan('bz-growth-uae', 'Growth UAE', { amount: 21900, currency: 'AED' }, 2000, 3, 26),
    ],
    team: [
      user('vikram', 'Vikram Rao', 'vikram@bazaarcloud.in', 'owner', '2026-09-28T05:40:00Z'),
      user('sana', 'Sana Qureshi', 'sana@bazaarcloud.ae', 'admin', '2026-09-27T12:10:00Z'),
    ],
    checks: passing,
  },
  {
    id: 'kl',
    name: 'Kaufladen Digital',
    house: false,
    kind: 'Payments company',
    region: 'Germany, Austria',
    country: 'DE',
    state: 'awaiting',
    stores: 40,
    owner: { name: 'Jonas Weber', email: 'jonas@kaufladen.de', invitation: 'active', invitationSentAt: null },
    createdAt: '2026-09-08T00:00:00Z',
    contacts: [
      { name: 'Jonas Weber', role: 'Owner', email: 'jonas@kaufladen.de' },
      { name: 'Petra Lang', role: 'Legal', email: 'petra@kaufladen.de' },
    ],
    history: [
      event('2026-09-08T00:00:00Z', 'created', 'Maya Ortiz'),
      event('2026-09-15T00:00:00Z', 'setUp', 'Priya Shah'),
      event('2026-09-19T00:00:00Z', 'submitted'),
      event('2026-09-22T00:00:00Z', 'sentBack', 'Maya Ortiz', 'Legal pages missing an Impressum'),
      event('2026-09-26T09:40:00Z', 'submitted'),
    ],
    checklist: [
      { item: 'companyDetails', ...done('Jonas', 'Kaufladen Digital') },
      { item: 'ownerAccepted', ...done('Jonas', 'Kaufladen Digital') },
      { item: 'branding', ...done('Priya', 'DripFunnel') },
      { item: 'portalHost', ...done('Jonas', 'Kaufladen Digital') },
      { item: 'emailSender', status: 'waitingForDns', by: { name: 'Jonas', org: 'Kaufladen Digital' } },
      { item: 'plans', ...done('Priya', 'DripFunnel') },
      { item: 'legalPages', ...done('Jonas', 'Kaufladen Digital') },
      { item: 'payoutDetails', status: 'waitingOnPartner', by: null },
    ],
    branding: { productName: 'Kaufladen Shop', primaryColor: '#2A2F8F', accentColor: '#FFCC00', poweredBy: 'on' },
    domains: domainsFor('kaufladen.de', 'shop.kaufladen.de', ['email']),
    plans: [
      plan('kl-basis', 'Basis', { amount: 2500, currency: 'EUR' }, 500, 2, 24),
      plan('kl-plus', 'Plus', { amount: 6900, currency: 'EUR' }, 5000, 5, 16),
      plan('kl-enterprise', 'Enterprise (draft)', null, null, null, 0),
    ],
    team: [
      user('jonas', 'Jonas Weber', 'jonas@kaufladen.de', 'owner', '2026-09-26T09:38:00Z'),
      user('petra', 'Petra Lang', 'petra@kaufladen.de', 'admin', '2026-09-25T14:00:00Z'),
    ],
    checks: { ...passing, emailDomain: false },
  },
  {
    id: 'lt',
    name: 'Loom & Thread',
    house: false,
    kind: 'Marketplace operator',
    region: 'UK',
    country: 'GB',
    state: 'live',
    stores: 1,
    owner: { name: 'Olivia Grant', email: 'olivia@loomandthread.co.uk', invitation: 'active', invitationSentAt: null },
    createdAt: '2025-09-12T00:00:00Z',
    contacts: [{ name: 'Olivia Grant', role: 'Owner', email: 'olivia@loomandthread.co.uk' }],
    history: [
      event('2025-09-12T00:00:00Z', 'created', 'Maya Ortiz'),
      event('2025-09-29T00:00:00Z', 'approved', 'Arjun Menon', 'Contract signed, KYC passed'),
    ],
    checklist: allDone('Olivia', 'Loom & Thread'),
    branding: { productName: 'Loom & Thread Sellers', primaryColor: '#5B3A29', accentColor: '#D9A441', poweredBy: 'on' },
    domains: domainsFor('loomandthread.co.uk', 'sellers.loomandthread.co.uk'),
    plans: [plan('lt-marketplace', 'Marketplace', { amount: 120000, currency: 'GBP' }, null, null, 1)],
    team: [user('olivia', 'Olivia Grant', 'olivia@loomandthread.co.uk', 'owner', '2026-09-27T19:30:00Z')],
    checks: passing,
  },
  {
    id: 'ts',
    name: 'Tallis Studio',
    house: false,
    kind: 'Agency',
    region: 'Australia',
    country: 'AU',
    state: 'draft',
    stores: 0,
    owner: { name: 'Ben Tallis', email: 'ben@tallis.studio', invitation: 'sent', invitationSentAt: '2026-09-25T11:03:00Z' },
    createdAt: '2026-09-25T00:00:00Z',
    contacts: [{ name: 'Ben Tallis', role: 'Owner (invited)', email: 'ben@tallis.studio' }],
    history: [event('2026-09-25T00:00:00Z', 'created', 'Maya Ortiz')],
    checklist: [
      { item: 'companyDetails', ...done('Maya', 'DripFunnel') },
      { item: 'ownerAccepted', status: 'invitationSent', by: null },
      ...(['branding', 'portalHost', 'emailSender', 'plans', 'legalPages'] as const).map((item) => ({ item, status: 'notStarted' as const, by: null })),
      { item: 'payoutDetails', status: 'waitingOnPartner', by: null },
    ],
    branding: { productName: 'Tallis Shops', primaryColor: '#3D5A40', accentColor: '#E3B23C', poweredBy: 'on' },
    domains: domainsFor('tallis.studio', 'shops.tallis.studio', ['portal', 'preview', 'shops', 'email']),
    plans: [],
    team: [],
    checks: { portalHost: false, emailDomain: false, pricedPlan: false, legalPages: false, testSignup: false },
  },
  {
    id: 'nl',
    name: 'Nordlicht Media',
    house: false,
    kind: 'Agency',
    region: 'Sweden, Norway',
    country: 'SE',
    state: 'draft',
    stores: 0,
    owner: { name: 'Freya Lind', email: 'freya@nordlicht.media', invitation: 'held', invitationSentAt: null },
    createdAt: '2026-09-23T00:00:00Z',
    contacts: [{ name: 'Freya Lind', role: 'Owner (invitation held)', email: 'freya@nordlicht.media' }],
    history: [event('2026-09-23T00:00:00Z', 'created', 'Priya Shah'), event('2026-09-24T00:00:00Z', 'setUp', 'Priya Shah')],
    checklist: [
      { item: 'companyDetails', ...done('Priya', 'DripFunnel') },
      { item: 'ownerAccepted', status: 'invitationHeld', by: null },
      { item: 'branding', ...done('Priya', 'DripFunnel') },
      { item: 'portalHost', ...done('Priya', 'DripFunnel') },
      { item: 'emailSender', status: 'waitingForDns', by: { name: 'Priya', org: 'DripFunnel' } },
      { item: 'plans', status: 'notStarted', by: null },
      { item: 'legalPages', status: 'notStarted', by: null },
      { item: 'payoutDetails', status: 'waitingOnPartner', by: null },
    ],
    branding: { productName: 'Nordlicht Shops', primaryColor: '#3B2F63', accentColor: '#7FD1C7', poweredBy: 'on' },
    domains: domainsFor('nordlicht.media', 'shops.nordlicht.media', ['preview', 'shops', 'email']),
    plans: [],
    team: [],
    checks: { portalHost: true, emailDomain: false, pricedPlan: false, legalPages: false, testSignup: false },
  },
]

const allowed: ActionPermission = { allowed: true }

const partnerAdmins: readonly StaffRole[] = ['staff-super-admin', 'staff-partner-manager']
const inviters: readonly StaffRole[] = [...partnerAdmins, 'staff-support']

const onlyFor = (caller: StaffRole, roles: readonly StaffRole[], reason: 'SUPER_ADMIN_ONLY' | 'PARTNER_ADMINS_ONLY' | 'INVITERS_ONLY'): ActionPermission =>
  roles.includes(caller) ? allowed : { allowed: false, reason }

// FIRST-RELEASE.md §4.3 with the #19 and #31 decisions: which actions a partner offers in its
// state, and whether this caller may use each. A record-level refusal (the house partner,
// failing go-live checks) wins over a role one, so the reason names what would actually unblock it.
export const permissionsFor = (partner: SamplePartner, caller: StaffRole): PartnerPermissions => {
  const actions: PartnerPermissions = {}
  if (partner.state === 'closed') return actions
  actions.setupSession = onlyFor(caller, partnerAdmins, 'PARTNER_ADMINS_ONLY')
  if (partner.state === 'awaiting') {
    const failingChecks = (Object.keys(partner.checks) as GoLiveCheck[]).filter((check) => !partner.checks[check])
    actions.approve =
      failingChecks.length > 0
        ? { allowed: false, reason: 'GO_LIVE_CHECKS_FAILING', failingChecks }
        : onlyFor(caller, partnerAdmins, 'PARTNER_ADMINS_ONLY')
    actions.sendBack = onlyFor(caller, partnerAdmins, 'PARTNER_ADMINS_ONLY')
  }
  if (partner.state === 'live') {
    actions.pause = partner.house ? { allowed: false, reason: 'HOUSE_PARTNER' } : onlyFor(caller, ['staff-super-admin'], 'SUPER_ADMIN_ONLY')
  }
  if (partner.state === 'paused') actions.resume = onlyFor(caller, ['staff-super-admin'], 'SUPER_ADMIN_ONLY')
  if (partner.owner.invitation === 'held') actions.sendInvite = onlyFor(caller, inviters, 'INVITERS_ONLY')
  if (partner.owner.invitation === 'sent') actions.resendInvite = onlyFor(caller, inviters, 'INVITERS_ONLY')
  return actions
}

const setupOf = (partner: SamplePartner) => ({
  done: partner.checklist.filter((row) => row.status === 'done').length,
  total: partner.checklist.length,
})

const portalHostOf = (partner: SamplePartner) => {
  const portal = partner.domains.find((domain) => domain.kind === 'portal')
  return portal ? { host: portal.host, status: portal.status } : { host: null, status: 'notSet' as const }
}

const rowOf = (partner: SamplePartner) => ({
  id: partner.id,
  name: partner.name,
  house: partner.house,
  kind: partner.kind,
  region: partner.region,
  state: partner.state,
  stores: partner.stores,
  portalHost: portalHostOf(partner),
  setup: setupOf(partner),
  owner: partner.owner,
  createdAt: partner.createdAt,
})

const matches = (partner: SamplePartner, filter: PartnerFilter) => {
  const setup = setupOf(partner)
  const complete = setup.done === setup.total
  const q = filter.q?.trim().toLowerCase()
  return (
    (!filter.status || partner.state === filter.status) &&
    (!filter.setup || (filter.setup === 'complete') === complete) &&
    (!q || [partner.name, portalHostOf(partner).host ?? '', partner.owner.email].some((value) => value.toLowerCase().includes(q)))
  )
}

// Newest first, then by id so the order is total and a cursor always means one place.
const newestFirst = (a: SamplePartner, b: SamplePartner) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)

const stateAfter: Partial<Record<PartnerAction, SamplePartner['state']>> = {
  approve: 'live',
  sendBack: 'draft',
  pause: 'paused',
  resume: 'live',
}

const historyFor: Partial<Record<PartnerAction, HistoryEntry['event']>> = {
  approve: 'approved',
  sendBack: 'sentBack',
  pause: 'paused',
  resume: 'resumed',
}

export const createSampleServer = (seed: readonly SamplePartner[], now: () => string = () => new Date().toISOString()) => {
  let partners = seed.map((partner) => structuredClone(partner))

  const find = (id: string) => partners.find((partner) => partner.id === id)

  const list = (filter: PartnerFilter, page: PageRequest, size: number, caller: StaffRole): PartnerPage => {
    const all = partners.filter((partner) => matches(partner, filter)).sort(newestFirst)
    const { items, pageInfo } = samplePage(all, page, size)
    return {
      items: items.map(rowOf),
      pageInfo,
      total: all.length,
      create: onlyFor(caller, partnerAdmins, 'PARTNER_ADMINS_ONLY'),
    }
  }

  const get = (id: string, caller: StaffRole): Partner | null => {
    const partner = find(id)
    if (!partner) return null
    const { checks, ...rest } = partner
    return { ...rest, ...rowOf(partner), actions: permissionsFor({ ...rest, checks }, caller) }
  }

  const run = (id: string, action: PartnerAction, reason: string | null) => {
    const partner = find(id)
    if (!partner) throw new Error('No such partner.')
    const next = stateAfter[action]
    const recorded = historyFor[action]
    partners = partners.map((candidate) => {
      if (candidate.id !== id) return candidate
      const owner =
        action === 'sendInvite' || action === 'resendInvite'
          ? { ...candidate.owner, invitation: 'sent' as const, invitationSentAt: now() }
          : candidate.owner
      return {
        ...candidate,
        state: next ?? candidate.state,
        owner,
        history: recorded ? [...candidate.history, event(now(), recorded, 'Arjun Menon', reason)] : candidate.history,
      }
    })
  }

  const recheck = (id: string, kind: DomainKind) => find(id)?.domains.find((domain) => domain.kind === kind)?.status ?? 'waiting'

  return { list, get, run, recheck }
}

export const sampleServer = createSampleServer(samplePartners)

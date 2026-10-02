// The prototype's sample partners (designs/admin-data.js) as the Admin API serves them: the
// screen tests' fixture and the seed of the samples still waiting for their API (#37, #39, #40).
import type { StaffRole } from '../features/shell/staffRoles'
import {
  setupItems,
  type ActionPermission,
  type DomainKind,
  type GoLiveCheck,
  type HistoryEntry,
  type Partner,
  type PartnerAction,
  type PartnerApproval,
  type PartnerDomain,
  type PartnerFilter,
  type PartnerPage,
  type PartnerPermissions,
  type PartnerPlan,
  type PartnerUser,
  type SetupRow,
} from './partners'
import { pageByCursor, type PageRequest } from '@dripfunnel/shared/graphql'
import { impersonatePermission, setupStarters } from './sessionRules'

export type SamplePartner = Omit<Partner, 'actions' | 'impersonate' | 'setup' | 'portalHost' | 'submittedAt' | 'approval'>

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
    return { id: `${base}-${kind}`, kind, host, status: isWaiting ? 'waiting' : 'live', record, expected, found: isWaiting ? null : expected, checkedAt: '2026-09-28T10:30:00Z' }
  })
}

const done = (name: string, org: string, detail: string | null = null) => ({ status: 'done' as const, detail, by: { name, org } })
const progress = (detail: string): Pick<SetupRow, 'status' | 'detail' | 'by'> => ({ status: 'progress', detail, by: null })
const missing = (detail: string): Pick<SetupRow, 'status' | 'detail' | 'by'> => ({ status: 'missing', detail, by: null })
const allDone = (name: string, org: string): SetupRow[] => setupItems.map((item) => ({ item, ...done(name, org) }))

const plan = (id: string, name: string, status: PartnerPlan['status'], maxProducts: number | null, maxStaff: number | null, stores: number): PartnerPlan => ({
  id,
  name,
  status,
  maxProducts,
  maxStaff,
  stores,
})

const user = (id: string, name: string, email: string, role: PartnerUser['role'], lastSignInAt: string | null): PartnerUser => ({
  id,
  name,
  email,
  role,
  status: lastSignInAt ? 'active' : 'invited',
  lastSignInAt,
})

const event = (at: string, action: string, by: string | null = null, note: string | null = null): HistoryEntry => ({ at, action, by, note })

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
    history: [event('2024-02-03T00:00:00Z', 'partner.created', 'Arjun Menon'), event('2024-02-03T00:00:00Z', 'partner.approved', 'Arjun Menon')],
    checklist: allDone('Ravi', 'DripFunnel'),
    branding: { productName: 'DripFunnel', primaryColor: '#EC844F', accentColor: '#0A2A4A', poweredBy: 'house' },
    domains: domainsFor('dripfunnel.com', 'store.dripfunnel.com'),
    plans: [
      plan('df-starter', 'Starter', 'live', 10, 1, 402),
      plan('df-growth', 'Growth', 'live', 100, 2, 511),
      plan('df-growth-pro', 'Growth Pro', 'live', 5000, 5, 244),
      plan('df-business', 'Business', 'live', null, 15, 83),
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
      event('2025-03-14T00:00:00Z', 'partner.created', 'Maya Ortiz'),
      event('2025-03-19T00:00:00Z', 'partner.submitted'),
      event('2025-03-20T00:00:00Z', 'partner.approved', 'Arjun Menon', 'Contract signed, KYC passed'),
    ],
    checklist: allDone('Maya', 'Northstar Commerce'),
    branding: { productName: 'Northstar Stores', primaryColor: '#1B3A5B', accentColor: '#2BB673', poweredBy: 'on' },
    domains: domainsFor('northstar.com', 'store.northstar.com'),
    plans: [
      plan('ns-launch', 'Launch', 'live', 250, 1, 31),
      plan('ns-scale', 'Scale', 'live', 2000, 3, 42),
      plan('ns-pro', 'Pro', 'retired', 5000, 10, 13),
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
      event('2025-01-22T00:00:00Z', 'partner.created', 'Maya Ortiz'),
      event('2025-01-30T00:00:00Z', 'partner.submitted'),
      event('2025-02-03T00:00:00Z', 'partner.approved', 'Arjun Menon', 'Contract signed, KYC passed'),
    ],
    checklist: allDone('Vikram', 'Bazaar Cloud'),
    branding: { productName: 'Bazaar Cloud Commerce', primaryColor: '#0F6E5C', accentColor: '#F2B134', poweredBy: 'off' },
    domains: [
      ...domainsFor('bazaarcloud.in', 'portal.bazaarcloud.in'),
      { id: 'bz-shops-ae', kind: 'shops', host: '*.shops.bazaarcloud.ae', status: 'broken', record: 'CNAME', expected: `shops.${edge}`, found: 'shops-old.bzhost.ae', checkedAt: '2026-09-28T10:30:00Z' },
    ],
    plans: [
      plan('bz-starter', 'Starter', 'live', 250, 1, 120),
      plan('bz-growth', 'Growth', 'live', 2000, 3, 96),
      plan('bz-growth-uae', 'Growth UAE', 'live', 2000, 3, 26),
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
      event('2026-09-08T00:00:00Z', 'partner.created', 'Maya Ortiz'),
      event('2026-09-15T00:00:00Z', 'partner.set_up', 'Priya Shah'),
      event('2026-09-19T00:00:00Z', 'partner.submitted'),
      event('2026-09-22T00:00:00Z', 'partner.sent_back', 'Maya Ortiz', 'Legal pages missing an Impressum'),
      event('2026-09-26T09:40:00Z', 'partner.submitted'),
    ],
    checklist: [
      { item: 'company', ...done('Jonas', 'Kaufladen Digital', 'Kaufladen Digital GmbH, Berlin') },
      { item: 'branding', ...done('Priya', 'DripFunnel') },
      { item: 'portalHost', ...done('Jonas', 'Kaufladen Digital', 'shop.kaufladen.de is live') },
      { item: 'wildcards', ...done('Jonas', 'Kaufladen Digital') },
      { item: 'emailSender', ...progress('mail.kaufladen.de: waiting for DNS') },
      { item: 'plan', ...done('Priya', 'DripFunnel', 'Basis and Plus are priced') },
      { item: 'legal', ...done('Jonas', 'Kaufladen Digital') },
      { item: 'paymentMethod', ...done('Jonas', 'Kaufladen Digital') },
      { item: 'payoutDetails', ...missing('Add the bank account DripFunnel pays you into') },
      { item: 'testSignup', ...done('Jonas', 'Kaufladen Digital') },
    ],
    branding: { productName: 'Kaufladen Shop', primaryColor: '#2A2F8F', accentColor: '#FFCC00', poweredBy: 'on' },
    domains: domainsFor('kaufladen.de', 'shop.kaufladen.de', ['email']),
    plans: [
      plan('kl-basis', 'Basis', 'live', 500, 2, 24),
      plan('kl-plus', 'Plus', 'live', 5000, 5, 16),
      plan('kl-enterprise', 'Enterprise', 'draft', null, null, 0),
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
      event('2025-09-12T00:00:00Z', 'partner.created', 'Maya Ortiz'),
      event('2025-09-29T00:00:00Z', 'partner.approved', 'Arjun Menon', 'Contract signed, KYC passed'),
    ],
    checklist: allDone('Olivia', 'Loom & Thread'),
    branding: { productName: 'Loom & Thread Sellers', primaryColor: '#5B3A29', accentColor: '#D9A441', poweredBy: 'on' },
    domains: domainsFor('loomandthread.co.uk', 'sellers.loomandthread.co.uk'),
    plans: [plan('lt-marketplace', 'Marketplace', 'live', null, null, 1)],
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
    history: [event('2026-09-25T00:00:00Z', 'partner.created', 'Maya Ortiz')],
    checklist: [
      { item: 'company', ...done('Maya', 'DripFunnel', 'Tallis Studio Pty Ltd, Melbourne') },
      { item: 'branding', ...missing('Logo, colours and font') },
      { item: 'portalHost', ...progress('shops.tallis.studio: waiting for DNS') },
      ...(['wildcards', 'emailSender', 'plan', 'legal', 'paymentMethod', 'payoutDetails', 'testSignup'] as const).map((item) => ({ item, ...missing('Not started') })),
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
    history: [event('2026-09-23T00:00:00Z', 'partner.created', 'Priya Shah'), event('2026-09-24T00:00:00Z', 'partner.set_up', 'Priya Shah')],
    checklist: [
      { item: 'company', ...done('Priya', 'DripFunnel', 'Nordlicht Media AB, Stockholm') },
      { item: 'branding', ...done('Priya', 'DripFunnel') },
      { item: 'portalHost', ...done('Priya', 'DripFunnel') },
      { item: 'wildcards', ...progress('*.preview.nordlicht.media: waiting for DNS') },
      { item: 'emailSender', ...progress('mail.nordlicht.media: verifying') },
      ...(['plan', 'legal', 'paymentMethod', 'payoutDetails', 'testSignup'] as const).map((item) => ({ item, ...missing('Not started') })),
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

// The sample's staff, so the Approve refusal can tell who is asking; the session names them
// once staff sign-in lands (#13).
const staffRoleOf: Partial<Record<string, StaffRole>> = { 'Arjun Menon': 'staff-super-admin', 'Priya Shah': 'staff-partner-manager', 'Maya Ortiz': 'staff-partner-manager' }
const personFor: Partial<Record<StaffRole, string>> = { 'staff-super-admin': 'Arjun Menon', 'staff-partner-manager': 'Priya Shah' }

const lastEvent = (partner: SamplePartner, action: string) => partner.history.filter((entry) => entry.action === action).at(-1)

const approvalOf = (partner: SamplePartner): PartnerApproval | null => {
  if (partner.state !== 'awaiting') return null
  const setUpBy = lastEvent(partner, 'partner.set_up')?.by ?? null
  if (!setUpBy) return { setUpBy, rule: 'two', approvals: 0 }
  return { setUpBy, rule: staffRoleOf[setUpBy] === 'staff-super-admin' ? 'alone' : 'second', approvals: 0 }
}

const onlyFor = (caller: StaffRole, roles: readonly StaffRole[], reason: 'SUPER_ADMIN_ONLY' | 'PARTNER_ADMINS_ONLY' | 'INVITERS_ONLY'): ActionPermission =>
  roles.includes(caller) ? allowed : { allowed: false, reason }

// FIRST-RELEASE.md §4.3 with the #19 and #31 decisions: which actions a partner offers in its
// state, and whether this caller may use each. A record-level refusal (the house partner,
// failing go-live checks) wins over a role one, so the reason names what would actually unblock it.
export const permissionsFor = (partner: SamplePartner, caller: StaffRole): PartnerPermissions => {
  const actions: PartnerPermissions = {}
  if (partner.state === 'closed') return actions
  // Absent, not refused, for every other role (decided on #46).
  if (setupStarters.includes(caller)) actions.setupSession = allowed
  if (partner.state === 'awaiting') {
    const failingChecks = (Object.keys(partner.checks) as GoLiveCheck[]).filter((check) => !partner.checks[check])
    const setUpBy = approvalOf(partner)?.setUpBy
    actions.approve =
      failingChecks.length > 0
        ? { allowed: false, reason: 'GO_LIVE_CHECKS_FAILING', failingChecks }
        : setUpBy && setUpBy === personFor[caller] && caller !== 'staff-super-admin'
          ? { allowed: false, reason: 'SET_UP_BY_CALLER' }
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
  submittedAt: partner.state === 'awaiting' ? (lastEvent(partner, 'partner.submitted')?.at ?? null) : null,
  checks: partner.checks,
  approval: approvalOf(partner),
})

const matches = (partner: SamplePartner, filter: PartnerFilter) => {
  const setup = setupOf(partner)
  const complete = setup.done === setup.total
  const q = filter.q?.trim().toLowerCase()
  return (
    (!filter.status || partner.state === filter.status) &&
    (!filter.setup || (filter.setup === 'complete') === complete) &&
    (!q || [partner.name, portalHostOf(partner).host ?? '', partner.owner.email ?? ''].some((value) => value.toLowerCase().includes(q)))
  )
}

// Newest first, then by id so the order is total and a cursor always means one place.
const newestFirst = (a: SamplePartner, b: SamplePartner) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)

const oldestSubmitted = (a: SamplePartner, b: SamplePartner) =>
  (lastEvent(a, 'partner.submitted')?.at ?? '').localeCompare(lastEvent(b, 'partner.submitted')?.at ?? '') || a.id.localeCompare(b.id)

const stateAfter: Partial<Record<PartnerAction, SamplePartner['state']>> = {
  approve: 'live',
  sendBack: 'draft',
  pause: 'paused',
  resume: 'live',
}

const historyFor: Partial<Record<PartnerAction, string>> = {
  approve: 'partner.approved',
  sendBack: 'partner.sent_back',
  pause: 'partner.paused',
  resume: 'partner.resumed',
}

export const createSampleServer = (seed: readonly SamplePartner[], now: () => string = () => new Date().toISOString()) => {
  let partners = seed.map((partner) => structuredClone(partner))

  const find = (id: string) => partners.find((partner) => partner.id === id)

  const list = (filter: PartnerFilter, page: PageRequest, size: number, caller: StaffRole): PartnerPage => {
    const all = partners.filter((partner) => matches(partner, filter)).sort(filter.sort === 'oldestSubmitted' ? oldestSubmitted : newestFirst)
    const { items, pageInfo } = pageByCursor(all, page, size)
    return { items: items.map(rowOf), pageInfo, create: onlyFor(caller, partnerAdmins, 'PARTNER_ADMINS_ONLY') }
  }

  const get = (id: string, caller: StaffRole): Partner | null => {
    const partner = find(id)
    if (!partner) return null
    const closed = partner.state === 'closed'
    const impersonate = Object.fromEntries(partner.team.map((user) => [user.id, impersonatePermission(caller, user.status, closed)]))
    return { ...partner, ...rowOf(partner), impersonate, actions: permissionsFor(partner, caller) }
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

  return { list, get, run }
}

export const sampleServer = createSampleServer(samplePartners)

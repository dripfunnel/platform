// A believable local platform (card #32): the prototype's partners and stores
// (designs/admin-data.js, designs/partner-data.js) with every state SAAS.md §3.1 and §4.2
// name. Dates are relative to the seed's clock so the picture stays current; every address is
// under a reserved `.example` domain, so nothing a developer runs can mail a real person.
import type { BuildState, DomainKind, HostStatus, PartnerRole, PartnerState, PlanStatus, ProvisioningStep, SetupItem, StoreStatus } from '#db/schema/saas'

export interface SeedStaff {
  key: string
  subject: string
  email: string
  name: string
  role: 'staff-super-admin' | 'staff-partner-manager' | 'staff-support' | 'staff-finance' | 'staff-engineer' | 'staff-read-only'
  /** Partner keys a Partner manager is assigned to. */
  partners?: string[]
}

export const staff: readonly SeedStaff[] = [
  { key: 'arjun', subject: 'seed-arjun', email: 'arjun@softobotics.example', name: 'Arjun Menon', role: 'staff-super-admin' },
  { key: 'priya', subject: 'seed-priya', email: 'priya@softobotics.example', name: 'Priya Shah', role: 'staff-partner-manager', partners: ['kl', 'nl', 'ts'] },
  { key: 'maya-o', subject: 'seed-maya-o', email: 'maya.ortiz@softobotics.example', name: 'Maya Ortiz', role: 'staff-partner-manager', partners: ['ns', 'bz', 'lt'] },
  { key: 'neha', subject: 'seed-neha', email: 'neha@softobotics.example', name: 'Neha Rao', role: 'staff-support' },
  { key: 'sam', subject: 'seed-sam', email: 'sam@softobotics.example', name: 'Sam Iyer', role: 'staff-engineer' },
  { key: 'dev', subject: 'seed-dev', email: 'dev@softobotics.example', name: 'Dev Nair', role: 'staff-read-only' },
]

export interface SeedPartnerUser {
  name: string
  email: string
  role: PartnerRole
  /** Null is an invited user who has not signed in. */
  lastSignInDaysAgo: number | null
}

export interface SeedDomain {
  kind: DomainKind
  host: string
  status: HostStatus
  found?: string | null
}

export interface SeedSetupItem {
  item: SetupItem
  status: 'done' | 'progress' | 'missing'
  detail: string
  by?: string
}

export interface SeedPlan {
  name: string
  status: PlanStatus
  trialDays?: number
  maxProducts: number | null
  maxStaff: number | null
}

export interface SeedEvent {
  daysAgo: number
  action: 'partner.created' | 'partner.set_up' | 'partner.submitted' | 'partner.sent_back' | 'partner.approved' | 'partner.paused' | 'partner.resumed' | 'partner.offboarding' | 'partner.closed'
  by: string
  reason?: string
}

export interface SeedPartner {
  key: string
  name: string
  house?: boolean
  kind: string
  region: string
  country: string
  state: PartnerState
  createdDaysAgo: number
  productName: string
  primaryColor: string
  accentColor: string
  poweredBy: 'on' | 'off' | 'house'
  /** The partner's domain, from which the four hostnames follow. */
  domain: string
  portalHost: string
  domains?: SeedDomain[]
  owner: SeedPartnerUser & { invitation: 'active' | 'sent' | 'held' }
  team: SeedPartnerUser[]
  setup: SeedSetupItem[]
  plans: SeedPlan[]
  events: SeedEvent[]
  fallbackSenderAccepted?: boolean
  sentBackReason?: string
  pauseReason?: string
}

const allDone = (by: string, portal: string, mail: string): SeedSetupItem[] => [
  { item: 'company', status: 'done', detail: 'Legal name, address and tax id present', by },
  { item: 'branding', status: 'done', detail: 'Logo, colours and font saved', by },
  { item: 'portalHost', status: 'done', detail: `${portal} is live`, by },
  { item: 'wildcards', status: 'done', detail: 'Both are live', by },
  { item: 'emailSender', status: 'done', detail: `${mail} is live`, by },
  { item: 'plan', status: 'done', detail: 'Plans are priced', by },
  { item: 'legal', status: 'done', detail: 'Terms, privacy and data-processing agreement added', by },
  { item: 'paymentMethod', status: 'done', detail: 'Card on file', by },
  { item: 'payoutDetails', status: 'done', detail: 'Bank account verified', by },
]


export const partners: readonly SeedPartner[] = [
  {
    key: 'df',
    name: 'DripFunnel',
    house: true,
    kind: 'House partner',
    region: 'Global',
    country: 'IN',
    state: 'live',
    createdDaysAgo: 960,
    productName: 'DripFunnel',
    primaryColor: '#EC844F',
    accentColor: '#0A2A4A',
    poweredBy: 'house',
    domain: 'dripfunnel.example',
    portalHost: 'store.dripfunnel.example',
    owner: { name: 'Ravi Kapoor', email: 'ravi@dripfunnel.example', role: 'partner-owner', lastSignInDaysAgo: 1, invitation: 'active' },
    team: [{ name: 'Arjun Menon', email: 'arjun@dripfunnel.example', role: 'partner-admin', lastSignInDaysAgo: 0 }],
    setup: allDone('Ravi Kapoor', 'store.dripfunnel.example', 'mail.dripfunnel.example'),
    plans: [
      { name: 'Starter', status: 'live', maxProducts: 10, maxStaff: 1 },
      { name: 'Growth', status: 'live', maxProducts: 100, maxStaff: 2 },
      { name: 'Growth Pro', status: 'live', maxProducts: 5000, maxStaff: 5 },
      { name: 'Business', status: 'live', maxProducts: null, maxStaff: 15 },
    ],
    events: [
      { daysAgo: 960, action: 'partner.created', by: 'Arjun Menon' },
      { daysAgo: 960, action: 'partner.approved', by: 'Arjun Menon' },
    ],
  },
  {
    key: 'ns',
    name: 'Northstar Commerce',
    kind: 'Agency',
    region: 'US, Canada',
    country: 'US',
    state: 'live',
    createdDaysAgo: 563,
    productName: 'Northstar Shops',
    primaryColor: '#1B3A5B',
    accentColor: '#2BB673',
    poweredBy: 'on',
    domain: 'northstar.example',
    portalHost: 'store.northstar.example',
    owner: { name: 'Maya Chen', email: 'maya@northstar.example', role: 'partner-owner', lastSignInDaysAgo: 0, invitation: 'active' },
    team: [
      { name: 'Diego Alvarez', email: 'diego@northstar.example', role: 'partner-admin', lastSignInDaysAgo: 1 },
      { name: 'Jess Moreno', email: 'jess@northstar.example', role: 'partner-support', lastSignInDaysAgo: 0 },
      { name: 'Alex Rivera', email: 'alex@northstar.example', role: 'partner-finance', lastSignInDaysAgo: 3 },
      { name: 'Sam Lee', email: 'sam@northstar.example', role: 'partner-read-only', lastSignInDaysAgo: null },
    ],
    setup: allDone('Maya Chen', 'store.northstar.example', 'mail.northstar.example'),
    plans: [
      { name: 'Starter', status: 'live', maxProducts: 250, maxStaff: 1 },
      { name: 'Growth', status: 'live', maxProducts: 2000, maxStaff: 3 },
      { name: 'Pro', status: 'live', maxProducts: 5000, maxStaff: 10 },
      { name: 'Launch (retired)', status: 'retired', maxProducts: 100, maxStaff: 1 },
    ],
    events: [
      { daysAgo: 563, action: 'partner.created', by: 'Maya Ortiz' },
      { daysAgo: 558, action: 'partner.submitted', by: 'Maya Chen' },
      { daysAgo: 557, action: 'partner.approved', by: 'Arjun Menon', reason: 'Contract signed, KYC passed' },
    ],
  },
  {
    key: 'bz',
    name: 'Bazaar Cloud',
    kind: 'Reseller',
    region: 'India, UAE',
    country: 'IN',
    state: 'live',
    createdDaysAgo: 614,
    productName: 'Bazaar Cloud Commerce',
    primaryColor: '#0F6E5C',
    accentColor: '#F2B134',
    poweredBy: 'off',
    domain: 'bazaarcloud.example',
    portalHost: 'portal.bazaarcloud.example',
    domains: [{ kind: 'shops', host: '*.shops.bazaarcloud.example', status: 'broken', found: 'shops-old.bzhost.ae' }],
    owner: { name: 'Vikram Rao', email: 'vikram@bazaarcloud.example', role: 'partner-owner', lastSignInDaysAgo: 0, invitation: 'active' },
    team: [{ name: 'Sana Qureshi', email: 'sana@bazaarcloud.example', role: 'partner-admin', lastSignInDaysAgo: 1 }],
    setup: allDone('Vikram Rao', 'portal.bazaarcloud.example', 'mail.bazaarcloud.example'),
    plans: [
      { name: 'Starter', status: 'live', maxProducts: 250, maxStaff: 1 },
      { name: 'Growth', status: 'live', maxProducts: 2000, maxStaff: 3 },
      { name: 'Growth UAE', status: 'live', maxProducts: 2000, maxStaff: 3 },
      { name: 'Pro UAE', status: 'live', maxProducts: 5000, maxStaff: 10 },
    ],
    events: [
      { daysAgo: 614, action: 'partner.created', by: 'Maya Ortiz' },
      { daysAgo: 606, action: 'partner.submitted', by: 'Vikram Rao' },
      { daysAgo: 602, action: 'partner.approved', by: 'Arjun Menon', reason: 'Contract signed, KYC passed' },
    ],
  },
  {
    key: 'kl',
    name: 'Kaufladen Digital',
    kind: 'Payments company',
    region: 'Germany, Austria',
    country: 'DE',
    state: 'awaiting',
    createdDaysAgo: 24,
    productName: 'Kaufladen Shops',
    primaryColor: '#2A2F8F',
    accentColor: '#FFCC00',
    poweredBy: 'on',
    domain: 'kaufladen.example',
    portalHost: 'shop.kaufladen.example',
    domains: [{ kind: 'email', host: 'mail.kaufladen.example', status: 'waiting', found: null }],
    owner: { name: 'Jonas Weber', email: 'jonas@kaufladen.example', role: 'partner-owner', lastSignInDaysAgo: 2, invitation: 'active' },
    team: [{ name: 'Petra Lang', email: 'petra@kaufladen.example', role: 'partner-admin', lastSignInDaysAgo: 3 }],
    fallbackSenderAccepted: true,
    setup: [
      { item: 'company', status: 'done', detail: 'Kaufladen Digital GmbH, Berlin', by: 'Jonas Weber' },
      { item: 'branding', status: 'done', detail: 'Logo, colours and font saved', by: 'Priya Shah' },
      { item: 'portalHost', status: 'done', detail: 'shop.kaufladen.example is live', by: 'Jonas Weber' },
      { item: 'wildcards', status: 'done', detail: 'Both are live', by: 'Jonas Weber' },
      { item: 'emailSender', status: 'progress', detail: 'mail.kaufladen.example: verifying (DKIM, SPF). Emails use a fallback sender until then.' },
      { item: 'plan', status: 'done', detail: 'Basis and Plus are priced', by: 'Priya Shah' },
      { item: 'legal', status: 'done', detail: 'Terms, privacy, Impressum and data-processing agreement added', by: 'Jonas Weber' },
      { item: 'paymentMethod', status: 'done', detail: 'Card on file', by: 'Jonas Weber' },
      { item: 'payoutDetails', status: 'missing', detail: 'Add the bank account DripFunnel pays you into' },
    ],
    plans: [
      { name: 'Basis', status: 'live', maxProducts: 500, maxStaff: 2 },
      { name: 'Plus', status: 'live', maxProducts: 5000, maxStaff: 5 },
      { name: 'Enterprise', status: 'draft', maxProducts: null, maxStaff: null },
    ],
    events: [
      { daysAgo: 24, action: 'partner.created', by: 'Maya Ortiz' },
      { daysAgo: 17, action: 'partner.set_up', by: 'Priya Shah' },
      { daysAgo: 13, action: 'partner.submitted', by: 'Jonas Weber' },
      { daysAgo: 10, action: 'partner.sent_back', by: 'Maya Ortiz', reason: 'Legal pages missing an Impressum' },
      { daysAgo: 6, action: 'partner.submitted', by: 'Jonas Weber' },
    ],
  },
  {
    key: 'lt',
    name: 'Loom & Thread',
    kind: 'Marketplace operator',
    region: 'UK',
    country: 'GB',
    state: 'live',
    createdDaysAgo: 381,
    productName: 'Loom & Thread Sellers',
    primaryColor: '#5B3A29',
    accentColor: '#D9A441',
    poweredBy: 'on',
    domain: 'loomandthread.example',
    portalHost: 'sellers.loomandthread.example',
    owner: { name: 'Olivia Grant', email: 'olivia@loomandthread.example', role: 'partner-owner', lastSignInDaysAgo: 1, invitation: 'active' },
    team: [],
    setup: allDone('Olivia Grant', 'sellers.loomandthread.example', 'mail.loomandthread.example'),
    plans: [{ name: 'Marketplace', status: 'live', maxProducts: null, maxStaff: null }],
    events: [
      { daysAgo: 381, action: 'partner.created', by: 'Maya Ortiz' },
      { daysAgo: 364, action: 'partner.approved', by: 'Arjun Menon', reason: 'Contract signed, KYC passed' },
    ],
  },
  {
    key: 'ts',
    name: 'Tallis Studio',
    kind: 'Agency',
    region: 'Australia',
    country: 'AU',
    state: 'draft',
    createdDaysAgo: 7,
    productName: 'Tallis Shops',
    primaryColor: '#3D5A40',
    accentColor: '#E3B23C',
    poweredBy: 'on',
    domain: 'tallis.example',
    portalHost: 'shops.tallis.example',
    domains: [
      { kind: 'portal', host: 'shops.tallis.example', status: 'waiting', found: null },
      { kind: 'preview', host: '*.preview.tallis.example', status: 'waiting', found: null },
      { kind: 'shops', host: '*.shops.tallis.example', status: 'waiting', found: null },
      { kind: 'email', host: 'mail.tallis.example', status: 'waiting', found: null },
    ],
    owner: { name: 'Ben Tallis', email: 'ben@tallis.example', role: 'partner-owner', lastSignInDaysAgo: null, invitation: 'sent' },
    team: [],
    setup: [
      { item: 'company', status: 'done', detail: 'Tallis Studio Pty Ltd, Melbourne', by: 'Maya Ortiz' },
      { item: 'branding', status: 'missing', detail: 'Logo, colours and font' },
      { item: 'portalHost', status: 'progress', detail: 'shops.tallis.example: waiting for DNS' },
      { item: 'wildcards', status: 'missing', detail: 'Preview and shop addresses' },
      { item: 'emailSender', status: 'missing', detail: 'mail.tallis.example' },
      { item: 'plan', status: 'missing', detail: 'No plans yet' },
      { item: 'legal', status: 'missing', detail: 'Terms, privacy and data-processing agreement' },
      { item: 'paymentMethod', status: 'missing', detail: 'The card DripFunnel charges for its invoices' },
      { item: 'payoutDetails', status: 'missing', detail: 'Add the bank account DripFunnel pays you into' },
    ],
    plans: [],
    events: [{ daysAgo: 7, action: 'partner.created', by: 'Maya Ortiz' }],
  },
  {
    key: 'nl',
    name: 'Nordlicht Media',
    kind: 'Agency',
    region: 'Sweden, Norway',
    country: 'SE',
    state: 'draft',
    createdDaysAgo: 9,
    productName: 'Nordlicht Shops',
    primaryColor: '#3B2F63',
    accentColor: '#7FD1C7',
    poweredBy: 'on',
    domain: 'nordlicht.example',
    portalHost: 'shops.nordlicht.example',
    domains: [
      { kind: 'preview', host: '*.preview.nordlicht.example', status: 'waiting', found: null },
      { kind: 'shops', host: '*.shops.nordlicht.example', status: 'waiting', found: null },
      { kind: 'email', host: 'mail.nordlicht.example', status: 'waiting', found: null },
    ],
    owner: { name: 'Freya Lind', email: 'freya@nordlicht.example', role: 'partner-owner', lastSignInDaysAgo: null, invitation: 'held' },
    team: [],
    setup: [
      { item: 'company', status: 'done', detail: 'Nordlicht Media AB, Stockholm', by: 'Priya Shah' },
      { item: 'branding', status: 'done', detail: 'Logo, colours and font saved', by: 'Priya Shah' },
      { item: 'portalHost', status: 'done', detail: 'shops.nordlicht.example is live', by: 'Priya Shah' },
      { item: 'wildcards', status: 'progress', detail: '*.preview.nordlicht.example: waiting for DNS' },
      { item: 'emailSender', status: 'progress', detail: 'mail.nordlicht.example: verifying (DKIM, SPF). Emails use a fallback sender until then.' },
      { item: 'plan', status: 'missing', detail: 'No plans yet' },
      { item: 'legal', status: 'missing', detail: 'Terms, privacy and data-processing agreement' },
      { item: 'paymentMethod', status: 'missing', detail: 'The card DripFunnel charges for its invoices' },
      { item: 'payoutDetails', status: 'missing', detail: 'Add the bank account DripFunnel pays you into' },
    ],
    plans: [],
    events: [
      { daysAgo: 9, action: 'partner.created', by: 'Priya Shah' },
      { daysAgo: 8, action: 'partner.set_up', by: 'Priya Shah' },
    ],
  },
  {
    key: 'sw',
    name: 'Southwind Retail',
    kind: 'Reseller',
    region: 'South Africa',
    country: 'ZA',
    state: 'paused',
    createdDaysAgo: 290,
    productName: 'Southwind Shops',
    primaryColor: '#8A3B12',
    accentColor: '#F4D35E',
    poweredBy: 'on',
    domain: 'southwind.example',
    portalHost: 'shops.southwind.example',
    owner: { name: 'Thandi Nkosi', email: 'thandi@southwind.example', role: 'partner-owner', lastSignInDaysAgo: 12, invitation: 'active' },
    team: [],
    setup: allDone('Thandi Nkosi', 'shops.southwind.example', 'mail.southwind.example'),
    plans: [{ name: 'Standard', status: 'live', maxProducts: 1000, maxStaff: 3 }],
    pauseReason: 'Invoice 2026-07 unpaid for 60 days',
    events: [
      { daysAgo: 290, action: 'partner.created', by: 'Maya Ortiz' },
      { daysAgo: 280, action: 'partner.submitted', by: 'Thandi Nkosi' },
      { daysAgo: 278, action: 'partner.approved', by: 'Arjun Menon' },
      { daysAgo: 14, action: 'partner.paused', by: 'Arjun Menon', reason: 'Invoice 2026-07 unpaid for 60 days' },
    ],
  },
  {
    key: 'oh',
    name: 'Old Harbour Co',
    kind: 'Agency',
    region: 'Ireland',
    country: 'IE',
    state: 'offboarding',
    createdDaysAgo: 700,
    productName: 'Harbour Shops',
    primaryColor: '#1F4E5F',
    accentColor: '#9BC53D',
    poweredBy: 'on',
    domain: 'oldharbour.example',
    portalHost: 'shops.oldharbour.example',
    owner: { name: 'Ciara Byrne', email: 'ciara@oldharbour.example', role: 'partner-owner', lastSignInDaysAgo: 30, invitation: 'active' },
    team: [],
    setup: allDone('Ciara Byrne', 'shops.oldharbour.example', 'mail.oldharbour.example'),
    plans: [{ name: 'Standard', status: 'retired', maxProducts: 1000, maxStaff: 3 }],
    events: [
      { daysAgo: 700, action: 'partner.created', by: 'Arjun Menon' },
      { daysAgo: 690, action: 'partner.approved', by: 'Arjun Menon' },
      { daysAgo: 20, action: 'partner.offboarding', by: 'Arjun Menon', reason: 'Contract not renewed' },
    ],
  },
  {
    key: 'bf',
    name: 'Blue Fern',
    kind: 'Agency',
    region: 'New Zealand',
    country: 'NZ',
    state: 'closed',
    createdDaysAgo: 800,
    productName: 'Blue Fern Shops',
    primaryColor: '#2E5E4E',
    accentColor: '#A7C957',
    poweredBy: 'on',
    domain: 'bluefern.example',
    portalHost: 'shops.bluefern.example',
    owner: { name: 'Aroha Kingi', email: 'aroha@bluefern.example', role: 'partner-owner', lastSignInDaysAgo: 120, invitation: 'active' },
    team: [],
    setup: allDone('Aroha Kingi', 'shops.bluefern.example', 'mail.bluefern.example'),
    plans: [],
    events: [
      { daysAgo: 800, action: 'partner.created', by: 'Arjun Menon' },
      { daysAgo: 790, action: 'partner.approved', by: 'Arjun Menon' },
      { daysAgo: 150, action: 'partner.offboarding', by: 'Arjun Menon', reason: 'Business wound down' },
      { daysAgo: 100, action: 'partner.closed', by: 'Arjun Menon' },
    ],
  },
]

/** The four hostnames every partner has (SAAS.md §3.5), live unless the partner says otherwise. */
export const domainsFor = (p: SeedPartner): SeedDomain[] => {
  const standard: SeedDomain[] = [
    { kind: 'portal', host: p.portalHost, status: 'live' },
    { kind: 'preview', host: `*.preview.${p.domain}`, status: 'live' },
    { kind: 'shops', host: `*.shops.${p.domain}`, status: 'live' },
    { kind: 'email', host: `mail.${p.domain}`, status: 'live' },
  ]
  return standard.map((d) => p.domains?.find((o) => o.kind === d.kind) ?? d)
}

export interface SeedPerson {
  name: string
  email: string
  role: 'owner' | 'manager' | 'staff' | 'supplier-admin' | 'supplier-member'
  status: 'active' | 'invited' | 'suspended'
  lastSignInDaysAgo: number | null
  supplier?: string
}

export interface SeedStoreEvent {
  daysAgo: number
  action: 'store.trial_started' | 'store.activated' | 'store.past_due' | 'store.suspended' | 'store.restored' | 'store.cancelled' | 'store.trial_extended'
  by: string | null
  reason?: string
}

export interface SeedStore {
  key: string
  name: string
  code: string
  partner: string
  country: string
  plan: string
  status: StoreStatus
  createdDaysAgo: number
  trialEndsInDays?: number
  pastDueDays?: number
  suspended?: { reason: string; by: string; previous: 'trial' | 'active' | 'past_due'; daysAgo: number }
  cancelledDaysAgo?: number
  storefront?: 'own' | BuildState
  coreVersion?: string
  built?: boolean
  customDomain?: { host: string; status: HostStatus }
  job?: { state: 'running' | 'failed'; step: ProvisioningStep; attempts: number; minutesAgo: number; stepMinutesAgo: number; error?: string; details?: string }
  people: SeedPerson[]
  suppliers?: string[]
  supportAccess?: boolean
  notes?: { by: string; text: string; minutesAgo: number }[]
  events: SeedStoreEvent[]
}

const owner = (name: string, email: string, days = 0): SeedPerson => ({ name, email, role: 'owner', status: 'active', lastSignInDaysAgo: days })

export const stores: readonly SeedStore[] = [
  {
    key: 's1',
    name: 'Mehta Textiles',
    code: 'mehta-textiles',
    partner: 'bz',
    country: 'IN',
    plan: 'Growth',
    status: 'active',
    createdDaysAgo: 474,
    coreVersion: 'v48',
    built: true,
    customDomain: { host: 'mehtatextiles.example', status: 'live' },
    suppliers: ['Kaveri Weaves', 'Anand Looms', 'Surat Silks'],
    people: [
      owner('Priya Mehta', 'priya@mehtatextiles.example'),
      { name: 'Rohan Verma', email: 'rohan@mehtatextiles.example', role: 'manager', status: 'active', lastSignInDaysAgo: 0 },
      { name: 'Dev Patel', email: 'dev@mehtatextiles.example', role: 'staff', status: 'active', lastSignInDaysAgo: 1 },
      { name: 'Aisha Khan', email: 'aisha@mehtatextiles.example', role: 'staff', status: 'invited', lastSignInDaysAgo: null },
      { name: 'Lakshmi Iyer', email: 'lakshmi@kaveriweaves.example', role: 'supplier-admin', status: 'active', lastSignInDaysAgo: 2, supplier: 'Kaveri Weaves' },
    ],
    events: [
      { daysAgo: 474, action: 'store.trial_started', by: null },
      { daysAgo: 464, action: 'store.activated', by: null },
    ],
  },
  {
    key: 's2',
    name: 'Harbor Coffee Co.',
    code: 'harbor-coffee',
    partner: 'ns',
    country: 'US',
    plan: 'Growth',
    status: 'trial',
    createdDaysAgo: 13,
    trialEndsInDays: 1,
    coreVersion: 'v6',
    built: true,
    people: [owner('Jenna Park', 'jenna@harborcoffee.example'), { name: 'Tom Nguyen', email: 'tom@harborcoffee.example', role: 'staff', status: 'active', lastSignInDaysAgo: 2 }],
    events: [{ daysAgo: 13, action: 'store.trial_started', by: null }],
  },
  {
    key: 's3',
    name: 'Kiko Kids',
    code: 'kiko-kids',
    partner: 'bz',
    country: 'AE',
    plan: 'Growth UAE',
    status: 'past_due',
    createdDaysAgo: 330,
    pastDueDays: 9,
    coreVersion: 'v21',
    built: true,
    customDomain: { host: 'kikokids.example', status: 'live' },
    people: [owner('Fatima Al Nuaimi', 'fatima@kikokids.example'), { name: 'Omar Haddad', email: 'omar@kikokids.example', role: 'manager', status: 'active', lastSignInDaysAgo: 1 }],
    notes: [{ by: 'priya', text: 'Merchant says the card was replaced. Walking her to Billing → Card in the session.', minutesAgo: 90 }],
    events: [
      { daysAgo: 330, action: 'store.trial_started', by: null },
      { daysAgo: 320, action: 'store.activated', by: null },
      { daysAgo: 9, action: 'store.past_due', by: null, reason: '3 failed payments' },
    ],
  },
  {
    key: 's4',
    name: 'Redline Moto Parts',
    code: 'redline-moto',
    partner: 'ns',
    country: 'US',
    plan: 'Pro',
    status: 'suspended',
    createdDaysAgo: 405,
    suspended: { reason: 'Chargeback', by: 'Arjun Menon', previous: 'active', daysAgo: 4 },
    coreVersion: 'v33',
    built: true,
    people: [owner('Dale Kowalski', 'dale@redlinemoto.example', 4), { name: 'Ben Ortiz', email: 'ben@redlinemoto.example', role: 'staff', status: 'suspended', lastSignInDaysAgo: 8 }],
    notes: [{ by: 'arjun', text: 'Card network notice CB-2291. Waiting for the merchant’s evidence before we restore.', minutesAgo: 4 * 24 * 60 }],
    events: [
      { daysAgo: 405, action: 'store.trial_started', by: null },
      { daysAgo: 395, action: 'store.activated', by: null },
      { daysAgo: 4, action: 'store.suspended', by: 'Arjun Menon', reason: 'Chargeback' },
    ],
  },
  {
    key: 's5',
    name: 'Fjord Outdoor',
    code: 'fjord-outdoor',
    partner: 'df',
    country: 'NO',
    plan: 'Growth',
    status: 'trial',
    createdDaysAgo: 0,
    trialEndsInDays: 14,
    storefront: 'building',
    job: {
      state: 'running',
      step: 'firstBuild',
      attempts: 2,
      minutesAgo: 110,
      stepMinutesAgo: 48,
      error: 'The first storefront build has been running for 48 minutes. It usually takes under 5.',
      details: 'build bld_7Qx2 state=running runner=eu-2 last_log="Installing theme dependencies"',
    },
    people: [owner('Ingrid Solberg', 'ingrid@fjordoutdoor.example')],
    events: [{ daysAgo: 0, action: 'store.trial_started', by: null }],
  },
  {
    key: 's6',
    name: 'Maple & Pine Home',
    code: 'maple-pine',
    partner: 'ns',
    country: 'CA',
    plan: 'Growth',
    status: 'active',
    createdDaysAgo: 178,
    coreVersion: 'v17',
    built: true,
    customDomain: { host: 'shop.mapleandpine.example', status: 'waiting' },
    people: [owner('Chloé Tremblay', 'chloe@mapleandpine.example', 1)],
    events: [
      { daysAgo: 178, action: 'store.trial_started', by: null },
      { daysAgo: 168, action: 'store.activated', by: null },
    ],
  },
  {
    key: 's7',
    name: 'Atelier Nove',
    code: 'atelier-nove',
    partner: 'df',
    country: 'IT',
    plan: 'Growth Pro',
    status: 'active',
    createdDaysAgo: 293,
    storefront: 'own',
    customDomain: { host: 'ateliernove.example', status: 'live' },
    supportAccess: false,
    people: [owner('Giulia Conti', 'giulia@ateliernove.example')],
    events: [
      { daysAgo: 293, action: 'store.trial_started', by: null },
      { daysAgo: 283, action: 'store.activated', by: null },
    ],
  },
  {
    key: 's8',
    name: 'Loom & Thread',
    code: 'loom-thread',
    partner: 'lt',
    country: 'GB',
    plan: 'Marketplace',
    status: 'active',
    createdDaysAgo: 362,
    coreVersion: 'v112',
    built: true,
    customDomain: { host: 'loomandthread.example', status: 'live' },
    suppliers: ['Northwind Wool', 'Hebden Dyeworks'],
    people: [
      owner('Olivia Grant', 'olivia@loomandthread.example', 1),
      { name: 'Hannah Cole', email: 'hannah@northwindwool.example', role: 'supplier-admin', status: 'active', lastSignInDaysAgo: 0, supplier: 'Northwind Wool' },
    ],
    events: [{ daysAgo: 362, action: 'store.activated', by: null }],
  },
  {
    key: 's9',
    name: 'Saffron Street',
    code: 'saffron-street',
    partner: 'bz',
    country: 'IN',
    plan: 'Starter',
    status: 'active',
    createdDaysAgo: 5,
    coreVersion: 'v3',
    built: true,
    people: [owner('Kavya Iyer', 'kavya@saffronstreet.example', 1)],
    events: [{ daysAgo: 5, action: 'store.activated', by: null }],
  },
  {
    key: 's10',
    name: 'Brightside Pets',
    code: 'brightside-pets',
    partner: 'df',
    country: 'US',
    plan: 'Growth',
    status: 'cancelled',
    createdDaysAgo: 496,
    cancelledDaysAgo: 26,
    coreVersion: 'v9',
    built: true,
    people: [owner('Tanya Brooks', 'tanya@brightsidepets.example', 26)],
    events: [
      { daysAgo: 496, action: 'store.trial_started', by: null },
      { daysAgo: 486, action: 'store.activated', by: null },
      { daysAgo: 26, action: 'store.cancelled', by: 'Tanya Brooks' },
    ],
  },
  {
    key: 's11',
    name: 'Oud House',
    code: 'oud-house',
    partner: 'bz',
    country: 'AE',
    plan: 'Pro UAE',
    status: 'active',
    createdDaysAgo: 226,
    coreVersion: 'v27',
    built: true,
    customDomain: { host: 'oudhouse.example', status: 'live' },
    people: [owner('Khalid Rahman', 'khalid@oudhouse.example')],
    events: [
      { daysAgo: 226, action: 'store.trial_started', by: null },
      { daysAgo: 216, action: 'store.activated', by: null },
    ],
  },
  {
    key: 's12',
    name: 'Grünwerk',
    code: 'gruenwerk',
    partner: 'kl',
    country: 'DE',
    plan: 'Plus',
    status: 'trial',
    createdDaysAgo: 2,
    trialEndsInDays: 8,
    coreVersion: 'v2',
    built: true,
    people: [owner('Lea Braun', 'lea@gruenwerk.example', 1)],
    events: [{ daysAgo: 2, action: 'store.trial_started', by: null }],
  },
  {
    key: 's13',
    name: 'Peak Supply Co.',
    code: 'peak-supply',
    partner: 'df',
    country: 'US',
    plan: 'Growth',
    status: 'trial',
    createdDaysAgo: 0,
    trialEndsInDays: 14,
    storefront: 'failed',
    job: {
      state: 'failed',
      step: 'repo',
      attempts: 2,
      minutesAgo: 170,
      stepMinutesAgo: 165,
      error: 'GitHub didn’t respond while creating the storefront.',
      details: 'POST https://api.github.com/orgs/df-shops/repos → 502 Bad Gateway after 30s (request 9C1E:4A2B:1F0E)',
    },
    people: [owner('Owen Hart', 'owen@peaksupply.example')],
    events: [{ daysAgo: 0, action: 'store.trial_started', by: null }],
  },
  {
    key: 's14',
    name: 'Tidewater Surf',
    code: 'tidewater-surf',
    partner: 'ns',
    country: 'US',
    plan: 'Starter',
    status: 'trial',
    createdDaysAgo: 0,
    trialEndsInDays: 14,
    storefront: 'own',
    job: { state: 'running', step: 'hostnames', attempts: 1, minutesAgo: 1, stepMinutesAgo: 1 },
    people: [owner('Marco Silva', 'marco@tidewatersurf.example')],
    events: [{ daysAgo: 0, action: 'store.trial_started', by: null }],
  },
  {
    key: 's15',
    name: 'Juniper & Co.',
    code: 'juniper-co',
    partner: 'ns',
    country: 'US',
    plan: 'Pro',
    status: 'active',
    createdDaysAgo: 305,
    coreVersion: 'v31',
    built: true,
    customDomain: { host: 'juniperco.example', status: 'live' },
    suppliers: ['Loomcraft', 'Cedar Mills', 'Harbor Candles', 'Pine & Co'],
    people: [
      owner('Anjali Nair', 'anjali@juniperco.example'),
      { name: 'Priya Mehta', email: 'priya.mehta@loomcraft.example', role: 'supplier-admin', status: 'active', lastSignInDaysAgo: 0, supplier: 'Loomcraft' },
      { name: 'Farhan Ali', email: 'farhan@loomcraft.example', role: 'supplier-member', status: 'active', lastSignInDaysAgo: 3, supplier: 'Loomcraft' },
    ],
    events: [
      { daysAgo: 305, action: 'store.trial_started', by: null },
      { daysAgo: 295, action: 'store.activated', by: null },
    ],
  },
  {
    key: 's16',
    name: 'Cobalt Kitchen',
    code: 'cobalt-kitchen',
    partner: 'ns',
    country: 'US',
    plan: 'Growth',
    status: 'trial',
    createdDaysAgo: 12,
    trialEndsInDays: 2,
    coreVersion: 'v4',
    built: true,
    people: [owner('Marcus Bell', 'marcus@cobaltkitchen.example', 1)],
    events: [
      { daysAgo: 12, action: 'store.trial_started', by: null },
      { daysAgo: 3, action: 'store.trial_extended', by: 'Maya Chen', reason: 'Owner travelling' },
    ],
  },
  {
    key: 's17',
    name: 'Harbour Books',
    code: 'harbour-books',
    partner: 'oh',
    country: 'IE',
    plan: 'Standard',
    status: 'active',
    createdDaysAgo: 600,
    coreVersion: 'v40',
    built: true,
    people: [owner('Niamh Walsh', 'niamh@harbourbooks.example', 9)],
    events: [{ daysAgo: 600, action: 'store.activated', by: null }],
  },
  {
    key: 's18',
    name: 'Cape Fynbos',
    code: 'cape-fynbos',
    partner: 'sw',
    country: 'ZA',
    plan: 'Standard',
    status: 'active',
    createdDaysAgo: 200,
    coreVersion: 'v22',
    built: true,
    people: [owner('Sipho Dlamini', 'sipho@capefynbos.example', 2)],
    events: [{ daysAgo: 200, action: 'store.activated', by: null }],
  },
]

/** Filler so lists page: Northstar, Bazaar Cloud and the house partner get a spread of stores. */
export interface GeneratedSpec {
  partner: string
  count: number
  plans: string[]
  country: string
  domain: string
}

export const generated: readonly GeneratedSpec[] = [
  { partner: 'ns', count: 40, plans: ['Starter', 'Growth', 'Pro'], country: 'US', domain: 'northstar.example' },
  { partner: 'bz', count: 25, plans: ['Starter', 'Growth'], country: 'IN', domain: 'bazaarcloud.example' },
  { partner: 'df', count: 20, plans: ['Starter', 'Growth', 'Growth Pro'], country: 'IN', domain: 'dripfunnel.example' },
]

const words = ['Amber', 'Birch', 'Cedar', 'Delta', 'Ember', 'Fable', 'Granite', 'Harbor', 'Iris', 'Juniper', 'Kestrel', 'Lumen', 'Marble', 'Nimbus', 'Opal', 'Pebble', 'Quill', 'Ridge', 'Sable', 'Tundra']
const trades = ['Goods', 'Supply', 'Market', 'Studio', 'Works', 'Trading', 'Provisions', 'Outfitters']

export const generatedName = (partner: string, index: number): { name: string; code: string } => {
  const word = words[index % words.length] ?? 'Store'
  const trade = trades[Math.floor(index / words.length) % trades.length] ?? 'Goods'
  const name = `${word} ${trade}`
  return { name, code: `${name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}-${partner}` }
}

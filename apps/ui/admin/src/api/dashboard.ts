// The Dashboard's one query: `dashboard(partnerId)` on the Admin API (FIRST-RELEASE.md §3, §12).
// Every number here is the API's; the screen only formats and links them (ui/README §3).
import { harnessEnabled } from '../features/common/useScreenState'

export const partnerStates = ['live', 'awaiting', 'draft', 'paused'] as const
export type PartnerState = (typeof partnerStates)[number]

export const setupSteps = ['account', 'store', 'defaults', 'hostnames', 'repo', 'firstBuild'] as const
export type SetupStep = (typeof setupSteps)[number]

export interface PartnerOption {
  id: string
  name: string
}

export type AttentionReason =
  | { kind: 'pastDue'; daysPastDue: number }
  | { kind: 'suspended'; reason: string }
  | { kind: 'setup'; state: 'failed' | 'stuck'; step: SetupStep; attempt: number }

export interface AttentionStore {
  id: string
  name: string
  partnerName: string
  reason: AttentionReason
}

export interface DashboardData {
  // The filter the API applied: null for all partners, including when the one asked for is unknown.
  partnerId: string | null
  partnerOptions: readonly PartnerOption[]
  asOf: string
  staleSince: string | null
  partners: Record<PartnerState, number>
  awaiting: {
    count: number
    oldest: { id: string; name: string; submittedAt: string; waitingSeconds: number } | null
  }
  stores: {
    total: number
    newThisWeek: number
    // At most five, largest first; the API sorts and caps it.
    newThisWeekByPartner: readonly (PartnerOption & { count: number })[]
  }
  attention: {
    pastDue: number
    suspended: number
    setupFailed: number
    setupStuck: number
    // Every store needing attention; `stores` holds at most attentionListMax of them, most
    // urgent first, and the API sorts and caps it.
    total: number
    stores: readonly AttentionStore[]
  }
  signups: { started: number; completed: number; failed: number; medianSecondsToReady: number | null }
}

export const attentionListMax = 5

// The prototype's sample platform (designs/admin-data.js), as the API would count it.
export interface SamplePartner extends PartnerOption {
  state: PartnerState
  stores: number
  newThisWeek: number
  signups: [started: number, completed: number, failed: number]
  medianSecondsToReady: number | null
  submittedAt?: string
  waitingSeconds?: number
}

export type SampleAttention = AttentionStore & { partnerId: string }

const samplePartners: readonly SamplePartner[] = [
  { id: 'df', name: 'DripFunnel', state: 'live', stores: 1240, newThisWeek: 38, signups: [41, 38, 1], medianSecondsToReady: 350 },
  { id: 'ns', name: 'Northstar Commerce', state: 'live', stores: 86, newThisWeek: 6, signups: [9, 7, 0], medianSecondsToReady: 380 },
  { id: 'bz', name: 'Bazaar Cloud', state: 'live', stores: 312, newThisWeek: 21, signups: [23, 22, 1], medianSecondsToReady: 425 },
  {
    id: 'kl',
    name: 'Kaufladen Digital',
    state: 'awaiting',
    stores: 40,
    newThisWeek: 0,
    signups: [0, 0, 0],
    medianSecondsToReady: null,
    submittedAt: '2026-09-26T09:40:00Z',
    waitingSeconds: 176_520,
  },
  { id: 'lt', name: 'Loom & Thread', state: 'live', stores: 1, newThisWeek: 0, signups: [0, 0, 0], medianSecondsToReady: null },
  { id: 'ts', name: 'Tallis Studio', state: 'draft', stores: 0, newThisWeek: 0, signups: [0, 0, 0], medianSecondsToReady: null },
  { id: 'nl', name: 'Nordlicht Media', state: 'draft', stores: 0, newThisWeek: 0, signups: [0, 0, 0], medianSecondsToReady: null },
]

const sampleAttention: readonly SampleAttention[] = [
  { id: 's3', name: 'Kiko Kids', partnerId: 'bz', partnerName: 'Bazaar Cloud', reason: { kind: 'pastDue', daysPastDue: 9 } },
  { id: 's4', name: 'Redline Moto Parts', partnerId: 'ns', partnerName: 'Northstar Commerce', reason: { kind: 'suspended', reason: 'Chargeback' } },
  { id: 's5', name: 'Fjord Outdoor', partnerId: 'df', partnerName: 'DripFunnel', reason: { kind: 'setup', state: 'stuck', step: 'firstBuild', attempt: 2 } },
  { id: 's13', name: 'Peak Supply Co.', partnerId: 'df', partnerName: 'DripFunnel', reason: { kind: 'setup', state: 'failed', step: 'repo', attempt: 2 } },
]

const allPartnersMedianSeconds = 372

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0)

// Stands in for the server, so the counting happens here and never in a component.
export const countSample = (
  sample: { partners: readonly SamplePartner[]; attention: readonly SampleAttention[] },
  partnerId: string | undefined,
): DashboardData => {
  const known = sample.partners.find((partner) => partner.id === partnerId)
  const partners = known ? [known] : sample.partners
  const attention = sample.attention.filter((store) => !known || store.partnerId === known.id)
  const awaiting = partners.filter((partner) => partner.state === 'awaiting')
  // ISO timestamps in UTC sort as text, so the first is the earliest submission.
  const oldest = awaiting
    .filter((partner) => partner.submittedAt !== undefined)
    .sort((a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''))[0]
  const countAttention = (test: (reason: AttentionReason) => boolean) =>
    attention.filter((store) => test(store.reason)).length
  return {
    partnerId: known?.id ?? null,
    partnerOptions: sample.partners.map(({ id, name }) => ({ id, name })),
    asOf: '2026-09-28T10:42:00Z',
    staleSince: null,
    partners: {
      live: partners.filter((partner) => partner.state === 'live').length,
      awaiting: awaiting.length,
      draft: partners.filter((partner) => partner.state === 'draft').length,
      paused: partners.filter((partner) => partner.state === 'paused').length,
    },
    awaiting: {
      count: awaiting.length,
      oldest:
        oldest?.submittedAt && oldest.waitingSeconds !== undefined
          ? { id: oldest.id, name: oldest.name, submittedAt: oldest.submittedAt, waitingSeconds: oldest.waitingSeconds }
          : null,
    },
    stores: {
      total: sum(partners.map((partner) => partner.stores)),
      newThisWeek: sum(partners.map((partner) => partner.newThisWeek)),
      newThisWeekByPartner: [...partners]
        .sort((a, b) => b.newThisWeek - a.newThisWeek)
        .slice(0, 5)
        .map(({ id, name, newThisWeek }) => ({ id, name, count: newThisWeek })),
    },
    attention: {
      pastDue: countAttention((reason) => reason.kind === 'pastDue'),
      suspended: countAttention((reason) => reason.kind === 'suspended'),
      setupFailed: countAttention((reason) => reason.kind === 'setup' && reason.state === 'failed'),
      setupStuck: countAttention((reason) => reason.kind === 'setup' && reason.state === 'stuck'),
      total: attention.length,
      stores: attention.slice(0, attentionListMax).map(({ id, name, partnerName, reason }) => ({ id, name, partnerName, reason })),
    },
    signups: {
      started: sum(partners.map((partner) => partner.signups[0])),
      completed: sum(partners.map((partner) => partner.signups[1])),
      failed: sum(partners.map((partner) => partner.signups[2])),
      medianSecondsToReady: known ? known.medianSecondsToReady : allPartnersMedianSeconds,
    },
  }
}

// Seam: replace the sample with the Admin API's `dashboard(partnerId)` query through
// createApiClient from @dripfunnel/shared/graphql once it exists (FIRST-RELEASE.md §12,
// https://github.com/dripfunnel/platform/issues/13). The fields above are what it must return.
// The sample is invented, so it appears only where the ?state= harness does; a production
// build shows the error state until the query exists, never made-up numbers as real ones.
export const loadDashboard = (partnerId: string | undefined): Promise<DashboardData> =>
  harnessEnabled
    ? Promise.resolve(countSample({ partners: samplePartners, attention: sampleAttention }, partnerId))
    : Promise.reject(new Error('The Admin API has no dashboard query yet (#13).'))

import type { ActivityEntry } from '../../api/activity'

// Entries as the Platform API answers them for a partner (LOGGING.md §6): its team, DripFunnel
// staff on its account, a setup session, support acting as a team member, and an account event.
const base = { category: 'write', result: 'success' as const, onBehalfOf: null, through: null, storeId: null, storeName: null, target: null, changes: [], reason: null }

export const entries: ActivityEntry[] = [
  { ...base, id: 'e1', at: '2026-10-04T09:12:00.000Z', action: 'store.trial_extended', actor: { kind: 'partner_user', id: 'pu1', label: 'Maya Chen <maya@northstar.example>' }, storeId: 's1', storeName: 'Lumen Candle Co.', target: { type: 'store', id: 's1', label: 'Lumen Candle Co.' }, changes: [{ field: 'trial_ends_at', before: '2026-10-01', after: '2026-10-08' }], reason: 'customer request' },
  { ...base, id: 'e2', at: '2026-10-04T08:00:00.000Z', action: 'plan.updated', actor: { kind: 'staff', id: 'st1', label: 'Priya Shah <priya@softobotics.example>' }, through: 'setup_session', target: { type: 'plan', id: 'p1', label: 'Growth' } },
  { ...base, id: 'e3', at: '2026-10-03T17:30:00.000Z', action: 'partner_user.invited', actor: { kind: 'partner_user', id: 'pu2', label: 'Diego Alvarez <diego@northstar.example>' }, onBehalfOf: 'Neha Rao <neha@softobotics.example>', through: 'impersonation', target: { type: 'partner_user', id: 'pu9', label: 'sam@northstar.example' } },
  { ...base, id: 'e4', at: '2026-10-03T12:00:00.000Z', action: 'store.suspended', result: 'denied', actor: { kind: 'partner_user', id: 'pu3', label: 'Jess Moreno <jess@northstar.example>' }, storeId: 's1', storeName: 'Lumen Candle Co.', target: { type: 'store', id: 's1', label: 'Lumen Candle Co.' } },
  { ...base, id: 'e5', at: '2026-10-02T06:00:00.000Z', category: 'system', action: 'partner.domain_checked', actor: { kind: 'job', id: null, label: null } },
]

export const stores = [{ id: 's1', name: 'Lumen Candle Co.' }]

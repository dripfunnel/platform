import type { AgentKind, PartnerRow, PartnerState } from '#db/schema/saas'
import { updatePartnerState } from '#db/scoped/partners'
import type { ScopedSql } from '#db/scoped/index'

// SAAS.md §3.1: Draft → Awaiting approval → Live → Paused ⇄ Live → Offboarding → Closed, and
// Awaiting approval back to Draft when sent back. The house partner is never paused,
// offboarded or closed.
export const partnerTransitions: Readonly<Record<PartnerState, readonly PartnerState[]>> = {
  draft: ['awaiting'],
  awaiting: ['live', 'draft'],
  live: ['paused', 'offboarding'],
  paused: ['live', 'offboarding'],
  offboarding: ['closed'],
  closed: [],
}

export const canTransitionPartner = (from: PartnerState, to: PartnerState): boolean => partnerTransitions[from].includes(to)

export type PartnerTransition =
  | { to: 'awaiting'; by: { kind: AgentKind; label: string } }
  | { to: 'draft'; reason: string }
  | { to: 'live' }
  | { to: 'paused'; reason: string }
  | { to: 'offboarding' }
  | { to: 'closed' }

export type PartnerTransitionRefusal = 'INVALID_TRANSITION' | 'HOUSE_PARTNER' | 'REASON_REQUIRED'

export type PartnerTransitionResult = { ok: true } | { ok: false; code: PartnerTransitionRefusal }

/** Writes the state and the facts that go with it; the activity entry is the caller's (LOGGING.md §5). */
export const transitionPartner = async (tx: ScopedSql, partner: PartnerRow, change: PartnerTransition, now: Date): Promise<PartnerTransitionResult> => {
  if (!canTransitionPartner(partner.state, change.to)) return { ok: false, code: 'INVALID_TRANSITION' }
  if (partner.is_house && (change.to === 'paused' || change.to === 'offboarding' || change.to === 'closed')) return { ok: false, code: 'HOUSE_PARTNER' }
  if ((change.to === 'draft' || change.to === 'paused') && change.reason.trim() === '') return { ok: false, code: 'REASON_REQUIRED' }

  switch (change.to) {
    case 'awaiting':
      await updatePartnerState(tx, partner.id, { state: 'awaiting', submittedAt: now, submittedByKind: change.by.kind, submittedByLabel: change.by.label, sentBackReason: null })
      break
    case 'draft':
      await updatePartnerState(tx, partner.id, { state: 'draft', sentBackReason: change.reason })
      break
    case 'live':
      await updatePartnerState(tx, partner.id, { state: 'live', approvedAt: partner.approved_at ?? now, sentBackReason: null, pausedAt: null, pauseReason: null })
      break
    case 'paused':
      await updatePartnerState(tx, partner.id, { state: 'paused', pausedAt: now, pauseReason: change.reason })
      break
    case 'offboarding':
    case 'closed':
      await updatePartnerState(tx, partner.id, { state: change.to })
      break
  }
  return { ok: true }
}

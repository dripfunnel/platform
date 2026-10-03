import type { ActivityLog, RequestFacts } from '#auth/activity'
import type { PartnerCaller, PartnerConsoleState } from '#auth/partnerCaller'
import { partnerRoleHas } from '#auth/partnerPermissions'
import type { PartnerSetupItemRow } from '#db/schema/saas'
import { partnerEntry } from '#saas/activity/index'
import { withScope, withSystemScope, type ScopedSql } from '#db/scoped/index'
import { searchPartnerStores, selectNavCounts, selectOpenSetupSessionOn, selectShellFacts, type StoreSearchRow } from '#db/scoped/partnerConsole'
import { selectPartner, selectPartnerDomainsFor, selectPartnerForUpdate, selectPlansFor, selectSetupItemsFor } from '#db/scoped/partners'
import type postgres from 'postgres'
import { failingChecks, goLiveChecksFor, transitionPartner, type GoLiveCheck, type GoLiveChecks } from '#saas/partners/index'
import { stuckAfterMinutes } from '#saas/provisioning/index'

// The partner console's shell and Home until Live (ui/platform/FIRST-RELEASE.md §2, §4; card
// #158). Every read runs as the caller's partner; nothing here takes a partner id from a request.

export const checklistItems = ['company', 'branding', 'portalHost', 'wildcards', 'emailSender', 'plan', 'legal', 'paymentMethod', 'payoutDetails', 'testSignup'] as const
export type ChecklistItem = (typeof checklistItems)[number]
export type ConsoleLink = '/settings' | '/branding' | '/domains' | '/plans' | '/dashboard'

// Where each item is finished, which is also where a sent-back fix sends the partner.
const linkFor: Record<ChecklistItem, ConsoleLink> = {
  company: '/settings',
  branding: '/branding',
  portalHost: '/domains',
  wildcards: '/domains',
  emailSender: '/domains',
  plan: '/plans',
  legal: '/branding',
  paymentMethod: '/settings',
  payoutDetails: '/settings',
  testSignup: '/dashboard',
}

// The item a failing go-live check is fixed on, which is what a sent-back partner is shown.
const itemForCheck: Record<GoLiveCheck, ChecklistItem> = { portalHost: 'portalHost', emailDomain: 'emailSender', pricedPlan: 'plan', legalPages: 'legal', testSignup: 'testSignup' }

// SAAS §3.2 step 5: the partner's own, never done by staff, never a go-live check.
const partnerOnlyItems: readonly ChecklistItem[] = ['paymentMethod', 'payoutDetails']

export const searchLimit = 8
export const submitAudit = 'partner.submitted'

export interface PartnerStateFacts {
  state: PartnerConsoleState
  sentBackReason: string | null
  pausedAt: Date | null
  pauseReason: string | null
  storeCount: number
  /** Portal or email sender hosts whose records stopped pointing at DripFunnel (§2.3). */
  brokenHosts: string[]
  setupSession: { staffName: string; endsAt: Date } | null
}

export interface NavBadges {
  storesAttention: number
  brandingSetupLeft: number
  domainsWaiting: number
  /** Zero until merchant payments exist (#201). */
  billingFailedPayments: number
  /** Zero until support sessions exist (#202). */
  supportOpenSessions: number
}

export interface OnboardingItem {
  key: ChecklistItem
  status: PartnerSetupItemRow['status']
  detail: string | null
  /** "DripFunnel" for a staff setup session, else the team member's first name. */
  doneBy: string | null
  to: ConsoleLink
}

export interface Onboarding {
  items: OnboardingItem[]
  checks: GoLiveChecks
  fallbackSenderAccepted: boolean
  submittedAt: Date | null
  submittedBy: 'partner' | 'DripFunnel' | null
  sentBackReason: string | null
  fixes: { item: ChecklistItem; to: ConsoleLink }[]
  canSubmit: { allowed: true } | { allowed: false; reason: 'OWNERS_AND_ADMINS_ONLY' | SubmittedCode }
}

/** Awaiting is submitted; Live, Paused and Offboarding were approved (SAAS §3.1). A closed partner has no session. */
type SubmittedCode = 'ALREADY_SUBMITTED' | 'ALREADY_APPROVED'
const submittedCode = (state: string): SubmittedCode => (state === 'awaiting' ? 'ALREADY_SUBMITTED' : 'ALREADY_APPROVED')

export type SubmitResult = { ok: true; submittedAt: Date } | { ok: false; code: SubmittedCode } | { ok: false; code: 'GO_LIVE_CHECK_FAILED'; check: GoLiveCheck }

export interface PartnerConsoleDeps {
  sql: postgres.Sql
  caller: PartnerCaller
  facts: RequestFacts
  activity: ActivityLog
  now: () => Date
}

const firstName = (label: string | null): string | null => label?.trim().split(/\s+/)[0] ?? null

export const createPartnerConsoleService = ({ sql, caller, facts, activity, now }: PartnerConsoleDeps) => {
  const partnerId = caller.partner.id
  const context = { caller: { kind: 'partner-user' as const, partnerUserId: caller.user.id }, partnerId }

  const partnerState = async (): Promise<PartnerStateFacts> => {
    const shell = await withScope(sql, context, async (tx) => ({ facts: await selectShellFacts(tx, partnerId), partner: await selectPartner(tx, partnerId) }))
    // Setup sessions are staff rows the partner role is not granted; this one fact is read for it.
    const session = await withSystemScope(sql, (tx) => selectOpenSetupSessionOn(tx, partnerId, now()))
    return {
      state: caller.partner.state,
      sentBackReason: shell.partner?.sent_back_reason ?? null,
      pausedAt: shell.partner?.paused_at ?? null,
      pauseReason: shell.partner?.pause_reason ?? null,
      storeCount: shell.facts.store_count,
      brokenHosts: shell.facts.broken_hosts,
      setupSession: session ? { staffName: firstName(session.staff_name) ?? session.staff_name, endsAt: session.expires_at } : null,
    }
  }

  const navBadges = async (): Promise<NavBadges> => {
    const counts = await withScope(sql, context, (tx) => selectNavCounts(tx, partnerId, stuckAfterMinutes, now()))
    return { storesAttention: counts.stores_attention, brandingSetupLeft: counts.branding_left, domainsWaiting: counts.domains_waiting, billingFailedPayments: 0, supportOpenSessions: 0 }
  }

  const search = async (query: string): Promise<StoreSearchRow[]> => {
    const term = query.trim().slice(0, 100)
    if (term.length < 2) return []
    return withScope(sql, context, (tx) => searchPartnerStores(tx, partnerId, term, searchLimit))
  }

  const onboardingFrom = async (tx: ScopedSql): Promise<Onboarding | null> => {
    const partner = await selectPartner(tx, partnerId)
    if (!partner) return null
    const [rows, domains, plans] = await Promise.all([selectSetupItemsFor(tx, [partnerId]), selectPartnerDomainsFor(tx, [partnerId]), selectPlansFor(tx, [partnerId])])
    const items = checklistItems.map((key): OnboardingItem => {
      const row = rows.find((r) => r.item === key)
      // A payment item a staff session marked done reads as not done: only the partner enters them.
      const staffDidPartnerItem = row?.done_by_kind === 'staff' && partnerOnlyItems.includes(key)
      const status = !row || staffDidPartnerItem ? 'missing' : row.status
      const doneBy = status !== 'done' ? null : row?.done_by_kind === 'staff' ? 'DripFunnel' : firstName(row?.done_by_label ?? null)
      return { key, status, detail: staffDidPartnerItem ? null : (row?.detail ?? null), doneBy, to: linkFor[key] }
    })
    const submitted = partner.state !== 'draft'
    const may = partnerRoleHas(caller.user.role, 'onboarding.submit')
    const checks = goLiveChecksFor(domains, items.map((i) => ({ item: i.key, status: i.status })), plans, partner.fallback_sender_accepted)
    return {
      items,
      checks,
      fallbackSenderAccepted: partner.fallback_sender_accepted,
      submittedAt: partner.submitted_at,
      submittedBy: partner.submitted_by_kind === null ? null : partner.submitted_by_kind === 'staff' ? 'DripFunnel' : 'partner',
      sentBackReason: partner.sent_back_reason,
      fixes: partner.sent_back_reason ? failingChecks(checks).map((check) => ({ item: itemForCheck[check], to: linkFor[itemForCheck[check]] })) : [],
      canSubmit: !may ? { allowed: false, reason: 'OWNERS_AND_ADMINS_ONLY' } : submitted ? { allowed: false, reason: submittedCode(partner.state) } : { allowed: true },
    }
  }

  const onboarding = (): Promise<Onboarding | null> => withScope(sql, context, onboardingFrom)

  // SAAS §3.1: Draft (or Sent back, which is Draft with a reason) → Awaiting approval, with the
  // go-live checks run here and the entry written in the same transaction (LOGGING.md §5).
  const submitForApproval = (): Promise<SubmitResult> =>
    withScope(sql, context, async (tx): Promise<SubmitResult> => {
      const partner = await selectPartnerForUpdate(tx, partnerId)
      const current = partner ? await onboardingFrom(tx) : null
      if (!partner || !current || partner.state !== 'draft') return { ok: false, code: submittedCode(partner?.state ?? 'closed') }
      const failing = failingChecks(current.checks)[0]
      if (failing) return { ok: false, code: 'GO_LIVE_CHECK_FAILED', check: failing }
      const at = now()
      const moved = await transitionPartner(tx, partner, { to: 'awaiting', by: { kind: 'partner_user', label: caller.user.name } }, at)
      if (!moved.ok) return { ok: false, code: submittedCode(partner.state) }
      await activity.record(tx, partnerEntry(caller, facts)({ action: submitAudit, target: { type: 'partner', id: partnerId, label: partner.name }, reason: null }))
      return { ok: true, submittedAt: at }
    })

  return { partnerState, navBadges, search, onboarding, submitForApproval }
}

export type PartnerConsoleService = ReturnType<typeof createPartnerConsoleService>
export type { StoreSearchRow }

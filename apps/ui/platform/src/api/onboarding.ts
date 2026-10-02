import type { PartnerRole } from '../features/shell/partnerRoles'
import { harnessEnabled } from '../harness'
import type { PartnerState } from './me'

// The checklist of FIRST-RELEASE.md §4 (SAAS §3.2 step 2) and the go-live checks (step 3). The
// fixture stands in for the Platform API's `onboarding`, `runTestSignup` and `submitForApproval`.
export const checklistItems = ['company', 'branding', 'portalHost', 'wildcards', 'emailSender', 'plan', 'legal', 'paymentMethod', 'payoutDetails', 'testSignup'] as const

export type ChecklistItemKey = (typeof checklistItems)[number]

export type ItemStatus = 'done' | 'progress' | 'missing'

export interface ChecklistItem {
  key: ChecklistItemKey
  status: ItemStatus
  detail: string
  // Who completed it: 'DripFunnel' in a staff setup session, otherwise a team member's first name.
  doneBy: string | null
}

// Payment method and payout details are the partner's own: never a staff member's, never a
// go-live check (SAAS §3.2 step 5).
export const partnerOnlyItems: readonly ChecklistItemKey[] = ['paymentMethod', 'payoutDetails']

export const goLiveChecks = ['portalHost', 'emailDomain', 'pricedPlan', 'legalPages', 'testSignup'] as const

export type GoLiveCheck = (typeof goLiveChecks)[number]

export interface Onboarding {
  state: PartnerState
  items: readonly ChecklistItem[]
  // The email check passes when the sender domain is live or the fallback sender was accepted.
  fallbackSenderAccepted: boolean
  submittedAt: string | null
  submittedBy: 'partner' | 'DripFunnel' | null
  sentBackReason: string | null
  fixes: readonly { label: string; to: '/branding' | '/plans' | '/domains' | '/settings' }[]
}

export const onboardingCodes = ['OWNERS_AND_ADMINS_ONLY', 'GO_LIVE_CHECK_FAILED', 'ALREADY_SUBMITTED', 'NOT_CONNECTED'] as const

export type OnboardingCode = (typeof onboardingCodes)[number]

export interface OnboardingRefusal {
  ok: false
  code: OnboardingCode
  check?: GoLiveCheck
}

// Who set the partner up so far: the partner's own team, or DripFunnel staff in a setup session.
export const setupVariants = ['partner', 'dripfunnel'] as const

export type SetupVariant = (typeof setupVariants)[number]

const item = (key: ChecklistItemKey, status: ItemStatus, detail: string, doneBy: string | null = null): ChecklistItem => ({ key, status, detail, doneBy })

// Kaufladen Digital as the prototype draws it: the partner's own setup is half done; DripFunnel's
// setup session has done everything but the two items only the partner may enter.
const draftItems = (by: SetupVariant): readonly ChecklistItem[] => {
  const who = by === 'dripfunnel' ? 'DripFunnel' : 'Jonas'
  return [
    item('company', 'done', 'Kaufladen Digital GmbH, Berlin', 'DripFunnel'),
    item('branding', 'done', 'Logo, colours and font saved', who),
    item('portalHost', by === 'dripfunnel' ? 'done' : 'progress', by === 'dripfunnel' ? 'shop.kaufladen.de is live' : 'shop.kaufladen.de: waiting for DNS', by === 'dripfunnel' ? who : null),
    item('wildcards', by === 'dripfunnel' ? 'done' : 'progress', by === 'dripfunnel' ? 'Both are live' : '*.preview.kaufladen.de: waiting for DNS', by === 'dripfunnel' ? who : null),
    item('emailSender', 'progress', 'mail.kaufladen.de: verifying (DKIM, SPF). Emails use a fallback sender until then.'),
    item('plan', by === 'dripfunnel' ? 'done' : 'missing', by === 'dripfunnel' ? 'Basis, Plus and Profi are priced' : '3 plans, none priced yet', by === 'dripfunnel' ? who : null),
    item('legal', by === 'dripfunnel' ? 'done' : 'missing', by === 'dripfunnel' ? 'Terms, privacy, Impressum and data-processing agreement added' : 'Data-processing agreement missing', by === 'dripfunnel' ? who : null),
    item('paymentMethod', 'missing', 'The card DripFunnel charges for its invoices'),
    item('payoutDetails', 'missing', 'Add the bank account DripFunnel pays you into'),
    item('testSignup', 'missing', 'Sign up as a merchant at shop.kaufladen.de to check the whole flow'),
  ]
}
const doneDetails: Record<Exclude<ChecklistItemKey, 'paymentMethod' | 'payoutDetails'>, string> = {
  company: 'Kaufladen Digital GmbH, Berlin',
  branding: 'Logo, colours and font saved',
  portalHost: 'shop.kaufladen.de is live',
  wildcards: 'Both are live',
  emailSender: 'mail.kaufladen.de is live',
  plan: 'Basis, Plus and Profi are priced',
  legal: 'Terms, privacy, Impressum and data-processing agreement added',
  testSignup: 'Test store created and removed',
}
const allDone = (by: SetupVariant): readonly ChecklistItem[] =>
  draftItems(by).map((x) =>
    x.key === 'paymentMethod' || x.key === 'payoutDetails' || x.status === 'done' ? x : item(x.key, 'done', doneDetails[x.key], by === 'dripfunnel' ? 'DripFunnel' : 'Jonas'),
  )

// The partner in each state, as the prototype's Partner control shows it.
export const onboardingFor = (state: PartnerState, by: SetupVariant): Onboarding => {
  switch (state) {
    case 'draft':
      return { state, items: draftItems(by), fallbackSenderAccepted: true, submittedAt: null, submittedBy: null, sentBackReason: null, fixes: [] }
    case 'awaiting':
      return { state, items: allDone(by), fallbackSenderAccepted: true, submittedAt: '2026-09-27T09:00:00Z', submittedBy: by === 'dripfunnel' ? 'DripFunnel' : 'partner', sentBackReason: null, fixes: [] }
    case 'sentback':
      return {
        state,
        items: allDone(by).map((x) => (x.key === 'legal' ? item('legal', 'missing', 'Impressum missing (DripFunnel sent this back)') : x)),
        fallbackSenderAccepted: true,
        submittedAt: '2026-09-27T09:00:00Z',
        submittedBy: by === 'dripfunnel' ? 'DripFunnel' : 'partner',
        sentBackReason: 'Your legal pages have no Impressum. German law requires one on every commercial site, so we need it before merchants can sign up.',
        fixes: [{ label: 'Add an Impressum to your legal pages', to: '/branding' }],
      }
    case 'live':
      return { state, items: allDone(by), fallbackSenderAccepted: true, submittedAt: '2026-09-27T09:00:00Z', submittedBy: by === 'dripfunnel' ? 'DripFunnel' : 'partner', sentBackReason: null, fixes: [] }
  }
}

// The go-live checks of SAAS §3.2 step 3, read off the checklist. Returns the first failing check.
export const failingCheck = (onboarding: Onboarding): GoLiveCheck | null => {
  const status = (key: ChecklistItemKey) => onboarding.items.find((x) => x.key === key)?.status
  if (status('portalHost') !== 'done') return 'portalHost'
  if (status('emailSender') !== 'done' && !onboarding.fallbackSenderAccepted) return 'emailDomain'
  if (status('plan') !== 'done') return 'pricedPlan'
  if (status('legal') !== 'done') return 'legalPages'
  if (status('testSignup') !== 'done') return 'testSignup'
  return null
}

// How many go-live checks still fail: what Submit waits for (FIRST-RELEASE §4 "until they pass").
export const checksLeft = (onboarding: Onboarding): number => {
  const status = (key: ChecklistItemKey) => onboarding.items.find((x) => x.key === key)?.status
  return [
    status('portalHost') !== 'done',
    status('emailSender') !== 'done' && !onboarding.fallbackSenderAccepted,
    status('plan') !== 'done',
    status('legal') !== 'done',
    status('testSignup') !== 'done',
  ].filter(Boolean).length
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 400))
const submitters: readonly PartnerRole[] = ['partner-owner', 'partner-admin']

// Who may submit or run the test signup is the API's answer (ACCESS §5.3 `onboarding.submit`).
export const submitForApproval = async (caller: PartnerRole, onboarding: Onboarding): Promise<{ ok: true; submittedAt: string } | OnboardingRefusal> => {
  if (!harnessEnabled) return { ok: false, code: 'NOT_CONNECTED' }
  await settle()
  if (!submitters.includes(caller)) return { ok: false, code: 'OWNERS_AND_ADMINS_ONLY' }
  if (onboarding.state === 'awaiting') return { ok: false, code: 'ALREADY_SUBMITTED' }
  const check = failingCheck(onboarding)
  if (check) return { ok: false, code: 'GO_LIVE_CHECK_FAILED', check }
  return { ok: true, submittedAt: new Date().toISOString() }
}

export const runTestSignup = async (caller: PartnerRole): Promise<{ ok: true; seconds: number } | OnboardingRefusal> => {
  if (!harnessEnabled) return { ok: false, code: 'NOT_CONNECTED' }
  await settle()
  if (!submitters.includes(caller)) return { ok: false, code: 'OWNERS_AND_ADMINS_ONLY' }
  return { ok: true, seconds: 98 }
}

import { ApiError } from '@dripfunnel/shared/graphql'
import { z } from 'zod'
import { query } from './client'

// The checklist of FIRST-RELEASE.md §4 (SAAS §3.2 step 2), the go-live checks (step 3) and who
// may submit, all the Platform API's: `onboarding` and `submitForApproval` (§16).
export const checklistItems = ['company', 'branding', 'portalHost', 'wildcards', 'emailSender', 'plan', 'legal', 'paymentMethod', 'payoutDetails', 'testSignup'] as const

export type ChecklistItemKey = (typeof checklistItems)[number]

const itemStatuses = ['done', 'progress', 'missing'] as const

export type ItemStatus = (typeof itemStatuses)[number]

// Payment method and payout details are the partner's own: never a staff member's, never a
// go-live check (SAAS §3.2 step 5). The API already reads one staff marked done as not done.
export const partnerOnlyItems: readonly ChecklistItemKey[] = ['paymentMethod', 'payoutDetails']

export const goLiveChecks = ['portalHost', 'emailDomain', 'pricedPlan', 'legalPages', 'testSignup'] as const

export type GoLiveCheck = (typeof goLiveChecks)[number]

const consoleLinks = ['/settings', '/branding', '/domains', '/plans', '/dashboard'] as const

const submitRefusals = ['OWNERS_AND_ADMINS_ONLY', 'ALREADY_SUBMITTED', 'ALREADY_APPROVED'] as const

const onboardingSchema = z.object({
  onboarding: z
    .object({
      items: z.array(
        z.object({
          key: z.enum(checklistItems),
          status: z.enum(itemStatuses),
          detail: z.string().nullable(),
          // "DripFunnel" for a staff setup session, otherwise a team member's first name.
          doneBy: z.string().nullable(),
          to: z.enum(consoleLinks),
        }),
      ),
      checks: z.object({ portalHost: z.boolean(), emailDomain: z.boolean(), pricedPlan: z.boolean(), legalPages: z.boolean(), testSignup: z.boolean() }),
      fallbackSenderAccepted: z.boolean(),
      submittedAt: z.string().nullable(),
      submittedBy: z.enum(['partner', 'DripFunnel']).nullable(),
      sentBackReason: z.string().nullable(),
      fixes: z.array(z.object({ item: z.enum(checklistItems), to: z.enum(consoleLinks) })),
      canSubmit: z.object({ allowed: z.boolean(), reason: z.enum(submitRefusals).nullable() }),
    })
    .nullable(),
})

export type Onboarding = NonNullable<z.infer<typeof onboardingSchema>['onboarding']>

export type ChecklistItem = Onboarding['items'][number]

export const loadOnboarding = async (): Promise<Onboarding | null> =>
  (
    await query(
      `{ onboarding { items { key status detail doneBy to } checks { portalHost emailDomain pricedPlan legalPages testSignup } fallbackSenderAccepted submittedAt submittedBy sentBackReason fixes { item to } canSubmit { allowed reason } } }`,
      onboardingSchema,
    )
  ).onboarding

// The checks the API says still fail, for "Finish the N items above first" (FIRST-RELEASE §4).
export const failingChecks = (onboarding: Onboarding): readonly GoLiveCheck[] => goLiveChecks.filter((check) => !onboarding.checks[check])

export const onboardingCodes = [...submitRefusals, 'GO_LIVE_CHECK_FAILED', 'NOT_CONNECTED'] as const

export type OnboardingCode = (typeof onboardingCodes)[number]

export type SubmitOutcome = { ok: true; submittedAt: string } | { ok: false; code: OnboardingCode; check?: GoLiveCheck | undefined }

const submitSchema = z.object({
  submitForApproval: z.object({ ok: z.boolean(), code: z.string().nullable(), check: z.enum(goLiveChecks).nullable(), submittedAt: z.string().nullable() }),
})

// A role without `onboarding.submit` is refused at the access layer (FORBIDDEN), which says
// the same thing as the API's own OWNERS_AND_ADMINS_ONLY.
export const submitForApproval = async (): Promise<SubmitOutcome> => {
  try {
    const { submitForApproval: result } = await query(`mutation { submitForApproval { ok code check submittedAt } }`, submitSchema)
    if (result.ok && result.submittedAt) return { ok: true, submittedAt: result.submittedAt }
    const code = z.enum(onboardingCodes).safeParse(result.code)
    return { ok: false, code: code.success ? code.data : 'NOT_CONNECTED', check: result.check ?? undefined }
  } catch (error) {
    return { ok: false, code: error instanceof ApiError && error.code === 'FORBIDDEN' ? 'OWNERS_AND_ADMINS_ONLY' : 'NOT_CONNECTED' }
  }
}

// The partner and store rows of migrations/0007 (SAAS.md §3.1, §4.2, §5; DATA-MODEL.md §3.2, §3.3).

export const partnerStates = ['draft', 'awaiting', 'live', 'paused', 'offboarding', 'closed'] as const
export type PartnerState = (typeof partnerStates)[number]

export const poweredByRules = ['on', 'off', 'house'] as const
export type PoweredBy = (typeof poweredByRules)[number]

export const agentKinds = ['partner_user', 'staff'] as const
export type AgentKind = (typeof agentKinds)[number]

export interface PartnerRow {
  id: string
  created_at: Date
  name: string
  is_house: boolean
  kind: string | null
  region: string | null
  country: string | null
  state: PartnerState
  product_name: string | null
  primary_color: string | null
  accent_color: string | null
  powered_by: PoweredBy
  fallback_sender_accepted: boolean
  submitted_at: Date | null
  submitted_by_kind: AgentKind | null
  submitted_by_label: string | null
  sent_back_reason: string | null
  approved_at: Date | null
  paused_at: Date | null
  pause_reason: string | null
}

export const partnerRoles = ['partner-owner', 'partner-admin', 'partner-support', 'partner-finance', 'partner-read-only'] as const
export type PartnerRole = (typeof partnerRoles)[number]

export interface PartnerUserRow {
  id: string
  partner_id: string
  email: string
  name: string
  role_key: PartnerRole
  status: 'invited' | 'active' | 'suspended'
  last_sign_in_at: Date | null
  created_at: Date
}

export interface PartnerInvitationRow {
  id: string
  partner_id: string
  partner_user_id: string
  expires_at: Date | null
  sent_at: Date | null
  invited_by_kind: AgentKind
  invited_by_label: string
  accepted_at: Date | null
  revoked_at: Date | null
  created_at: Date
}

export const domainKinds = ['portal', 'preview', 'shops', 'email'] as const
export type DomainKind = (typeof domainKinds)[number]

/** SAAS.md §8. */
export const hostStatuses = ['waiting', 'verifying', 'issuing', 'live', 'failed', 'expiring', 'broken'] as const
export type HostStatus = (typeof hostStatuses)[number]

export interface PartnerDomainRow {
  id: string
  partner_id: string
  kind: DomainKind
  host: string
  status: HostStatus
  record_type: 'CNAME' | 'TXT' | 'A'
  expected: string
  found: string | null
  checked_at: Date | null
  created_at: Date
}

/** ui/platform/FIRST-RELEASE.md §4, in order. */
export const setupItems = ['company', 'branding', 'portalHost', 'wildcards', 'emailSender', 'plan', 'legal', 'paymentMethod', 'payoutDetails', 'testSignup'] as const
export type SetupItem = (typeof setupItems)[number]

export interface PartnerSetupItemRow {
  partner_id: string
  item: SetupItem
  status: 'done' | 'progress' | 'missing'
  detail: string | null
  done_by_kind: AgentKind | null
  done_by_label: string | null
  done_at: Date | null
}

export const planStatuses = ['draft', 'live', 'retired'] as const
export type PlanStatus = (typeof planStatuses)[number]

export interface PlanRow {
  id: string
  partner_id: string
  name: string
  description: string | null
  status: PlanStatus
  trial_days: number
  max_products: number | null
  max_staff: number | null
  created_at: Date
}

export const storeStatuses = ['trial', 'active', 'past_due', 'suspended', 'cancelled', 'closed'] as const
export type StoreStatus = (typeof storeStatuses)[number]

export const buildStates = ['live', 'building', 'failed'] as const
export type BuildState = (typeof buildStates)[number]

export interface StoreRow {
  id: string
  partner_id: string
  created_at: Date
  name: string
  code: string
  country: string | null
  status: StoreStatus
  plan_id: string | null
  trial_ends_at: Date | null
  past_due_since: Date | null
  suspended_at: Date | null
  suspended_reason: string | null
  suspended_by_label: string | null
  suspended_previous_status: Extract<StoreStatus, 'trial' | 'active' | 'past_due'> | null
  cancelled_at: Date | null
  closed_at: Date | null
  storefront_kind: 'ai' | 'own'
  build_state: BuildState | null
  core_version: string | null
  last_build_at: Date | null
  last_publish_at: Date | null
  support_access_allowed: boolean
  /** Set only by a partner that bills its merchants itself (0014). */
  billing_status: 'active' | 'past_due' | 'suspended' | null
}

export interface CustomDomainRow {
  id: string
  store_id: string
  host: string
  status: HostStatus
  expected_cname: string
  found_cname: string | null
  ownership_token: string
  ownership_found: string | null
  checked_at: Date | null
  created_at: Date
}

export interface UserRow {
  id: string
  partner_id: string
  email: string
  name: string
  status: 'invited' | 'active' | 'suspended' | 'deleted'
  last_sign_in_at: Date | null
  created_at: Date
}

export const merchantRoles = ['owner', 'manager', 'staff'] as const
export const supplierTeamRoles = ['supplier-admin', 'supplier-member'] as const
export type MembershipRole = (typeof merchantRoles)[number] | (typeof supplierTeamRoles)[number]

export interface MembershipRow {
  id: string
  user_id: string
  store_id: string
  seller_id: string | null
  role_key: MembershipRole
  status: 'invited' | 'active' | 'suspended'
  created_at: Date
}

/** SAAS.md §5's eight steps, in order; a store with its own frontend runs the first three. */
export const provisioningSteps = ['accountAndStore', 'defaults', 'hostnames', 'repo', 'storeConfig', 'hostingTarget', 'firstBuild', 'done'] as const
export type ProvisioningStep = (typeof provisioningSteps)[number]

export const jobStates = ['running', 'failed', 'cleaning', 'done', 'undone'] as const
export type JobState = (typeof jobStates)[number]

export interface JobRow {
  id: string
  store_id: string
  kind: 'provision-store'
  state: JobState
  steps: ProvisioningStep[]
  step: ProvisioningStep
  step_started_at: Date
  attempts: number
  started_at: Date
  finished_at: Date | null
  last_error: string | null
}

/** Staff's alone (FIRST-RELEASE §7): what a step's provider said, and what was undone. */
export interface JobDetailRow {
  job_id: string
  details: string | null
  compensation_log: unknown[]
}

export interface StoreNoteRow {
  id: string
  store_id: string
  staff_user_id: string
  text: string
  created_at: Date
}

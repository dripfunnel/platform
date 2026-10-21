// The Staff operations on the Admin API (FIRST-RELEASE.md §10, §12): the only place this app
// talks to the API about staff. Whether an action is allowed, and why not, is the API's answer.
import type { PageInfo, PageRequest } from '@dripfunnel/shared/graphql'
import { z } from 'zod'
import { staffRoles, type StaffRole } from '../features/shell/staffRoles'
import { isApiError, query } from './client'
import { compactActions, isoString, pageInfoSchema, permissionSchema } from './decode'
import type { ActionPermission } from './permissions'

// The server's refusals (decided on #45). LAST_SUPER_ADMIN guards the console's last way in.
export const staffRefusals = ['SUPER_ADMIN_ONLY', 'LAST_SUPER_ADMIN', 'ALREADY_STAFF', 'SAME_ROLE', 'NOT_PENDING', 'PENDING_INVITATION', 'NOT_FOUND', 'INVALID_INPUT', 'RATE_LIMITED'] as const
export type StaffRefusal = (typeof staffRefusals)[number]

// Whether 2-factor was used at the last sign-in, as the company SSO reported it (decided on #45).
export type TwoFactor = 'on' | 'off' | 'notSignedIn'

// Never the link or its token: those exist only in the invitee's email (ACCESS.md §6.2).
export interface StaffInvitation {
  sentAt: string
  expiresAt: string
  expired: boolean
}

export type StaffAction = 'changeRole' | 'remove' | 'resend' | 'revoke'

export interface StaffMember {
  id: string
  name: string | null
  email: string
  role: StaffRole
  lastSignInAt: string | null
  twoFactor: TwoFactor
  invitation: StaffInvitation | null
  actions: Partial<Record<StaffAction, ActionPermission<StaffRefusal>>>
}

export interface StaffPage {
  items: readonly StaffMember[]
  pageInfo: PageInfo
  // Fewer than the two README.md §2 asks for; the server still allows one.
  soleSuperAdmin: boolean
}

export type StaffResult = { ok: true } | { ok: false; reason: StaffRefusal }

// The API's cap on a page; it answers with fewer when there are fewer.
export const staffPageSize = 25

export const invitationDays = 7

const permission = permissionSchema(staffRefusals).nullable()

const memberSchema = z
  .object({
    id: z.string(),
    name: z.string().nullable(),
    email: z.string(),
    role: z.enum(staffRoles),
    lastSignInAt: isoString.nullable(),
    twoFactor: z.enum(['on', 'off', 'notSignedIn']),
    invitation: z.object({ sentAt: isoString, expiresAt: isoString, expired: z.boolean() }).nullable(),
    actions: z.object({ changeRole: permission, remove: permission, resend: permission, revoke: permission }),
  })
  .transform((member): StaffMember => ({ ...member, actions: compactActions(member.actions) }))

const pageSchema = z.object({ staff: z.object({ items: z.array(memberSchema), pageInfo: pageInfoSchema, soleSuperAdmin: z.boolean() }) })

// `caller` only spares a role the API would refuse the round trip: Staff is the Super admin's (§10).
export const loadStaff = async (page: PageRequest, caller: StaffRole): Promise<StaffPage | null> => {
  if (caller !== 'staff-super-admin') return null
  const { staff } = await query(
    `query Staff($after: String, $before: String) {
      staff(after: $after, before: $before) {
        items {
          id name email role lastSignInAt twoFactor invitation { sentAt expiresAt expired }
          actions { changeRole { allowed reason failingChecks } remove { allowed reason failingChecks } resend { allowed reason failingChecks } revoke { allowed reason failingChecks } }
        }
        pageInfo { startCursor endCursor hasPreviousPage hasNextPage } soleSuperAdmin
      }
    }`,
    pageSchema,
    { after: page.after, before: page.before },
  )
  return staff
}

const resultSchema = (field: string) => z.object({ [field]: z.object({ ok: z.boolean(), reason: z.enum(staffRefusals).nullable() }) })

// The access layer's FORBIDDEN is the same refusal as SUPER_ADMIN_ONLY, said earlier.
const write = async (field: string, args: string, call: string, variables: Record<string, unknown>): Promise<StaffResult> => {
  try {
    const result = (await query(`mutation ${field}${args} { ${call} { ok reason } }`, resultSchema(field), variables))[field] as { ok: boolean; reason: StaffRefusal | null }
    return result.ok ? { ok: true } : { ok: false, reason: result.reason ?? 'NOT_FOUND' }
  } catch (error) {
    if (isApiError(error, 'FORBIDDEN')) return { ok: false, reason: 'SUPER_ADMIN_ONLY' }
    throw error
  }
}

// The invitation link and its token exist only in the invitee's email (ACCESS.md §6.2).
export const inviteStaff = (email: string, role: StaffRole): Promise<StaffResult> =>
  write('inviteStaff', '($email: String!, $role: String!)', 'inviteStaff(email: $email, role: $role)', { email, role })

export const changeStaffRole = (id: string, role: StaffRole): Promise<StaffResult> =>
  write('changeStaffRole', '($id: ID!, $role: String!)', 'changeStaffRole(id: $id, role: $role)', { id, role })

export const removeStaff = (id: string): Promise<StaffResult> => write('removeStaff', '($id: ID!)', 'removeStaff(id: $id)', { id })

export const resendStaffInvite = (id: string): Promise<StaffResult> => write('resendStaffInvite', '($id: ID!)', 'resendStaffInvite(id: $id)', { id })

export const revokeStaffInvite = (id: string): Promise<StaffResult> => write('revokeStaffInvite', '($id: ID!)', 'revokeStaffInvite(id: $id)', { id })

// The Staff operations on the Admin API (FIRST-RELEASE.md §10, §12): the only place this app
// talks to the API about staff. Whether an action is allowed, and why not, is the API's answer.
import { harnessEnabled } from '../harness'
import type { StaffRole } from '../features/shell/staffRoles'
import type { PageInfo, PageRequest } from '@dripfunnel/shared/ui'
import type { ActionPermission } from './permissions'
import { staffServer } from './staffSample'

// The server's refusals (decided on #45). LAST_SUPER_ADMIN guards the console's last way in.
export const staffRefusals = ['SUPER_ADMIN_ONLY', 'LAST_SUPER_ADMIN', 'ALREADY_STAFF', 'SAME_ROLE', 'NOT_PENDING', 'PENDING_INVITATION', 'NOT_FOUND'] as const
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

const notConnected = () => Promise.reject(new Error('The Admin API has no staff operations yet (#39).'))

// Seam: replace the sample with the Admin API's `staff(after, before)` and the §12 mutations
// through createApiClient from @dripfunnel/shared/graphql once #39 lands
// (https://github.com/dripfunnel/platform/issues/39); #68 wires it. `caller` stands in for the
// session the API reads the role from. The sample is invented, so only the ?state= harness has it.
export const loadStaff = (page: PageRequest, caller: StaffRole): Promise<StaffPage | null> =>
  harnessEnabled ? Promise.resolve(staffServer.list(page, staffPageSize, caller)) : notConnected()

export const inviteStaff = (email: string, role: StaffRole, caller: StaffRole): Promise<StaffResult> =>
  harnessEnabled ? Promise.resolve(staffServer.invite(email, role, caller)) : notConnected()

export const changeStaffRole = (id: string, role: StaffRole, caller: StaffRole): Promise<StaffResult> =>
  harnessEnabled ? Promise.resolve(staffServer.changeRole(id, role, caller)) : notConnected()

export const removeStaff = (id: string, caller: StaffRole): Promise<StaffResult> =>
  harnessEnabled ? Promise.resolve(staffServer.remove(id, caller)) : notConnected()

export const resendStaffInvite = (id: string, caller: StaffRole): Promise<StaffResult> =>
  harnessEnabled ? Promise.resolve(staffServer.resend(id, caller)) : notConnected()

export const revokeStaffInvite = (id: string, caller: StaffRole): Promise<StaffResult> =>
  harnessEnabled ? Promise.resolve(staffServer.revoke(id, caller)) : notConnected()

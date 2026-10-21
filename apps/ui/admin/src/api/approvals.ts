// The Approvals queue (FIRST-RELEASE.md §6) is a shortcut, not a separate data model: the
// Partners list filtered to Awaiting approval, oldest submitted first (decided on #43).
import type { PageRequest } from '@dripfunnel/shared/graphql'
import type { StaffRole } from '../features/shell/staffRoles'
import { loadPartners, type PartnerPage } from './partners'

// Who may open Approvals (FIRST-RELEASE.md §2). The partners behind it are open to everyone;
// the queue is where approvers work, so any other role gets the page's no-access view.
export const approvalRoles: readonly StaffRole[] = ['staff-super-admin', 'staff-partner-manager']

export const loadApprovals = async (page: PageRequest, caller: StaffRole): Promise<PartnerPage | null> =>
  approvalRoles.includes(caller) ? loadPartners({ status: 'awaiting', sort: 'oldestSubmitted' }, page) : null

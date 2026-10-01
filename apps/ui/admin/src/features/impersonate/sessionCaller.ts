import { parseScreenState } from '@dripfunnel/shared/ui'
import type { StaffRole } from '../shell/staffRoles'
import { harnessEnabled } from '../common/useScreenState'

// ?state=denied asks as Finance: Support may use Impersonate, so it isn't the role to check.
export const sessionCallerFor = (role: StaffRole, searchStr: string): StaffRole =>
  harnessEnabled && parseScreenState(new URLSearchParams(searchStr).get('state'), ['denied'] as const) ? 'staff-finance' : role

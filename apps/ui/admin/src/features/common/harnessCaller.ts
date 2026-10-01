import type { StaffRole } from '../shell/staffRoles'
import { parseScreenState } from '@dripfunnel/shared/ui'
import { harnessEnabled } from './useScreenState'

// ?state=readonly and ?state=denied ask the sample for a caller without the permissions,
// because what is allowed is the API's answer, never the screen's (decided on #19). Support
// can do some things but not others, so its page shows refusals beside live controls.
const viewAs: Partial<Record<string, StaffRole>> = { readonly: 'staff-read-only', denied: 'staff-support' }

export const callerFor = (role: StaffRole, searchStr: string): StaffRole => {
  if (!harnessEnabled) return role
  const state = parseScreenState(new URLSearchParams(searchStr).get('state'), ['readonly', 'denied'] as const)
  return (state && viewAs[state]) ?? role
}

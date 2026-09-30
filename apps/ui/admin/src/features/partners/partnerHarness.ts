import { parseScreenState } from '../common/screenState'
import { harnessEnabled } from '../common/useScreenState'
import type { StaffRole } from '../shell/staffRoles'

export const partnersStates = ['loading', 'empty', 'error', 'readonly', 'denied'] as const
export type PartnersState = (typeof partnersStates)[number]

export const partnerStates = ['loading', 'error', 'readonly', 'denied', 'confirm'] as const
export type PartnerScreenState = (typeof partnerStates)[number]

// ?state=readonly and ?state=denied ask the sample for a caller without the permissions,
// because what is allowed is the API's answer, never the screen's (decided on #19). Support
// can send invitations but nothing else, so its page shows refusals beside live controls.
const viewAs: Partial<Record<string, StaffRole>> = { readonly: 'staff-read-only', denied: 'staff-support' }

export const callerFor = (role: StaffRole, searchStr: string): StaffRole => {
  if (!harnessEnabled) return role
  const state = parseScreenState(new URLSearchParams(searchStr).get('state'), ['readonly', 'denied'] as const)
  return (state && viewAs[state]) ?? role
}

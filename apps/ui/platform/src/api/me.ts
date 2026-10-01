import { parseScreenState } from '@dripfunnel/shared/ui'
import type { PartnerRole } from '../features/shell/partnerRoles'
import { harnessEnabled } from '../harness'

export const partnerStates = ['live', 'draft', 'awaiting', 'sentback'] as const

export type PartnerState = (typeof partnerStates)[number]

export interface Me {
  id: string
  name: string
  email: string
  role: PartnerRole
  partner: { id: string; name: string; product: string; state: PartnerState }
}

const fixture: Me = {
  id: 'pu-maya',
  name: 'Maya Ortiz',
  email: 'maya@northstar.com',
  role: 'partner-owner',
  partner: { id: 'p-northstar', name: 'Northstar Commerce', product: 'Northstar Shops', state: 'live' },
}

// Fixture until partner sign-in lands (#112), then the Platform API's `me` (FIRST-RELEASE.md §16).
// An Owner, with nothing guarding /_app yet, so it must be gone before real data arrives.
export const loadMe = (): Promise<Me> => Promise.resolve(fixture)

// ?state=readonly|denied ask for a caller without the permissions: what is allowed is the API's
// answer, never the screen's (decided on #19).
const viewAs: Partial<Record<string, PartnerRole>> = { readonly: 'partner-read-only', denied: 'partner-support' }

export const callerFor = (role: PartnerRole, state: string | undefined): PartnerRole => {
  if (!harnessEnabled) return role
  const forced = parseScreenState(state, ['readonly', 'denied'] as const)
  return (forced && viewAs[forced]) ?? role
}

// ?partner=draft|awaiting|sentback shows the shell as a partner in that state sees it (FIRST-RELEASE
// §2.3, §4), the way the prototype's Partner control does.
export const partnerStateFor = (state: PartnerState, requested: string | undefined): PartnerState =>
  (harnessEnabled && parseScreenState(requested, partnerStates)) || state

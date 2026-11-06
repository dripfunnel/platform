import { parseScreenState } from '@dripfunnel/shared/ui'
import { harnessEnabled } from '../../harness'
import type { StaffRole } from '../shell/staffRoles'

// States (?state=): loading, empty, error, denied, readonly, confirm. `denied` asks as Support, who has no fleet.read;
// `readonly` keeps the caller's own view without the actions, since no role reads the fleet without managing it.
export const rolloutsStates = ['loading', 'empty', 'error', 'denied', 'readonly', 'confirm'] as const
export type RolloutsScreenState = (typeof rolloutsStates)[number]

export const rolloutsCaller = (role: StaffRole, searchStr: string): StaffRole =>
  harnessEnabled && parseScreenState(new URLSearchParams(searchStr).get('state'), ['denied'] as const) ? 'staff-support' : role

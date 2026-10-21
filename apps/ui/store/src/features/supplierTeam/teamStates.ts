import type { Teammate } from '../../api/supplierTeam'

// Your team's states under ?state= (ui/README.md §6): loading, error, team, empty (just you), readOnly, denied.
export const teamStates = ['loading', 'error', 'team', 'empty', 'readOnly', 'denied'] as const
export type TeamState = (typeof teamStates)[number]

// A build-time constant Vite folds, so a production bundle carries none of these literals.
const harness = import.meta.env.DEV || import.meta.env.VITE_STATE_HARNESS === '1'

const teammate = (t: Partial<Teammate> & Pick<Teammate, 'id' | 'email'>): Teammate => ({
  kind: 'member',
  name: null,
  role: 'supplier-member',
  you: false,
  lastAdmin: false,
  since: '2026-09-02T09:00:00.000Z',
  expiresAt: null,
  expired: false,
  ...t,
})

const you = harness ? teammate({ id: 'm-nadia', email: 'nadia@northwind.example', name: 'Nadia Tran', role: 'supplier-admin', you: true, lastAdmin: true }) : null

// The prototype's three: you as the only admin, a member, and an invitation not accepted yet.
const team: Teammate[] =
  harness && you
    ? [
        you,
        teammate({ id: 'm-leo', email: 'leo@northwind.example', name: 'Leo Park' }),
        teammate({ id: 'i-mira', kind: 'invitation', email: 'mira@northwind.example', since: '2026-10-08T09:00:00.000Z', expiresAt: '2026-10-15T09:00:00.000Z' }),
      ]
    : []

export const teamSample = (state: TeamState | null): Teammate[] | null => {
  if (!harness || !you || !state || state === 'loading' || state === 'error' || state === 'denied') return null
  return state === 'empty' ? [you] : team
}

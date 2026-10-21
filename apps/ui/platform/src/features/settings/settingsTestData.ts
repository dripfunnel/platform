import type { Company, TeamMember } from '../../api/settings'

// What the Platform API answers for Northstar's Settings.
export const company: Company = {
  name: 'Northstar Commerce',
  country: 'US',
  region: 'US, Canada',
  kind: 'Agency',
  mainContact: { name: 'Maya Chen', email: 'maya@northstar.example' },
  billingContact: { name: 'Alex Rivera', email: 'alex@northstar.example' },
  contract: { feeCurrency: 'USD', fees: [{ plan: 'Growth', fee: { amount: 1800, currency: 'USD' } }], moreFees: false, poweredByRemovable: false, poweredByNote: null },
  secondFactorRequired: false,
}

const member = (id: string, name: string, role: TeamMember['role'], extra: Partial<TeamMember> = {}): TeamMember => ({
  id,
  name,
  email: `${name.split(' ')[0]?.toLowerCase() ?? id}@northstar.example`,
  role,
  status: 'active',
  you: false,
  lastSignInAt: '2026-10-03T09:00:00.000Z',
  invitation: null,
  secondFactor: true,
  ...extra,
})

export const team: TeamMember[] = [
  member('u1', 'Maya Chen', 'partner-owner', { you: true }),
  member('u2', 'Diego Alvarez', 'partner-admin'),
  member('u3', 'Jess Moreno', 'partner-support', { secondFactor: false }),
  member('u4', 'Sam Lee', 'partner-finance', { status: 'invited', lastSignInAt: null, invitation: { sentAt: '2026-10-02T09:00:00.000Z', expired: false } }),
]

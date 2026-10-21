import type { Money } from '@dripfunnel/shared/format'
import { ApiError, type PageInfo } from '@dripfunnel/shared/graphql'
import { z } from 'zod'
import { query } from './client'
import { partnerRoles, type PartnerRole } from '../features/shell/partnerRoles'

// Settings on the Platform API (FIRST-RELEASE.md §14, §16): the company with its contract, the
// team and its changes, and the 2-factor rule. Payouts and the payment method wait on #201.

export interface Contact {
  name: string
  email: string
}

export interface Company {
  name: string
  country: string | null
  region: string | null
  kind: string | null
  mainContact: Contact | null
  billingContact: Contact | null
  contract: { feeCurrency: string; fees: readonly { plan: string; fee: Money }[]; moreFees: boolean; poweredByRemovable: boolean; poweredByNote: string | null } | null
  secondFactorRequired: boolean
}

export interface TeamMember {
  id: string
  name: string
  email: string
  role: PartnerRole
  status: 'active' | 'invited' | 'suspended'
  you: boolean
  lastSignInAt: string | null
  invitation: { sentAt: string; expired: boolean } | null
  secondFactor: boolean
}

export interface SettingsData {
  company: Company
  team: { items: readonly TeamMember[]; pageInfo: PageInfo }
}

const contact = z.object({ name: z.string(), email: z.string() }).nullable()
const money = z.object({ amount: z.number().int(), currency: z.string() })

const companySchema = z.object({
  name: z.string(),
  country: z.string().nullable(),
  region: z.string().nullable(),
  kind: z.string().nullable(),
  mainContact: contact,
  billingContact: contact,
  contract: z.object({ feeCurrency: z.string(), fees: z.array(z.object({ plan: z.string(), fee: money })), moreFees: z.boolean(), poweredByRemovable: z.boolean(), poweredByNote: z.string().nullable() }).nullable(),
  secondFactorRequired: z.boolean(),
})

const memberSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(partnerRoles),
  status: z.enum(['active', 'invited', 'suspended']),
  you: z.boolean(),
  lastSignInAt: z.string().nullable(),
  invitation: z.object({ sentAt: z.string(), expired: z.boolean() }).nullable(),
  secondFactor: z.boolean(),
})

const pageInfoSchema = z.object({ startCursor: z.string().nullable(), endCursor: z.string().nullable(), hasPreviousPage: z.boolean(), hasNextPage: z.boolean() })

const teamFields = `items { id name email role status you lastSignInAt invitation { sentAt expired } secondFactor } pageInfo { startCursor endCursor hasPreviousPage hasNextPage }`

export const loadSettings = async (): Promise<SettingsData> => {
  const answer = await query(
    `{
      partnerCompany { name country region kind mainContact { name email } billingContact { name email }
        contract { feeCurrency fees { plan fee { amount currency } } moreFees poweredByRemovable poweredByNote } secondFactorRequired }
      team { ${teamFields} }
    }`,
    z.object({ partnerCompany: companySchema, team: z.object({ items: z.array(memberSchema), pageInfo: pageInfoSchema }) }),
  )
  return { company: answer.partnerCompany, team: answer.team }
}

export const loadMoreTeam = async (after: string): Promise<SettingsData['team']> =>
  (await query(`query Team($after: String) { team(after: $after) { ${teamFields} } }`, z.object({ team: z.object({ items: z.array(memberSchema), pageInfo: pageInfoSchema }) }), { after })).team

export const teamRefusals = [
  'LAST_OWNER',
  'OWNERS_ONLY',
  'CANNOT_REMOVE_SELF',
  'ALREADY_ON_TEAM',
  'NOT_FOUND',
  'INVALID_INPUT',
  'NO_PENDING_INVITATION',
  'NOT_ACTIVE',
  'RATE_LIMITED',
  'BLOCKED_WHILE_IMPERSONATING',
  'PARTNER_ENTERS_THIS_ITSELF',
] as const
export type TeamRefusal = (typeof teamRefusals)[number]
export type TeamResult = { ok: true } | { ok: false; reason: TeamRefusal }

const resultSchema = z.object({ ok: z.boolean(), reason: z.string().nullable() })

// A code this console doesn't know is an error with that code, never worded as a known one.
const teamResult = (r: z.infer<typeof resultSchema>): TeamResult => {
  if (r.ok) return { ok: true }
  const reason = teamRefusals.find((code) => code === r.reason)
  if (!reason) throw new ApiError(r.reason ?? 'UNKNOWN', 'The API refused with a code this console does not know.')
  return { ok: false, reason }
}

const mutate = async (field: string, source: string, variables: Record<string, unknown>): Promise<TeamResult> => {
  const answer = await query(source, z.object({ [field]: resultSchema }), variables)
  const result = answer[field]
  if (!result) throw new ApiError('BAD_RESPONSE', `No ${field} in the answer.`)
  return teamResult(result)
}

export const inviteTeamMember = (input: { name: string; email: string; role: PartnerRole }) =>
  mutate('inviteTeamMember', `mutation Invite($name: String!, $email: String!, $role: String!) { inviteTeamMember(name: $name, email: $email, role: $role) { ok reason } }`, input)

export const changeTeamRole = (id: string, role: PartnerRole) =>
  mutate('changeTeamRole', `mutation Role($id: ID!, $role: String!) { changeTeamRole(id: $id, role: $role) { ok reason } }`, { id, role })

export const removeTeamMember = (id: string) => mutate('removeTeamMember', `mutation Remove($id: ID!) { removeTeamMember(id: $id) { ok reason } }`, { id })

export const resendTeamInvite = (id: string) => mutate('resendTeamInvite', `mutation Resend($id: ID!) { resendTeamInvite(id: $id) { ok reason } }`, { id })

export const revokeTeamInvite = (id: string) => mutate('revokeTeamInvite', `mutation Revoke($id: ID!) { revokeTeamInvite(id: $id) { ok reason } }`, { id })

export const transferOwnership = (toUserId: string) =>
  mutate('transferOwnership', `mutation Transfer($to: ID!) { transferOwnership(toUserId: $to) { ok reason } }`, { to: toUserId })

export const setSecondFactorPolicy = (required: boolean) =>
  mutate('setSecondFactorPolicy', `mutation Policy($required: Boolean!) { setSecondFactorPolicy(required: $required) { ok reason } }`, { required })

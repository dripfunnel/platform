import { z } from 'zod'
import { allPages } from './allPages'
import { query } from './client'

// Your team (VendorViews, FIRST-RELEASE §17, ACCESS §7.5): a Supplier admin's own supplier's people and invitations.
// A member's id is its membership's, an invitation's the invitation's (src/apis/store/supplierTeam.ts).

export const teamRoles = ['supplier-admin', 'supplier-member'] as const
export type TeamRole = (typeof teamRoles)[number]

const pageInfoSchema = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() })

const teammateSchema = z.object({
  id: z.string(),
  kind: z.enum(['member', 'invitation']),
  name: z.string().nullable(),
  email: z.string(),
  role: z.enum(teamRoles),
  you: z.boolean(),
  lastAdmin: z.boolean(),
  since: z.string(),
  expiresAt: z.string().nullable(),
  expired: z.boolean(),
})
export type Teammate = z.infer<typeof teammateSchema>

/** Everyone on the team and every invitation waiting: a team is small, so the screen reads it whole. */
export const loadMyTeam = (): Promise<Teammate[]> =>
  allPages(
    async (after) =>
      (
        await query(
          'query T($after: String) { mySupplierTeam(first: 50, after: $after) { nodes { id kind name email role you lastAdmin since expiresAt expired } pageInfo { hasNextPage endCursor } } }',
          z.object({ mySupplierTeam: z.object({ nodes: z.array(teammateSchema), pageInfo: pageInfoSchema }) }),
          { after },
        )
      ).mySupplierTeam,
  )

/** Answered as for any address (ACCESS §7.5), so the screen says "sent" either way. */
export const inviteTeammate = async (email: string, role: TeamRole): Promise<void> => {
  await query('mutation I($e: String!, $r: String!) { inviteSupplierUser(email: $e, role: $r) }', z.object({ inviteSupplierUser: z.string().nullable() }), { e: email, r: role })
}

export const resendTeamInvitation = async (invitationId: string): Promise<void> => {
  await query('mutation R($id: ID!) { resendSupplierInvitation(invitationId: $id) }', z.object({ resendSupplierInvitation: z.string().nullable() }), { id: invitationId })
}

export const revokeTeamInvitation = async (invitationId: string): Promise<void> => {
  await query('mutation R($id: ID!) { revokeSupplierInvitation(invitationId: $id) }', z.object({ revokeSupplierInvitation: z.boolean() }), { id: invitationId })
}

/** Refused for the last admin (LAST_ADMIN). */
export const changeTeamRole = async (membershipId: string, role: TeamRole): Promise<void> => {
  await query('mutation C($id: ID!, $r: String!) { changeSupplierRole(membershipId: $id, role: $r) }', z.object({ changeSupplierRole: z.boolean() }), { id: membershipId, r: role })
}

/** Out of this supplier at once; refused for the last admin (LAST_ADMIN). */
export const removeTeammate = async (membershipId: string): Promise<void> => {
  await query('mutation R($id: ID!) { removeSupplierUser(membershipId: $id) }', z.object({ removeSupplierUser: z.boolean() }), { id: membershipId })
}

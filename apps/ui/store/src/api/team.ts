import { z } from 'zod'
import { allPages } from './allPages'
import { query } from './client'

// Settings › People and Supplier (SetTeam, FIRST-RELEASE §15): the store's own people, and its supplier companies.

const pageInfoSchema = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() })

export const staffRoles = ['owner', 'manager', 'staff'] as const
export type StaffRole = (typeof staffRoles)[number]

const personSchema = z.object({
  id: z.string(),
  kind: z.enum(['member', 'invitation']),
  name: z.string().nullable(),
  email: z.string(),
  role: z.enum(staffRoles),
  you: z.boolean(),
  since: z.string(),
  expiresAt: z.string().nullable(),
  expired: z.boolean(),
})
export type Person = z.infer<typeof personSchema>

/** Everyone in the store and every invitation waiting, newest first. */
export const loadPeople = (): Promise<Person[]> =>
  allPages(
    async (after) =>
      (
        await query(
          'query P($after: String) { people(first: 50, after: $after) { nodes { id kind name email role you since expiresAt expired } pageInfo { hasNextPage endCursor } } }',
          z.object({ people: z.object({ nodes: z.array(personSchema), pageInfo: pageInfoSchema }) }),
          { after },
        )
      ).people,
  )

export const inviteMember = async (email: string, role: StaffRole): Promise<void> => {
  await query('mutation I($e: String!, $r: String!) { inviteMember(email: $e, role: $r) }', z.object({ inviteMember: z.boolean() }), { e: email, r: role })
}

/** A new link by email; the old one stops working. */
export const resendInvitation = async (invitationId: string): Promise<void> => {
  await query('mutation R($id: ID!) { resendInvitation(invitationId: $id) }', z.object({ resendInvitation: z.boolean() }), { id: invitationId })
}

export const revokeInvitation = async (invitationId: string): Promise<void> => {
  await query('mutation R($id: ID!) { revokeInvitation(invitationId: $id) }', z.object({ revokeInvitation: z.boolean() }), { id: invitationId })
}

/** Refused for the last Owner (LAST_OWNER). */
export const changeRole = async (membershipId: string, role: StaffRole): Promise<void> => {
  await query('mutation C($id: ID!, $r: String!) { changeRole(membershipId: $id, role: $r) }', z.object({ changeRole: z.boolean() }), { id: membershipId, r: role })
}

/** Out of this store only; their account and other stores stay. */
export const removeMember = async (membershipId: string): Promise<void> => {
  await query('mutation R($id: ID!) { removeMember(membershipId: $id) }', z.object({ removeMember: z.boolean() }), { id: membershipId })
}

export const accessLevels = ['vendor-stock', 'vendor-catalogue', 'vendor-orders-read', 'vendor-orders-fulfil'] as const
export type AccessLevel = (typeof accessLevels)[number]

const supplierSchema = z.object({
  id: z.string(),
  name: z.string(),
  accessLevel: z.enum(accessLevels),
  shippingMode: z.enum(['to-store', 'to-shopper']),
  labelAccount: z.enum(['store', 'own']).nullable(),
  status: z.enum(['invited', 'active', 'suspended']),
  users: z.number().int(),
  products: z.number().int(),
})
export type Supplier = z.infer<typeof supplierSchema>

/** Every supplier company the store has, with its users and products. */
export const loadSuppliers = (): Promise<Supplier[]> =>
  allPages(
    async (after) =>
      (
        await query(
          'query S($after: String) { suppliers(first: 50, after: $after) { nodes { id name accessLevel shippingMode labelAccount status users products } pageInfo { hasNextPage endCursor } } }',
          z.object({ suppliers: z.object({ nodes: z.array(supplierSchema), pageInfo: pageInfoSchema }) }),
          { after },
        )
      ).suppliers,
  )

export const loadApproval = async (): Promise<boolean> => (await query('{ supplierApprovalRequired }', z.object({ supplierApprovalRequired: z.boolean() }))).supplierApprovalRequired

export const setApproval = async (on: boolean): Promise<void> => {
  await query('mutation A($on: Boolean!) { setApproval(on: $on) }', z.object({ setApproval: z.boolean() }), { on })
}

/** The company and its first user, a Supplier admin, in one (#295). */
export const inviteSupplier = async (input: { name: string; email: string; accessLevel: AccessLevel }): Promise<string> =>
  (await query('mutation I($input: InviteSupplierInput!) { inviteSupplier(input: $input) }', z.object({ inviteSupplier: z.string() }), { input })).inviteSupplier

export const setSupplierAccess = async (id: string, accessLevel: AccessLevel): Promise<void> => {
  await query('mutation A($id: ID!, $a: String!) { setSupplierAccess(id: $id, accessLevel: $a) }', z.object({ setSupplierAccess: z.boolean() }), { id, a: accessLevel })
}

export const setShippingMode = async (id: string, shippingMode: 'to-store' | 'to-shopper', labelAccount: 'store' | 'own'): Promise<void> => {
  await query('mutation S($id: ID!, $m: String!, $l: String) { setSupplierShippingMode(id: $id, shippingMode: $m, labelAccount: $l) }', z.object({ setSupplierShippingMode: z.boolean() }), { id, m: shippingMode, l: labelAccount })
}

/** Answers how many of its products the suspension hid. */
export const suspendSupplier = async (id: string, hideProducts: boolean): Promise<number> =>
  (await query('mutation S($id: ID!, $h: Boolean!) { suspendSupplier(id: $id, hideProducts: $h) }', z.object({ suspendSupplier: z.number().int() }), { id, h: hideProducts })).suspendSupplier

export const resumeSupplier = async (id: string): Promise<number> => (await query('mutation R($id: ID!) { resumeSupplier(id: $id) }', z.object({ resumeSupplier: z.number().int() }), { id })).resumeSupplier

/** Its people go, its products are hidden and kept as its own; answers how many products were hidden. */
export const removeSupplier = async (id: string): Promise<number> => (await query('mutation R($id: ID!) { removeSupplier(id: $id) }', z.object({ removeSupplier: z.number().int() }), { id })).removeSupplier

export const addSupplierPerson = async (id: string, email: string): Promise<void> => {
  await query('mutation A($id: ID!, $e: String!) { addSupplierPerson(id: $id, email: $e) }', z.object({ addSupplierPerson: z.string() }), { id, e: email })
}

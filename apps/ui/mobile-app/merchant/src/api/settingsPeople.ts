import { z } from 'zod'
import { allPages, pageInfoSchema, typedQuery, type ApiClient } from '../graphql'

// Settings › People and Suppliers (SetTeam; FIRST-RELEASE (store) §15; ACCESS.md §5–§7): the store's own people with the invitations
// waiting, and its supplier companies. Invitations go out by email from the server; nothing here ever holds a link or a token.

const paging = 'pageInfo { hasNextPage hasPreviousPage startCursor endCursor }'

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

/** Everyone in the store and every invitation waiting. A store's team is small, so the screen reads it whole. */
export const loadPeople = (client: ApiClient): Promise<Person[]> =>
  allPages(
    async (after) =>
      (
        await typedQuery(client)(
          `query People($after: String) { people(first: 50, after: $after) { nodes { id kind name email role you since expiresAt expired } ${paging} } }`,
          z.object({ people: z.object({ nodes: z.array(personSchema), pageInfo: pageInfoSchema }) }),
          { after },
        )
      ).people,
  )

export const inviteMember = async (client: ApiClient, email: string, role: StaffRole): Promise<void> => {
  await typedQuery(client)('mutation InviteMember($e: String!, $r: String!) { inviteMember(email: $e, role: $r) }', z.object({ inviteMember: z.boolean().nullable() }), { e: email, r: role })
}

/** A new link by email; the old one stops working. */
export const resendInvitation = async (client: ApiClient, invitationId: string): Promise<void> => {
  await typedQuery(client)('mutation ResendInvitation($id: ID!) { resendInvitation(invitationId: $id) }', z.object({ resendInvitation: z.boolean().nullable() }), { id: invitationId })
}

export const revokeInvitation = async (client: ApiClient, invitationId: string): Promise<void> => {
  await typedQuery(client)('mutation RevokeInvitation($id: ID!) { revokeInvitation(invitationId: $id) }', z.object({ revokeInvitation: z.boolean().nullable() }), { id: invitationId })
}

/** Refused for the last Owner (`LAST_OWNER`). */
export const changeRole = async (client: ApiClient, membershipId: string, role: StaffRole): Promise<void> => {
  await typedQuery(client)('mutation ChangeRole($id: ID!, $r: String!) { changeRole(membershipId: $id, role: $r) }', z.object({ changeRole: z.boolean().nullable() }), { id: membershipId, r: role })
}

/** Out of this store only; their account and other stores stay. */
export const removeMember = async (client: ApiClient, membershipId: string): Promise<void> => {
  await typedQuery(client)('mutation RemoveMember($id: ID!) { removeMember(membershipId: $id) }', z.object({ removeMember: z.boolean().nullable() }), { id: membershipId })
}

export const accessLevels = ['vendor-stock', 'vendor-catalogue', 'vendor-orders-read', 'vendor-orders-fulfil'] as const
export type AccessLevel = (typeof accessLevels)[number]

export const shippingModes = ['to-store', 'to-shopper'] as const
export type ShippingMode = (typeof shippingModes)[number]
export type LabelAccount = 'store' | 'own'

const supplierSchema = z.object({
  id: z.string(),
  name: z.string(),
  accessLevel: z.enum(accessLevels),
  shippingMode: z.enum(shippingModes),
  labelAccount: z.enum(['store', 'own']).nullable(),
  status: z.enum(['invited', 'active', 'suspended']),
  users: z.number().int(),
  products: z.number().int(),
})
export type Supplier = z.infer<typeof supplierSchema>

/** Every supplier company the store has, with its users and products. */
export const loadSuppliers = (client: ApiClient): Promise<Supplier[]> =>
  allPages(
    async (after) =>
      (
        await typedQuery(client)(
          `query Suppliers($after: String) { suppliers(first: 50, after: $after) { nodes { id name accessLevel shippingMode labelAccount status users products } ${paging} } }`,
          z.object({ suppliers: z.object({ nodes: z.array(supplierSchema), pageInfo: pageInfoSchema }) }),
          { after },
        )
      ).suppliers,
  )

export const loadApproval = async (client: ApiClient): Promise<boolean> =>
  (await typedQuery(client)('{ supplierApprovalRequired }', z.object({ supplierApprovalRequired: z.boolean().nullable() }))).supplierApprovalRequired === true

export const setApproval = async (client: ApiClient, on: boolean): Promise<void> => {
  await typedQuery(client)('mutation SetApproval($on: Boolean!) { setApproval(on: $on) }', z.object({ setApproval: z.boolean().nullable() }), { on })
}

/** The company and its first user, a Supplier admin, in one go; the invitation goes out by email. */
export const inviteSupplier = async (client: ApiClient, input: { name: string; email: string; accessLevel: AccessLevel }): Promise<void> => {
  await typedQuery(client)('mutation InviteSupplier($input: InviteSupplierInput!) { inviteSupplier(input: $input) }', z.object({ inviteSupplier: z.string().nullable() }), { input })
}

export const setSupplierAccess = async (client: ApiClient, id: string, accessLevel: AccessLevel): Promise<void> => {
  await typedQuery(client)('mutation SetSupplierAccess($id: ID!, $a: String!) { setSupplierAccess(id: $id, accessLevel: $a) }', z.object({ setSupplierAccess: z.boolean().nullable() }), { id, a: accessLevel })
}

export const setShippingMode = async (client: ApiClient, id: string, shippingMode: ShippingMode, labelAccount: LabelAccount): Promise<void> => {
  await typedQuery(client)(
    'mutation SetShippingMode($id: ID!, $m: String!, $l: String) { setSupplierShippingMode(id: $id, shippingMode: $m, labelAccount: $l) }',
    z.object({ setSupplierShippingMode: z.boolean().nullable() }),
    { id, m: shippingMode, l: labelAccount },
  )
}

/** Answers how many of its products the suspension hid. */
export const suspendSupplier = async (client: ApiClient, id: string, hideProducts: boolean): Promise<number> =>
  (await typedQuery(client)('mutation SuspendSupplier($id: ID!, $h: Boolean!) { suspendSupplier(id: $id, hideProducts: $h) }', z.object({ suspendSupplier: z.number().int().nullable() }), { id, h: hideProducts })).suspendSupplier ?? 0

export const resumeSupplier = async (client: ApiClient, id: string): Promise<void> => {
  await typedQuery(client)('mutation ResumeSupplier($id: ID!) { resumeSupplier(id: $id) }', z.object({ resumeSupplier: z.number().int().nullable() }), { id })
}

/** Its people go, its products are hidden and kept as its own; answers how many products were hidden. */
export const removeSupplier = async (client: ApiClient, id: string): Promise<number> =>
  (await typedQuery(client)('mutation RemoveSupplier($id: ID!) { removeSupplier(id: $id) }', z.object({ removeSupplier: z.number().int().nullable() }), { id })).removeSupplier ?? 0

/** Added by the Owner on the company's row; the invitation goes out by email. */
export const addSupplierPerson = async (client: ApiClient, id: string, email: string): Promise<void> => {
  await typedQuery(client)('mutation AddSupplierPerson($id: ID!, $e: String!) { addSupplierPerson(id: $id, email: $e) }', z.object({ addSupplierPerson: z.string().nullable() }), { id, e: email })
}

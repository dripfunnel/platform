import { exportJobFields, exportJobSchema, readExportJob, type ExportJob } from '@dripfunnel/shared/graphql'
import { z } from 'zod'
import { query } from './client'
import { moneySchema } from './orders'

// Customers (FIRST-RELEASE §7, PortalOrders › Customers; apps/api/schema/store.graphql, src/apis/store/customers.ts):
// the merchant side's, Owner, Manager and Staff alike. "Suppliers never see this list."

const summarySchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  city: z.string().nullable(),
  tags: z.array(z.string()),
  orders: z.number().int(),
  spent: z.array(moneySchema),
})
export type CustomerSummary = z.infer<typeof summarySchema>

const pageInfoSchema = z.object({ hasNextPage: z.boolean(), hasPreviousPage: z.boolean(), startCursor: z.string().nullable(), endCursor: z.string().nullable() })

export interface CustomerPage {
  rows: CustomerSummary[]
  next: string | null
  previous: string | null
}

export const customerPageSize = 25

export const loadCustomers = async (groupId: string | null, search: string, cursor: { after?: string | null; before?: string | null } = {}): Promise<CustomerPage> => {
  const { customers } = await query(
    `query C($g: ID, $s: String, $first: Int, $after: String, $before: String) {
      customers(groupId: $g, search: $s, first: $first, after: $after, before: $before) { nodes { id name email phone city tags orders spent { amount currency } } pageInfo { hasNextPage hasPreviousPage startCursor endCursor } }
    }`,
    z.object({ customers: z.object({ nodes: z.array(summarySchema), pageInfo: pageInfoSchema }) }),
    { g: groupId, s: search.trim() || null, first: customerPageSize, after: cursor.after ?? null, before: cursor.before ?? null },
  )
  return { rows: customers.nodes, next: customers.pageInfo.hasNextPage ? customers.pageInfo.endCursor : null, previous: customers.pageInfo.hasPreviousPage ? customers.pageInfo.startCursor : null }
}

export const loadCustomerCount = async (): Promise<number> => (await query('{ customerCount }', z.object({ customerCount: z.number().int() }))).customerCount

const groupSchema = z.object({ id: z.string(), name: z.string(), description: z.string().nullable(), members: z.number().int() })
export type CustomerGroup = z.infer<typeof groupSchema>

export const loadCustomerGroups = async (): Promise<CustomerGroup[]> => (await query('{ customerGroups { id name description members } }', z.object({ customerGroups: z.array(groupSchema) }))).customerGroups

const addressSchema = z.object({ id: z.string(), name: z.string(), line1: z.string(), line2: z.string().nullable(), city: z.string(), region: z.string().nullable(), postalCode: z.string().nullable(), country: z.string(), phone: z.string().nullable(), isDefault: z.boolean() })
export type CustomerAddress = z.infer<typeof addressSchema>

const customerSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  phoneVerified: z.boolean(),
  tags: z.array(z.string()),
  note: z.string().nullable(),
  // opted_in, stopped, declined or not_asked; source checkout, email, added_by_hand or recorded_by_store.
  consent: z.object({ state: z.string(), at: z.string().nullable(), source: z.string().nullable(), channels: z.array(z.string()) }),
  groupIds: z.array(z.string()),
  addresses: z.array(addressSchema),
  city: z.string().nullable(),
  ordersCount: z.number().int(),
  orders: z.array(z.object({ id: z.string(), number: z.string(), placedAt: z.string(), state: z.string(), paymentState: z.string(), fulfilmentState: z.string(), total: moneySchema })),
  spent: z.array(moneySchema),
})
export type Customer = z.infer<typeof customerSchema>

export const loadCustomer = async (id: string): Promise<Customer | null> =>
  (
    await query(
      `query C($id: ID!) { customer(id: $id) {
        id name email phone phoneVerified tags note consent { state at source channels } groupIds
        addresses { id name line1 line2 city region postalCode country phone isDefault } city ordersCount
        orders { id number placedAt state paymentState fulfilmentState total { amount currency } } spent { amount currency }
      } }`,
      z.object({ customer: customerSchema.nullable() }),
      { id },
    )
  ).customer

/** Order emails only: adding someone sends them nothing. An email already a customer answers that one (`existed`). */
export const addCustomer = async (name: string, email: string, phone: string | null): Promise<{ id: string; existed: boolean }> =>
  (await query('mutation A($n: String!, $e: String!, $p: String) { addCustomer(name: $n, email: $e, phone: $p) { id existed } }', z.object({ addCustomer: z.object({ id: z.string(), existed: z.boolean() }) }), { n: name, e: email, p: phone })).addCustomer

export interface CustomerAddressInput {
  name: string
  line1: string
  line2: string | null
  city: string
  region: string | null
  postalCode: string | null
  country: string
}

/** Name, number and the default delivery address; past orders keep the details they were placed with. */
export const updateCustomer = async (id: string, edit: { name: string; phone: string | null; address: CustomerAddressInput | null }): Promise<void> => {
  await query('mutation U($id: ID!, $n: String, $p: String, $a: CustomerAddressInput) { updateCustomer(id: $id, name: $n, phone: $p, address: $a) }', z.object({ updateCustomer: z.boolean() }), { id, n: edit.name, p: edit.phone, a: edit.address })
}

/** The API's limits on a customer's tags (`setCustomerTags`, FIRST-RELEASE §19): how many, and how long each. */
export const customerTagLimits = { count: 20, length: 24 } as const

export const setCustomerTags = async (id: string, tags: string[]): Promise<string[]> =>
  (await query('mutation T($id: ID!, $t: [String!]!) { setCustomerTags(id: $id, tags: $t) }', z.object({ setCustomerTags: z.array(z.string()) }), { id, t: tags })).setCustomerTags

export const setCustomerNote = async (id: string, note: string | null): Promise<void> => {
  await query('mutation N($id: ID!, $n: String) { setCustomerNote(id: $id, note: $n) }', z.object({ setCustomerNote: z.boolean() }), { id, n: note })
}

/** They asked the store to stop: no more marketing; order and delivery emails still go. */
export const recordMarketingStop = async (id: string): Promise<void> => {
  await query('mutation S($id: ID!) { recordMarketingStop(id: $id) }', z.object({ recordMarketingStop: z.boolean() }), { id })
}

export const setCustomerGroups = async (id: string, groupIds: string[]): Promise<void> => {
  await query('mutation G($id: ID!, $g: [ID!]!) { setCustomerGroups(id: $id, groupIds: $g) }', z.object({ setCustomerGroups: z.array(z.string()) }), { id, g: groupIds })
}

export const createGroup = async (name: string): Promise<string> => (await query('mutation C($n: String!) { createGroup(name: $n) }', z.object({ createGroup: z.string() }), { n: name })).createGroup

export const renameGroup = async (group: CustomerGroup, name: string): Promise<void> => {
  await query('mutation U($id: ID!, $n: String!, $d: String) { updateGroup(id: $id, name: $n, description: $d) }', z.object({ updateGroup: z.boolean() }), { id: group.id, n: name, d: group.description })
}

/** Its members leave it. */
export const deleteGroup = async (id: string): Promise<void> => {
  await query('mutation D($id: ID!) { deleteGroup(id: $id) }', z.object({ deleteGroup: z.boolean() }), { id })
}

export const loadCustomerExport = async (id: string): Promise<ExportJob | null> =>
  readExportJob((await query(`query E($id: ID!) { customerExport(id: $id) { ${exportJobFields} } }`, z.object({ customerExport: exportJobSchema.nullable() }), { id })).customerExport)

export const requestCustomerExport = async (groupId: string | null, search: string): Promise<ExportJob> => {
  const { exportCustomers: id } = await query('mutation E($g: ID, $s: String) { exportCustomers(groupId: $g, search: $s) }', z.object({ exportCustomers: z.string() }), { g: groupId, s: search.trim() || null })
  return { id, state: 'preparing', entries: null, url: null, expiresAt: null }
}

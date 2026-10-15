import { z } from 'zod'
import { pageInfoSchema, typedQuery, type ApiClient } from '../graphql'
import { exportJobFields, exportJobSchema, readExportJob, type ExportJob } from './exportJob'

// Customers on the Store API (FIRST-RELEASE (store) §7; apps/api src/apis/store/customers.ts): the merchant side's, Owner, Manager
// and Staff alike. "Suppliers never see this list." Totals are the API's; amounts are digit strings of minor units.

const moneySchema = z.object({ amount: z.string().regex(/^-?\d+$/), currency: z.string() })

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

export const customerPageSize = 25

export type CustomerQuery = { groupId: string | null; search: string }

/** One page; `after` pages on. */
export const loadCustomers = async (client: ApiClient, { groupId, search }: CustomerQuery, after: string | null = null): Promise<{ rows: CustomerSummary[]; next: string | null }> => {
  const { customers } = await typedQuery(client)(
    `query Customers($group: ID, $search: String, $first: Int, $after: String) {
      customers(groupId: $group, search: $search, first: $first, after: $after) { nodes { id name email phone city tags orders spent { amount currency } } pageInfo { hasNextPage hasPreviousPage startCursor endCursor } }
    }`,
    z.object({ customers: z.object({ nodes: z.array(summarySchema), pageInfo: pageInfoSchema }) }),
    { group: groupId, search: search.trim() || null, first: customerPageSize, after },
  )
  return { rows: customers.nodes, next: customers.pageInfo.hasNextPage ? customers.pageInfo.endCursor : null }
}

export const loadCustomerCount = async (client: ApiClient): Promise<number> => (await typedQuery(client)('{ customerCount }', z.object({ customerCount: z.number().int() }))).customerCount

const groupSchema = z.object({ id: z.string(), name: z.string(), description: z.string().nullable(), members: z.number().int() })
export type CustomerGroup = z.infer<typeof groupSchema>

export const loadCustomerGroups = async (client: ApiClient): Promise<CustomerGroup[]> =>
  (await typedQuery(client)('{ customerGroups { id name description members } }', z.object({ customerGroups: z.array(groupSchema) }))).customerGroups

const addressSchema = z.object({
  id: z.string(),
  name: z.string(),
  line1: z.string(),
  line2: z.string().nullable(),
  city: z.string(),
  region: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.string(),
  phone: z.string().nullable(),
  isDefault: z.boolean(),
})
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
  orders: z.array(z.object({ id: z.string(), number: z.string(), placedAt: z.string(), state: z.string(), paymentState: z.string().nullable(), fulfilmentState: z.string().nullable(), total: moneySchema })),
  spent: z.array(moneySchema),
})
export type Customer = z.infer<typeof customerSchema>

/** The customer with their newest orders, or null for one that isn't here. */
export const loadCustomer = async (client: ApiClient, id: string): Promise<Customer | null> =>
  (
    await typedQuery(client)(
      `query Customer($id: ID!) { customer(id: $id) {
        id name email phone phoneVerified tags note consent { state at source channels } groupIds
        addresses { id name line1 line2 city region postalCode country phone isDefault } city ordersCount
        orders { id number placedAt state paymentState fulfilmentState total { amount currency } } spent { amount currency }
      } }`,
      z.object({ customer: customerSchema.nullable() }),
      { id },
    )
  ).customer

/** Order emails only: adding someone sends them nothing. An email already a customer answers that one (`existed`). */
export const addCustomer = async (client: ApiClient, name: string, email: string, phone: string | null): Promise<{ id: string; existed: boolean }> =>
  (
    await typedQuery(client)(
      'mutation AddCustomer($name: String!, $email: String!, $phone: String) { addCustomer(name: $name, email: $email, phone: $phone) { id existed } }',
      z.object({ addCustomer: z.object({ id: z.string(), existed: z.boolean() }) }),
      { name, email, phone },
    )
  ).addCustomer

export type CustomerAddressInput = {
  name: string
  line1: string
  line2: string | null
  city: string
  region: string | null
  postalCode: string | null
  country: string
}

/** Name, number and the default delivery address; past orders keep the details they were placed with. */
export const updateCustomer = async (client: ApiClient, id: string, edit: { name: string; phone: string | null; address: CustomerAddressInput | null }): Promise<void> => {
  await typedQuery(client)(
    'mutation UpdateCustomer($id: ID!, $name: String, $phone: String, $address: CustomerAddressInput) { updateCustomer(id: $id, name: $name, phone: $phone, address: $address) }',
    z.object({ updateCustomer: z.boolean().nullable() }),
    { id, name: edit.name, phone: edit.phone, address: edit.address },
  )
}

/** The API's limits on a customer's tags (`setCustomerTags`): how many, and how long each. */
export const customerTagLimits = { count: 20, length: 24 } as const

export const setCustomerTags = async (client: ApiClient, id: string, tags: string[]): Promise<void> => {
  await typedQuery(client)('mutation SetTags($id: ID!, $tags: [String!]!) { setCustomerTags(id: $id, tags: $tags) }', z.object({ setCustomerTags: z.array(z.string()).nullable() }), { id, tags })
}

export const setCustomerNote = async (client: ApiClient, id: string, note: string | null): Promise<void> => {
  await typedQuery(client)('mutation SetNote($id: ID!, $note: String) { setCustomerNote(id: $id, note: $note) }', z.object({ setCustomerNote: z.boolean().nullable() }), { id, note })
}

/** They asked the store to stop: no more marketing; order and delivery emails still go. */
export const recordMarketingStop = async (client: ApiClient, id: string): Promise<void> => {
  await typedQuery(client)('mutation Stop($id: ID!) { recordMarketingStop(id: $id) }', z.object({ recordMarketingStop: z.boolean().nullable() }), { id })
}

export const setCustomerGroups = async (client: ApiClient, id: string, groupIds: string[]): Promise<void> => {
  await typedQuery(client)('mutation SetGroups($id: ID!, $groups: [ID!]!) { setCustomerGroups(id: $id, groupIds: $groups) }', z.object({ setCustomerGroups: z.array(z.string()).nullable() }), { id, groups: groupIds })
}

export const createGroup = async (client: ApiClient, name: string): Promise<void> => {
  await typedQuery(client)('mutation CreateGroup($name: String!) { createGroup(name: $name) }', z.object({ createGroup: z.string().nullable() }), { name })
}

/** The description is kept as it is: the prototype edits only the name. */
export const renameGroup = async (client: ApiClient, group: CustomerGroup, name: string): Promise<void> => {
  await typedQuery(client)(
    'mutation UpdateGroup($id: ID!, $name: String!, $description: String) { updateGroup(id: $id, name: $name, description: $description) }',
    z.object({ updateGroup: z.boolean().nullable() }),
    { id: group.id, name, description: group.description },
  )
}

/** Its members leave it. */
export const deleteGroup = async (client: ApiClient, id: string): Promise<void> => {
  await typedQuery(client)('mutation DeleteGroup($id: ID!) { deleteGroup(id: $id) }', z.object({ deleteGroup: z.boolean().nullable() }), { id })
}

/** The job, or null for one that isn't here (or isn't this person's). */
export const loadCustomerExport = async (client: ApiClient, id: string): Promise<ExportJob | null> =>
  readExportJob((await typedQuery(client)(`query CustomerExport($id: ID!) { customerExport(id: $id) { ${exportJobFields} } }`, z.object({ customerExport: exportJobSchema.nullable() }), { id })).customerExport)

/** The people the list shows, as a job the API prepares. */
export const requestCustomerExport = async (client: ApiClient, { groupId, search }: CustomerQuery): Promise<string> =>
  (
    await typedQuery(client)('mutation ExportCustomers($group: ID, $search: String) { exportCustomers(groupId: $group, search: $search) }', z.object({ exportCustomers: z.string() }), {
      group: groupId,
      search: search.trim() || null,
    })
  ).exportCustomers

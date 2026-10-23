import { z } from 'zod'
import { typedQuery, type ApiClient } from '@dripfunnel/mobile-shared/graphql'

// Settings › Customer accounts (SetAccess; ACCESS.md §2.1; apps/api src/apis/store/customerAccounts.ts): how shoppers sign in, and how many accounts each way.

export const signInModes = ['email', 'mobile', 'both'] as const
export type SignInMode = (typeof signInModes)[number]

const accountsSchema = z.object({
  mode: z.enum(signInModes),
  customers: z.number().int(),
  withEmail: z.number().int(),
  withPhone: z.number().int(),
  phoneOnly: z.number().int(),
})
export type CustomerAccounts = z.infer<typeof accountsSchema>

const fields = 'mode customers withEmail withPhone phoneOnly'

export const loadCustomerAccounts = async (client: ApiClient): Promise<CustomerAccounts | null> =>
  (await typedQuery(client)(`{ customerAccounts { ${fields} } }`, z.object({ customerAccounts: accountsSchema.nullable() }))).customerAccounts

export const saveCustomerAccounts = async (client: ApiClient, mode: SignInMode): Promise<CustomerAccounts | null> =>
  (await typedQuery(client)(`mutation SaveCustomerAccounts($m: String!) { saveCustomerAccounts(mode: $m) { ${fields} } }`, z.object({ saveCustomerAccounts: accountsSchema.nullable() }), { m: mode })).saveCustomerAccounts

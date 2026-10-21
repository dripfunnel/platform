import { z } from 'zod'
import { query } from './client'

// Settings › Customer accounts (SetAccess, FIRST-RELEASE §15 and §19 "Built on #308"; apps/api/src/apis/store/customerAccounts.ts).

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

export const loadCustomerAccounts = async (): Promise<CustomerAccounts> => (await query(`{ customerAccounts { ${fields} } }`, z.object({ customerAccounts: accountsSchema }))).customerAccounts

export const saveCustomerAccounts = async (mode: SignInMode): Promise<CustomerAccounts> =>
  (await query(`mutation S($m: String!) { saveCustomerAccounts(mode: $m) { ${fields} } }`, z.object({ saveCustomerAccounts: accountsSchema }), { m: mode })).saveCustomerAccounts

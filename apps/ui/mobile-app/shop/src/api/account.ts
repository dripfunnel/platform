import { z } from 'zod'
import { decode, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { operation, type Operation } from './operation'

// The shopper's sign-in, account and saved addresses on the Shop API (apps/api schema/shop.graphql; ACCESS.md §2.1). A session
// token is given once, by a sign-in; the account itself is never kept for offline: it holds the customer's personal details.

export type SignInWays = { email: boolean; phone: boolean }
export type Channel = 'EMAIL' | 'PHONE'
export type Pin = { latitude: number; longitude: number }

export type SavedAddress = {
  id: string
  name: string
  line1: string
  line2: string
  city: string
  region: string
  postalCode: string
  country: string
  phone: string
  isDefault: boolean
  pin: Pin | null
}

export type Account = { name: string | null; email: string | null; phone: string | null; addresses: SavedAddress[] }
export type AccountRead = { account: Account | null; countries: string[] }

export type AddressInput = Omit<SavedAddress, 'id' | 'isDefault'>

const text = z.string().nullable().optional()

export const signInWaysOperation = (): Operation<SignInWays> =>
  operation(null, '{ signInOptions { email phone } }', {}, (data) => {
    const { signInOptions } = decode(z.object({ signInOptions: z.object({ email: z.boolean().nullable(), phone: z.boolean().nullable() }).nullable() }), data)
    return { email: signInOptions?.email === true, phone: signInOptions?.phone === true }
  })

const addressFields = 'id name line1 line2 city region postalCode country phone isDefault latitude longitude'

const addressSchema = z.object({
  id: z.string(),
  name: text,
  line1: text,
  line2: text,
  city: text,
  region: text,
  postalCode: text,
  country: text,
  phone: text,
  isDefault: z.boolean().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
})

const pinOf = (a: z.infer<typeof addressSchema>): Pin | null => (typeof a.latitude === 'number' && typeof a.longitude === 'number' ? { latitude: a.latitude, longitude: a.longitude } : null)

export const accountOperation = (): Operation<AccountRead> =>
  operation(null, `{ account { name email phone addresses { ${addressFields} } } store { markets { countries } } }`, {}, (data) => {
    const answer = decode(
      z.object({
        account: z.object({ name: text, email: text, phone: text, addresses: z.array(addressSchema).nullable().optional() }).nullable(),
        store: z.object({ markets: z.array(z.object({ countries: z.array(z.string()).nullable().optional() })).nullable().optional() }).nullable().optional(),
      }),
      data,
    )
    const countries = [...new Set((answer.store?.markets ?? []).flatMap((market) => market.countries ?? []))]
    const raw = answer.account
    if (!raw) return { account: null, countries }
    return {
      countries,
      account: {
        name: raw.name ?? null,
        email: raw.email ?? null,
        phone: raw.phone ?? null,
        addresses: (raw.addresses ?? []).map((a) => ({
          id: a.id,
          name: a.name ?? '',
          line1: a.line1 ?? '',
          line2: a.line2 ?? '',
          city: a.city ?? '',
          region: a.region ?? '',
          postalCode: a.postalCode ?? '',
          country: a.country ?? '',
          phone: a.phone ?? '',
          isDefault: a.isDefault === true,
          pin: pinOf(a),
        })),
      },
    }
  })

const session = z.object({ sessionToken: z.string() })

/** Email and password: answers the session token, or throws SIGN_IN_REFUSED (never saying whether the email has an account). */
export const signIn = async (client: ApiClient, email: string, password: string): Promise<string> =>
  decode(z.object({ signIn: session }), await client.request<unknown>('mutation($email: String!, $password: String!) { signIn(email: $email, password: $password) { sessionToken } }', { email, password })).signIn.sessionToken

/** Asks for a six-digit code to an email or number; answers the same whether or not it has an account. */
export const requestCode = async (client: ApiClient, channel: Channel, to: string): Promise<void> => {
  await client.request<unknown>('mutation($channel: ShopSignInChannel!, $to: String!) { requestSignInCode(channel: $channel, to: $to) }', { channel, to })
}

/** The code proves the email or number; with `name` and `password` it also makes the account or sets the password (register and reset). */
export const verifyCode = async (client: ApiClient, input: { channel: Channel; to: string; code: string; name?: string; password?: string }): Promise<string> =>
  decode(
    z.object({ verifySignInCode: session }),
    await client.request<unknown>(
      'mutation($channel: ShopSignInChannel!, $to: String!, $code: String!, $name: String, $password: String) { verifySignInCode(channel: $channel, to: $to, code: $code, name: $name, password: $password) { sessionToken } }',
      { channel: input.channel, to: input.to, code: input.code, name: input.name ?? null, password: input.password ?? null },
    ),
  ).verifySignInCode.sessionToken

export const renameAccount = async (client: ApiClient, name: string): Promise<void> => {
  await client.request<unknown>('mutation($name: String) { updateAccount(name: $name) }', { name: name.trim() || null })
}

/** The address as the API takes it: the pin goes as both halves or neither. */
export const addressInput = (a: AddressInput) => ({
  name: a.name.trim(),
  line1: a.line1.trim(),
  line2: a.line2.trim() || null,
  city: a.city.trim(),
  region: a.region.trim() || null,
  postalCode: a.postalCode.trim() || null,
  country: a.country,
  phone: a.phone.replace(/[\s().-]/g, '') || null,
  latitude: a.pin?.latitude ?? null,
  longitude: a.pin?.longitude ?? null,
})

export const saveAddress = async (client: ApiClient, input: { id: string | null; address: AddressInput; isDefault: boolean }): Promise<void> => {
  await client.request<unknown>('mutation($id: ID, $address: ShopSavedAddressInput!, $isDefault: Boolean) { saveAddress(id: $id, address: $address, isDefault: $isDefault) }', {
    id: input.id,
    address: addressInput(input.address),
    isDefault: input.isDefault,
  })
}

export const deleteAddress = async (client: ApiClient, id: string): Promise<void> => {
  await client.request<unknown>('mutation($id: ID!) { deleteAddress(id: $id) }', { id })
}

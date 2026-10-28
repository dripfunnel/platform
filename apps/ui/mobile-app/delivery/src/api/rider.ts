import { z } from 'zod'
import { decode, type ApiClient } from '@dripfunnel/mobile-shared/graphql'

// Written from apps/api/schema/delivery.graphql: a rider's sign-in and own profile (docs/api/DELIVERY.md §4, §5).
export const vehicleTypes = ['bike', 'scooter', 'car', 'bicycle', 'foot'] as const
export type VehicleType = (typeof vehicleTypes)[number]

const riderSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  photoAssetId: z.string().nullable(),
  vehicleType: z.enum(vehicleTypes).nullable(),
  vehicleNumber: z.string().nullable(),
})
export type Rider = z.infer<typeof riderSchema>

const riderFields = 'id name phone photoAssetId vehicleType vehicleNumber'

export const requestCode = async (client: ApiClient, phone: string): Promise<void> => {
  await client.request('mutation($phone: String!) { requestCode(phone: $phone) }', { phone })
}

/** The session token, given once. */
export const signIn = async (client: ApiClient, phone: string, code: string): Promise<string> => {
  const { signIn: session } = decode(z.object({ signIn: z.object({ sessionToken: z.string().min(1) }) }), await client.request<unknown>('mutation($phone: String!, $code: String!) { signIn(phone: $phone, code: $code) { sessionToken } }', { phone, code }))
  return session.sessionToken
}

export const signOut = async (client: ApiClient): Promise<void> => {
  await client.request('mutation { signOut }')
}

/** Null when the API reads the token as signed out. */
export const fetchMe = async (client: ApiClient): Promise<Rider | null> => decode(z.object({ me: riderSchema.nullable() }), await client.request<unknown>(`{ me { ${riderFields} } }`)).me

export type ProfileInput = { name: string; photoAssetId: string | null; vehicleType: VehicleType; vehicleNumber: string | null }

/** Sets the name, photo, vehicle type and number together, so a photo not changed is sent back as it is. */
export const updateProfile = async (client: ApiClient, input: ProfileInput): Promise<Rider> =>
  decode(
    z.object({ updateProfile: riderSchema }),
    await client.request<unknown>(`mutation($name: String!, $photoAssetId: ID, $vehicleType: VehicleType, $vehicleNumber: String) { updateProfile(name: $name, photoAssetId: $photoAssetId, vehicleType: $vehicleType, vehicleNumber: $vehicleNumber) { ${riderFields} } }`, input),
  ).updateProfile

export const deleteMyAccount = async (client: ApiClient): Promise<void> => {
  await client.request('mutation { deleteMyAccount }')
}

/** The store's country, to preselect the country code; null when the store has none or the read fails. */
export const fetchStoreCountry = async (client: ApiClient): Promise<string | null> => {
  const answer = await client.request<unknown>('{ store { address { country } } }', undefined, { get: true }).catch(() => null)
  const parsed = z.object({ store: z.object({ address: z.object({ country: z.string().nullable() }).nullable() }).nullable() }).safeParse(answer)
  const country = parsed.success ? (parsed.data.store?.address?.country ?? null) : null
  return country && /^[A-Z]{2}$/.test(country) ? country : null
}

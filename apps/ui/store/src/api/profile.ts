import { z } from 'zod'
import { query } from './client'

// My profile's reads and writes (FIRST-RELEASE §4; apps/api/schema/store.graphql, src/apis/store/profile.ts):
// the signed-in person's own account, the same in every store of this partner.

const profileSchema = z.object({
  name: z.string(),
  email: z.string(),
  pendingEmail: z.string().nullable(),
  phone: z.string().nullable(),
  theme: z.enum(['light', 'dark']).nullable(),
  passwordChangedAt: z.string().nullable(),
  twoFactor: z.object({ method: z.enum(['app', 'sms']).nullable(), backupCodesLeft: z.number().int(), required: z.boolean() }),
})

export type Profile = z.infer<typeof profileSchema>

const profileFields = 'name email pendingEmail phone theme passwordChangedAt twoFactor { method backupCodesLeft required }'

export const loadProfile = async (): Promise<Profile | null> => (await query(`{ profile { ${profileFields} } }`, z.object({ profile: profileSchema.nullable() }))).profile

const sessionSchema = z.object({ device: z.string().nullable(), current: z.boolean(), createdAt: z.string(), lastUsedAt: z.string() })

export type SignedInSession = z.infer<typeof sessionSchema>

export const loadSessions = async (): Promise<SignedInSession[]> => (await query(`{ mySessions { device current createdAt lastUsedAt } }`, z.object({ mySessions: z.array(sessionSchema).nullable() }))).mySessions ?? []

const entrySchema = z.object({
  id: z.string(),
  occurredAt: z.string(),
  action: z.string(),
  result: z.enum(['success', 'denied', 'failed']),
  storeId: z.string().nullable(),
  target: z.object({ type: z.string(), label: z.string().nullable() }).nullable(),
})

export type MyActivityEntry = z.infer<typeof entrySchema>

const activitySchema = z.object({ myActivity: z.object({ nodes: z.array(entrySchema), pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }) }) })

export const activityPageSize = 20

/** One page of the person's own entries, newest first (LOGGING §6 "own activity"). */
export const loadMyActivity = async (after: string | null): Promise<{ entries: MyActivityEntry[]; next: string | null }> => {
  const { myActivity } = await query(
    `query Mine($first: Int, $after: String) { myActivity(first: $first, after: $after) { nodes { id occurredAt action result storeId target { type label } } pageInfo { hasNextPage endCursor } } }`,
    activitySchema,
    { first: activityPageSize, after },
  )
  return { entries: myActivity.nodes, next: myActivity.pageInfo.hasNextPage ? myActivity.pageInfo.endCursor : null }
}

/** Name and mobile; the theme is setTheme's alone. */
export const updateProfile = async (details: { name: string; phone: string | null }): Promise<Profile> =>
  (await query(`mutation Update($name: String!, $phone: String) { updateProfile(name: $name, phone: $phone) { ${profileFields} } }`, z.object({ updateProfile: profileSchema }), details)).updateProfile

/** The theme alone, so it never writes back a name or number read earlier. */
export const setTheme = async (theme: 'light' | 'dark'): Promise<Profile> =>
  (await query(`mutation Theme($theme: String!) { setTheme(theme: $theme) { ${profileFields} } }`, z.object({ setTheme: profileSchema }), { theme })).setTheme

/** Sends a link to the new address; the email changes when it is clicked (ACCESS.md §4). */
export const changeEmail = async (email: string, password: string): Promise<void> => {
  await query(`mutation Email($email: String!, $password: String!) { changeEmail(email: $email, password: $password) }`, z.object({ changeEmail: z.boolean().nullable() }), { email, password })
}

/** Signs out every other device (ACCESS.md §4). */
export const changePassword = async (current: string, next: string): Promise<void> => {
  await query(`mutation Password($current: String!, $next: String!) { changePassword(current: $current, next: $next) }`, z.object({ changePassword: z.boolean().nullable() }), { current, next })
}

const stepSchema = z.object({ secret: z.string().nullable(), uri: z.string().nullable(), hint: z.string().nullable(), done: z.boolean(), backupCodes: z.array(z.string()).nullable() })

export type SecondFactorStep = z.infer<typeof stepSchema>

const setSecondFactor = async (variables: { method: 'app' | 'sms' | 'off'; code?: string; password?: string }): Promise<SecondFactorStep> =>
  (await query(`mutation Second($method: String!, $code: String, $password: String) { setSecondFactor(method: $method, code: $code, password: $password) { secret uri hint done backupCodes } }`, z.object({ setSecondFactor: stepSchema }), variables)).setSecondFactor

/** Starts setting up a method, proven by the password: an app gets its setup key, SMS texts the profile's number. */
export const startSecondFactor = (method: 'app' | 'sms', password: string) => setSecondFactor({ method, password })

/** Confirms the method with its first code; turning it on answers ten backup codes, once. */
export const confirmSecondFactor = (method: 'app' | 'sms', code: string) => setSecondFactor({ method, code })

export const turnOffSecondFactor = (password: string) => setSecondFactor({ method: 'off', password })

export const regenerateBackupCodes = async (): Promise<string[]> => (await query(`mutation { regenerateBackupCodes }`, z.object({ regenerateBackupCodes: z.array(z.string()) }))).regenerateBackupCodes

export const signOutOtherSessions = async (): Promise<number> => (await query(`mutation { signOutOtherSessions }`, z.object({ signOutOtherSessions: z.number().int() }))).signOutOtherSessions

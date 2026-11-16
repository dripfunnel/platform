import { z } from 'zod'
import { typedQuery, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { codeChannelSchema, codeChannelsSchema, type CodeChannel } from './auth'

// My profile on the Store API (ACCESS.md §4 "My profile, built on #290"; apps/api src/apis/store/profile.ts).

export const profileSchema = z.object({
  name: z.string().nullable(),
  email: z.string(),
  phone: z.string().nullable(),
  pendingEmail: z.string().nullable(),
  passwordChangedAt: z.string().nullable(),
  twoFactor: z.object({ method: z.enum(['app', 'sms']).nullable(), backupCodesLeft: z.number().nullable() }),
  codeChannels: codeChannelsSchema,
})

export type Profile = z.infer<typeof profileSchema>

const profileFields = `name email phone pendingEmail passwordChangedAt twoFactor { method backupCodesLeft } codeChannels { whatsapp sms }`

export const loadProfile = async (client: ApiClient): Promise<Profile> => (await typedQuery(client)(`{ profile { ${profileFields} } }`, z.object({ profile: profileSchema }))).profile

export const saveDetails = async (client: ApiClient, details: { name: string; phone: string | null }): Promise<Profile> =>
  (await typedQuery(client)(`mutation Save($name: String!, $phone: String) { updateProfile(name: $name, phone: $phone) { ${profileFields} } }`, z.object({ updateProfile: profileSchema }), details)).updateProfile

/** The API asks for the current password and mails a link to the new address; the email changes once it is followed. */
export const changeEmail = async (client: ApiClient, email: string, password: string): Promise<void> => {
  await typedQuery(client)(`mutation Email($email: String!, $password: String!) { changeEmail(email: $email, password: $password) }`, z.object({ changeEmail: z.boolean().nullable() }), { email: email.trim(), password })
}

/** Every other session of the person ends with it (ACCESS.md §4). */
export const changePassword = async (client: ApiClient, current: string, next: string): Promise<void> => {
  await typedQuery(client)(`mutation Password($current: String!, $next: String!) { changePassword(current: $current, next: $next) }`, z.object({ changePassword: z.boolean().nullable() }), { current, next })
}

// Two-step sign-in: a start needs the password and answers the setup key (app) or where the phone code went;
// a confirm needs the code; the backup codes come back once, when the factor is first turned on.
const stepSchema = z.object({
  done: z.boolean().nullable(),
  hint: z.string().nullable(),
  channel: codeChannelSchema.nullable(),
  secret: z.string().nullable(),
  uri: z.string().nullable(),
  backupCodes: z.array(z.string()).nullable(),
})

export type SecondFactorStep = z.infer<typeof stepSchema>

const stepFields = `done hint channel secret uri backupCodes`

export type SecondFactorMethod = 'app' | 'sms'

/** Every start needs the password, a phone code sent again too; `channel` asks for WhatsApp or SMS (ACCESS.md §4). */
export const startSecondFactor = async (client: ApiClient, method: SecondFactorMethod, password: string, channel?: CodeChannel): Promise<SecondFactorStep> =>
  (
    await typedQuery(client)(
      `mutation Start($method: String!, $password: String, $channel: String) { setSecondFactor(method: $method, password: $password, channel: $channel) { ${stepFields} } }`,
      z.object({ setSecondFactor: stepSchema }),
      { method, password, channel: channel ?? null },
    )
  ).setSecondFactor

export const confirmSecondFactor = async (client: ApiClient, method: SecondFactorMethod, code: string): Promise<SecondFactorStep> =>
  (await typedQuery(client)(`mutation Confirm($method: String!, $code: String) { setSecondFactor(method: $method, code: $code) { ${stepFields} } }`, z.object({ setSecondFactor: stepSchema }), { method, code })).setSecondFactor

export const turnOffSecondFactor = async (client: ApiClient, password: string): Promise<void> => {
  await typedQuery(client)(`mutation Off($password: String) { setSecondFactor(method: "off", password: $password) { done } }`, z.object({ setSecondFactor: z.object({ done: z.boolean().nullable() }) }), { password })
}

export const regenerateBackupCodes = async (client: ApiClient): Promise<string[]> =>
  (await typedQuery(client)(`mutation Codes { regenerateBackupCodes }`, z.object({ regenerateBackupCodes: z.array(z.string()) }))).regenerateBackupCodes

const signedInSchema = z.object({ current: z.boolean(), device: z.string().nullable(), lastUsedAt: z.string().nullable(), createdAt: z.string().nullable() })

export type SignedInSession = z.infer<typeof signedInSchema>

export const loadSessions = async (client: ApiClient): Promise<SignedInSession[]> =>
  (await typedQuery(client)(`{ mySessions { current device lastUsedAt createdAt } }`, z.object({ mySessions: z.array(signedInSchema) }))).mySessions

export const signOutOtherSessions = async (client: ApiClient): Promise<void> => {
  await typedQuery(client)(`mutation Others { signOutOtherSessions }`, z.object({ signOutOtherSessions: z.number().nullable() }))
}

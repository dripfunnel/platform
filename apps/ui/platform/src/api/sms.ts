import { ApiError } from '@dripfunnel/shared/graphql'
import { smsProviders, smsRoutes, type SmsAccountInput, type SmsProvider, type SmsRoute } from '@dripfunnel/shared/messaging'
import { z } from 'zod'
import { query } from './client'

// Settings › Integrations, SMS (#1018 on #1017's API): the partner's own MSG91, Twilio and AWS SNS accounts, the account for
// each route (DripFunnel's too, where Admin enabled it, #1544), and its switch. A secret comes back as its last four.

const accountSchema = z.object({
  provider: z.enum(smsProviders),
  hint: z.string(),
  status: z.enum(['untested', 'ok', 'rejected']),
  lastTestedAt: z.string().nullable(),
  /** India's seven template ids (and SNS's DLT header and entity); null for Twilio, which has none. */
  templatesComplete: z.boolean().nullable(),
})
const statusSchema = z.object({
  enabled: z.boolean(),
  // Admin enabled DripFunnel's SMS for the partner (#1543).
  dripfunnel: z.boolean(),
  routes: z.array(
    z.object({
      route: z.enum(smsRoutes),
      // The partner's pick: a provider, `dripfunnel`, or null for whichever is set up.
      provider: z.enum([...smsProviders, 'dripfunnel']).nullable(),
      // DripFunnel's account serves this route for the partner now.
      dripfunnel: z.boolean(),
      sender: z.enum(['own', 'dripfunnel']).nullable(),
    }),
  ),
  accounts: z.array(accountSchema),
})
export type SmsAccount = z.infer<typeof accountSchema>
export type SmsStatus = z.infer<typeof statusSchema>
export type SmsPick = SmsProvider | 'dripfunnel'

export const smsRefusals = ['INVALID_INPUT', 'TEMPLATES_INCOMPLETE', 'ACCOUNT_INCOMPLETE', 'KEY_REJECTED', 'PROVIDER_UNAVAILABLE', 'NOT_CONFIGURED', 'NOT_FOUND', 'DRIPFUNNEL_UNAVAILABLE'] as const
export type SmsRefusal = (typeof smsRefusals)[number]
export type SmsResult = { ok: true; status: 'ok' | 'rejected' | null } | { ok: false; reason: SmsRefusal }

const resultSchema = z.object({ ok: z.boolean(), reason: z.string().nullable(), status: z.string().nullable() })
const fields = 'ok reason status'

const resultOf = (r: z.infer<typeof resultSchema> | undefined, field: string): SmsResult => {
  if (!r) throw new ApiError('BAD_RESPONSE', `No ${field} in the answer.`)
  if (r.ok) return { ok: true, status: r.status === 'ok' || r.status === 'rejected' ? r.status : null }
  const known = smsRefusals.find((code) => code === r.reason)
  if (!known) throw new ApiError(r.reason ?? 'UNKNOWN', 'The API refused with a code this console does not know.')
  return { ok: false, reason: known }
}

export const loadSms = async (): Promise<SmsStatus> =>
  (await query(`{ smsAccounts { enabled dripfunnel routes { route provider dripfunnel sender } accounts { provider hint status lastTestedAt templatesComplete } } }`, z.object({ smsAccounts: statusSchema }))).smsAccounts

export const saveSms = async (input: SmsAccountInput): Promise<SmsResult> =>
  resultOf(
    (
      await query(
        `mutation Save($provider: String!, $authKey: String, $templates: [PartnerSmsTemplateInput!], $accountSid: String, $authToken: String, $messagingServiceSid: String, $accessKeyId: String, $secretAccessKey: String, $region: String, $senderId: String, $entityId: String) { saveSmsAccount(provider: $provider, authKey: $authKey, templates: $templates, accountSid: $accountSid, authToken: $authToken, messagingServiceSid: $messagingServiceSid, accessKeyId: $accessKeyId, secretAccessKey: $secretAccessKey, region: $region, senderId: $senderId, entityId: $entityId) { ${fields} } }`,
        z.object({ saveSmsAccount: resultSchema }),
        input,
      )
    ).saveSmsAccount,
    'saveSmsAccount',
  )

export const testSms = async (provider: SmsProvider): Promise<SmsResult> =>
  resultOf((await query(`mutation Test($provider: String!) { testSmsAccount(provider: $provider) { ${fields} } }`, z.object({ testSmsAccount: resultSchema }), { provider })).testSmsAccount, 'testSmsAccount')

export const removeSms = async (provider: SmsProvider): Promise<SmsResult> =>
  resultOf((await query(`mutation Remove($provider: String!) { removeSmsAccount(provider: $provider) { ${fields} } }`, z.object({ removeSmsAccount: resultSchema }), { provider })).removeSmsAccount, 'removeSmsAccount')

/** `dripfunnel` picks DripFunnel's account; null hands the route back to the first of its providers the partner holds. */
export const setSmsRoute = async (route: SmsRoute, provider: SmsPick | null): Promise<SmsResult> =>
  resultOf((await query(`mutation Route($route: String!, $provider: String) { setSmsRoute(route: $route, provider: $provider) { ${fields} } }`, z.object({ setSmsRoute: resultSchema }), { route, provider })).setSmsRoute, 'setSmsRoute')

export const setSmsEnabled = async (enabled: boolean): Promise<SmsResult> =>
  resultOf((await query(`mutation Set($enabled: Boolean!) { setSmsEnabled(enabled: $enabled) { ${fields} } }`, z.object({ setSmsEnabled: resultSchema }), { enabled })).setSmsEnabled, 'setSmsEnabled')

import { ApiError } from '@dripfunnel/shared/graphql'
import { z } from 'zod'
import { query } from './client'

// Settings › Integrations, SMS (#1018 on #1017's API): the partner's own MSG91, Twilio and AWS SNS accounts, the provider
// for each route, and its switch. A secret goes up once and comes back as its last four characters.

/** What the platform texts, each one DLT template in India, in the API's order (THIRD-PARTY-ACCESS §4). */
export const smsMessages = ['code.second_factor', 'code.verify_phone', 'code.shopper_sign_in', 'order.confirmed', 'order.shipped', 'order.delivered', 'rider.invited'] as const
export type SmsMessage = (typeof smsMessages)[number]
export const smsProviders = ['msg91', 'twilio', 'sns'] as const
export type SmsProvider = (typeof smsProviders)[number]
export const smsRoutes = ['india', 'rest'] as const
export type SmsRoute = (typeof smsRoutes)[number]
/** Each route's providers, in the order a route without a pick takes them. */
export const routeProviders: Record<SmsRoute, readonly [SmsProvider, SmsProvider]> = { india: ['msg91', 'sns'], rest: ['twilio', 'sns'] }

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
  routes: z.array(z.object({ route: z.enum(smsRoutes), provider: z.enum(smsProviders).nullable() })),
  accounts: z.array(accountSchema),
})
export type SmsAccount = z.infer<typeof accountSchema>
export type SmsStatus = z.infer<typeof statusSchema>

export const smsRefusals = ['INVALID_INPUT', 'TEMPLATES_INCOMPLETE', 'ACCOUNT_INCOMPLETE', 'KEY_REJECTED', 'PROVIDER_UNAVAILABLE', 'NOT_CONFIGURED', 'NOT_FOUND'] as const
export type SmsRefusal = (typeof smsRefusals)[number]
export type SmsResult = { ok: true; status: 'ok' | 'rejected' | null } | { ok: false; reason: SmsRefusal }

/** The providers' shapes (#1017's `core/sms.ts`), checked here so the dialog says what's wrong before sending. */
export const smsShapes = {
  authKey: /^[A-Za-z0-9]{16,64}$/,
  templateId: /^[A-Za-z0-9_-]{1,64}$/,
  accountSid: /^AC[0-9a-f]{32}$/,
  authToken: /^[0-9a-f]{32}$/,
  messagingServiceSid: /^MG[0-9a-f]{32}$/,
  accessKeyId: /^(AKIA|ASIA)[A-Z0-9]{16}$/,
  secretAccessKey: /^[A-Za-z0-9/+]{40}$/,
  region: /^[a-z]{2}(-[a-z]+)+-\d$/,
  senderId: /^[A-Za-z0-9]{3,11}$/,
  entityId: /^\d{10,30}$/,
}

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
  (await query(`{ smsAccounts { enabled routes { route provider } accounts { provider hint status lastTestedAt templatesComplete } } }`, z.object({ smsAccounts: statusSchema }))).smsAccounts

type Templates = { message: SmsMessage; templateId: string }[]
export type SmsInput =
  | { provider: 'msg91'; authKey: string; templates: Templates }
  | { provider: 'twilio'; accountSid: string; authToken: string; messagingServiceSid: string }
  /** India's part (sender id, entity id, templates) is all or none: left out, the account sends outside India only. */
  | { provider: 'sns'; accessKeyId: string; secretAccessKey: string; region: string; senderId?: string; entityId?: string; templates?: Templates }

export const saveSms = async (input: SmsInput): Promise<SmsResult> =>
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

/** Null hands the route back to the first of its providers the partner holds an account for. */
export const setSmsRoute = async (route: SmsRoute, provider: SmsProvider | null): Promise<SmsResult> =>
  resultOf((await query(`mutation Route($route: String!, $provider: String) { setSmsRoute(route: $route, provider: $provider) { ${fields} } }`, z.object({ setSmsRoute: resultSchema }), { route, provider })).setSmsRoute, 'setSmsRoute')

export const setSmsEnabled = async (enabled: boolean): Promise<SmsResult> =>
  resultOf((await query(`mutation Set($enabled: Boolean!) { setSmsEnabled(enabled: $enabled) { ${fields} } }`, z.object({ setSmsEnabled: resultSchema }), { enabled })).setSmsEnabled, 'setSmsEnabled')

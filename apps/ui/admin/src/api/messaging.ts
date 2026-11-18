// DripFunnel's own SMS and WhatsApp accounts, and Admin's per-partner switches, on the Admin API (#1543, THIRD-PARTY-ACCESS §4).
// Every role reads the status; a Super admin changes the accounts; a secret goes up once and comes back as its last four.
import { ApiError } from '@dripfunnel/shared/graphql'
import { rejectionOf, smsProviders, smsRoutes, whatsAppMessages, type SmsAccountInput, type SmsProvider, type SmsRoute, type WhatsAppAccountInput, type WhatsAppRejection } from '@dripfunnel/shared/messaging'
import { z } from 'zod'
import type { StaffRole } from '../features/shell/staffRoles'
import { query } from './client'
import { isoString } from './decode'

// messaging.manage is Super admin's alone; partners.messaging is a Partner manager's too, on its assigned partners (ACCESS §5.4).
export const messagingManagers: readonly StaffRole[] = ['staff-super-admin']
export const partnerMessagingManagers: readonly StaffRole[] = ['staff-super-admin', 'staff-partner-manager']

const status = z.enum(['untested', 'ok', 'rejected'])
const smsAccountSchema = z.object({ provider: z.enum(smsProviders), hint: z.string(), status, lastTestedAt: isoString.nullable(), templatesComplete: z.boolean().nullable() })
const smsSchema = z.object({
  // `provider` is DripFunnel's pick, null for whichever is set up; `serving` the account that sends the route, if any.
  routes: z.array(z.object({ route: z.enum(smsRoutes), provider: z.enum(smsProviders).nullable(), serving: z.enum(smsProviders).nullable() })),
  accounts: z.array(smsAccountSchema),
})
const whatsAppAccountSchema = z.object({
  hint: z.string(),
  businessAccountId: z.string().nullable(),
  phoneNumberId: z.string().nullable(),
  language: z.string().nullable(),
  templates: z.array(z.object({ message: z.enum(whatsAppMessages), name: z.string().nullable() })),
  status,
  lastTestedAt: isoString.nullable(),
})
const whatsAppSchema = z.object({ enabled: z.boolean(), account: whatsAppAccountSchema.nullable() })

export type PlatformSmsAccount = z.infer<typeof smsAccountSchema>
export type PlatformSms = z.infer<typeof smsSchema>
export type PlatformWhatsAppAccount = z.infer<typeof whatsAppAccountSchema>
export type PlatformWhatsApp = z.infer<typeof whatsAppSchema>
export interface Messaging {
  sms: PlatformSms
  whatsapp: PlatformWhatsApp
}

const smsFields = 'routes { route provider serving } accounts { provider hint status lastTestedAt templatesComplete }'
const whatsAppFields = 'enabled account { hint businessAccountId phoneNumberId language templates { message name } status lastTestedAt }'

export const loadMessaging = async (): Promise<Messaging> => {
  const { platformSms, platformWhatsApp } = await query(`query Messaging { platformSms { ${smsFields} } platformWhatsApp { ${whatsAppFields} } }`, z.object({ platformSms: smsSchema, platformWhatsApp: whatsAppSchema }))
  return { sms: platformSms, whatsapp: platformWhatsApp }
}

// The codes a change answers with (apps/api saas/platformMessaging MessagingRefusal), worded by the screen.
export const messagingRefusals = ['INVALID_INPUT', 'TEMPLATES_INCOMPLETE', 'ACCOUNT_INCOMPLETE', 'KEY_REJECTED', 'PROVIDER_UNAVAILABLE', 'NOT_CONFIGURED', 'NOT_FOUND', 'NO_ACCOUNT', 'NO_CODE_TEMPLATE'] as const
export type MessagingRefusal = (typeof messagingRefusals)[number]
export type MessagingResult = { ok: true; status: 'ok' | 'rejected' | null; rejection: WhatsAppRejection | null } | { ok: false; reason: MessagingRefusal; rejection: WhatsAppRejection | null }

const resultSchema = z.object({ ok: z.boolean(), reason: z.string().nullable(), status: z.string().nullable(), problem: z.string().nullable(), template: z.string().nullable() })
const result = 'ok reason status problem template'

const change = async (field: string, args: string, call: string, variables: Record<string, unknown> = {}): Promise<MessagingResult> => {
  const answer = await query(`mutation ${field}${args} { ${field}${call} { ${result} } }`, z.object({ [field]: resultSchema }), variables)
  const r = answer[field]
  if (!r) throw new ApiError('BAD_RESPONSE', `No ${field} in the answer.`)
  if (r.ok) return { ok: true, status: r.status === 'ok' || r.status === 'rejected' ? r.status : null, rejection: rejectionOf(r) }
  const known = messagingRefusals.find((code) => code === r.reason)
  if (!known) throw new ApiError(r.reason ?? 'UNKNOWN', 'The API refused with a code this console does not know.')
  return { ok: false, reason: known, rejection: rejectionOf(r) }
}

export const savePlatformSms = (input: SmsAccountInput, reason: string) =>
  change(
    'savePlatformSmsAccount',
    '($provider: String!, $authKey: String, $templates: [PlatformSmsTemplateInput!], $accountSid: String, $authToken: String, $messagingServiceSid: String, $accessKeyId: String, $secretAccessKey: String, $region: String, $senderId: String, $entityId: String, $reason: String!)',
    '(provider: $provider, authKey: $authKey, templates: $templates, accountSid: $accountSid, authToken: $authToken, messagingServiceSid: $messagingServiceSid, accessKeyId: $accessKeyId, secretAccessKey: $secretAccessKey, region: $region, senderId: $senderId, entityId: $entityId, reason: $reason)',
    { ...input, reason },
  )

export const testPlatformSms = (provider: SmsProvider) => change('testPlatformSmsAccount', '($provider: String!)', '(provider: $provider)', { provider })

export const removePlatformSms = (provider: SmsProvider, reason: string) => change('removePlatformSmsAccount', '($provider: String!, $reason: String!)', '(provider: $provider, reason: $reason)', { provider, reason })

/** Null hands the route to the first of its providers DripFunnel holds an account for. */
export const setPlatformSmsRoute = (route: SmsRoute, provider: SmsProvider | null, reason: string) =>
  change('setPlatformSmsRoute', '($route: String!, $provider: String, $reason: String!)', '(route: $route, provider: $provider, reason: $reason)', { route, provider, reason })

export const savePlatformWhatsApp = (input: WhatsAppAccountInput, reason: string) =>
  change(
    'savePlatformWhatsAppAccount',
    '($accessToken: String!, $businessAccountId: String!, $phoneNumberId: String!, $language: String!, $templates: [PlatformWhatsAppTemplateInput!]!, $reason: String!)',
    '(accessToken: $accessToken, businessAccountId: $businessAccountId, phoneNumberId: $phoneNumberId, language: $language, templates: $templates, reason: $reason)',
    { ...input, reason },
  )

export const testPlatformWhatsApp = () => change('testPlatformWhatsAppAccount', '', '')

export const setPlatformWhatsAppEnabled = (enabled: boolean, reason: string) => change('setPlatformWhatsAppEnabled', '($enabled: Boolean!, $reason: String!)', '(enabled: $enabled, reason: $reason)', { enabled, reason })

export const removePlatformWhatsApp = (reason: string) => change('removePlatformWhatsAppAccount', '($reason: String!)', '(reason: $reason)', { reason })

const switchesSchema = z.object({ sms: z.boolean(), whatsapp: z.boolean() })
export type PartnerSwitches = z.infer<typeof switchesSchema>
export type MessagingChannel = keyof PartnerSwitches

/** Admin's two switches for a partner; null when it doesn't exist. */
export const loadPartnerSwitches = async (partnerId: string): Promise<PartnerSwitches | null> =>
  (await query(`query PartnerDfMessaging($partnerId: ID!) { partnerDfMessaging(partnerId: $partnerId) { sms whatsapp } }`, z.object({ partnerDfMessaging: switchesSchema.nullable() }), { partnerId })).partnerDfMessaging

/** Refused as an ApiError: FORBIDDEN outside the caller's role or assignment, NOT_FOUND, INVALID_INPUT. */
export const setPartnerSwitch = async (partnerId: string, channel: MessagingChannel, enabled: boolean, reason: string): Promise<PartnerSwitches> =>
  (
    await query(
      `mutation SetPartnerDfMessaging($partnerId: ID!, $channel: String!, $enabled: Boolean!, $reason: String!) { setPartnerDfMessaging(partnerId: $partnerId, channel: $channel, enabled: $enabled, reason: $reason) { sms whatsapp } }`,
      z.object({ setPartnerDfMessaging: switchesSchema }),
      { partnerId, channel, enabled, reason },
    )
  ).setPartnerDfMessaging

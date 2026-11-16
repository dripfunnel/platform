import { ApiError } from '@dripfunnel/shared/graphql'
import { z } from 'zod'
import { query } from './client'

// Settings › Integrations, WhatsApp (#1505 on #1504's API): the partner's own WhatsApp Business account on Meta's Cloud
// API and its switch. The token goes up once and comes back as its last four characters.

/** The messages an account names a template for, in the API's order: the portal code first. */
export const whatsAppMessages = ['code.portal', 'cart.reminder', 'cart.reminder_code'] as const
export type WhatsAppMessage = (typeof whatsAppMessages)[number]

const accountSchema = z.object({
  hint: z.string(),
  businessAccountId: z.string().nullable(),
  phoneNumberId: z.string().nullable(),
  language: z.string().nullable(),
  templates: z.array(z.object({ message: z.enum(whatsAppMessages), name: z.string().nullable() })),
  status: z.enum(['untested', 'ok', 'rejected']),
  lastTestedAt: z.string().nullable(),
})
const statusSchema = z.object({ enabled: z.boolean(), account: accountSchema.nullable() })
export type WhatsAppAccount = z.infer<typeof accountSchema>
export type WhatsAppStatus = z.infer<typeof statusSchema>

export const whatsAppRefusals = ['INVALID_INPUT', 'KEY_REJECTED', 'PROVIDER_UNAVAILABLE', 'NOT_CONFIGURED', 'NOT_FOUND', 'NO_ACCOUNT', 'NO_CODE_TEMPLATE'] as const
export type WhatsAppRefusal = (typeof whatsAppRefusals)[number]
/** What Meta refused: the token, the number, the business account, or the template for one message. */
export type WhatsAppRejection = { problem: 'token' | 'phone_number' | 'business_account' } | { problem: 'template'; template: WhatsAppMessage }
export type WhatsAppResult = { ok: true; status: 'ok' | 'rejected' | null; rejection: WhatsAppRejection | null } | { ok: false; reason: WhatsAppRefusal; rejection: WhatsAppRejection | null }

/** Meta's shapes (#1504's settings schema), checked here so the dialog says what's wrong before sending. */
export const whatsAppShapes = {
  id: /^\d{5,25}$/,
  token: /^[A-Za-z0-9._-]{20,2048}$/,
  language: /^[a-z]{2,3}(_[A-Za-z]{2,4})?$/,
  template: /^[a-z0-9_]{1,512}$/,
}

const resultSchema = z.object({
  ok: z.boolean(),
  reason: z.string().nullable(),
  status: z.string().nullable(),
  problem: z.string().nullable(),
  template: z.string().nullable(),
})
type RawResult = z.infer<typeof resultSchema>
const fields = 'ok reason status problem template'

const rejectionOf = (r: RawResult): WhatsAppRejection | null => {
  if (r.problem === 'token' || r.problem === 'phone_number' || r.problem === 'business_account') return { problem: r.problem }
  const template = whatsAppMessages.find((m) => m === r.template)
  return r.problem === 'template' && template ? { problem: 'template', template } : null
}

const resultOf = (r: RawResult | undefined, field: string): WhatsAppResult => {
  if (!r) throw new ApiError('BAD_RESPONSE', `No ${field} in the answer.`)
  if (r.ok) return { ok: true, status: r.status === 'ok' || r.status === 'rejected' ? r.status : null, rejection: rejectionOf(r) }
  const known = whatsAppRefusals.find((code) => code === r.reason)
  if (!known) throw new ApiError(r.reason ?? 'UNKNOWN', 'The API refused with a code this console does not know.')
  return { ok: false, reason: known, rejection: rejectionOf(r) }
}

export const loadWhatsApp = async (): Promise<WhatsAppStatus> =>
  (await query(`{ whatsAppAccount { enabled account { hint businessAccountId phoneNumberId language templates { message name } status lastTestedAt } } }`, z.object({ whatsAppAccount: statusSchema }))).whatsAppAccount

export type WhatsAppInput = {
  accessToken: string
  businessAccountId: string
  phoneNumberId: string
  language: string
  /** A blank name is a message the partner sends without WhatsApp. */
  templates: { message: WhatsAppMessage; name: string }[]
}

export const saveWhatsApp = async (input: WhatsAppInput): Promise<WhatsAppResult> =>
  resultOf(
    (
      await query(
        `mutation Save($accessToken: String!, $businessAccountId: String!, $phoneNumberId: String!, $language: String!, $templates: [PartnerWhatsAppTemplateInput!]!) { saveWhatsAppAccount(accessToken: $accessToken, businessAccountId: $businessAccountId, phoneNumberId: $phoneNumberId, language: $language, templates: $templates) { ${fields} } }`,
        z.object({ saveWhatsAppAccount: resultSchema }),
        input,
      )
    ).saveWhatsAppAccount,
    'saveWhatsAppAccount',
  )

export const testWhatsApp = async (): Promise<WhatsAppResult> =>
  resultOf((await query(`mutation { testWhatsAppAccount { ${fields} } }`, z.object({ testWhatsAppAccount: resultSchema }))).testWhatsAppAccount, 'testWhatsAppAccount')

export const setWhatsAppEnabled = async (enabled: boolean): Promise<WhatsAppResult> =>
  resultOf((await query(`mutation Set($enabled: Boolean!) { setWhatsAppEnabled(enabled: $enabled) { ${fields} } }`, z.object({ setWhatsAppEnabled: resultSchema }), { enabled })).setWhatsAppEnabled, 'setWhatsAppEnabled')

export const removeWhatsApp = async (): Promise<WhatsAppResult> =>
  resultOf((await query(`mutation { removeWhatsAppAccount { ${fields} } }`, z.object({ removeWhatsAppAccount: resultSchema }))).removeWhatsAppAccount, 'removeWhatsAppAccount')

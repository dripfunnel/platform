import { ApiError } from '@dripfunnel/shared/graphql'
import { rejectionOf, whatsAppMessages, type WhatsAppMessage, type WhatsAppRejection } from '@dripfunnel/shared/messaging'
import { z } from 'zod'
import { query } from './client'

// Settings › Integrations, WhatsApp (#1505 on #1504's API): the partner's own WhatsApp Business account on Meta's Cloud
// API, its switch, and whose account sends where Admin enabled DripFunnel's (#1544). The token comes back as its last four.

export { whatsAppMessages, whatsAppShapes, type WhatsAppMessage, type WhatsAppRejection } from '@dripfunnel/shared/messaging'

const accountSchema = z.object({
  hint: z.string(),
  businessAccountId: z.string().nullable(),
  phoneNumberId: z.string().nullable(),
  language: z.string().nullable(),
  templates: z.array(z.object({ message: z.enum(whatsAppMessages), name: z.string().nullable() })),
  status: z.enum(['untested', 'ok', 'rejected']),
  lastTestedAt: z.string().nullable(),
})
const whose = z.enum(['own', 'dripfunnel'])
const statusSchema = z.object({
  enabled: z.boolean(),
  account: accountSchema.nullable(),
  // DripFunnel's account is there for the partner: Admin enabled it and it can send codes (#1543).
  dripfunnel: z.boolean(),
  choice: whose.nullable(),
  // Whose account sends while WhatsApp is on; null where none would.
  sender: whose.nullable(),
})
export type WhatsAppAccount = z.infer<typeof accountSchema>
export type WhatsAppStatus = z.infer<typeof statusSchema>
export type WhatsAppChoice = z.infer<typeof whose>

export const whatsAppRefusals = ['INVALID_INPUT', 'KEY_REJECTED', 'PROVIDER_UNAVAILABLE', 'NOT_CONFIGURED', 'NOT_FOUND', 'NO_ACCOUNT', 'NO_CODE_TEMPLATE', 'DRIPFUNNEL_UNAVAILABLE'] as const
export type WhatsAppRefusal = (typeof whatsAppRefusals)[number]
export type WhatsAppResult = { ok: true; status: 'ok' | 'rejected' | null; rejection: WhatsAppRejection | null } | { ok: false; reason: WhatsAppRefusal; rejection: WhatsAppRejection | null }

const resultSchema = z.object({
  ok: z.boolean(),
  reason: z.string().nullable(),
  status: z.string().nullable(),
  problem: z.string().nullable(),
  template: z.string().nullable(),
})
type RawResult = z.infer<typeof resultSchema>
const fields = 'ok reason status problem template'

const resultOf = (r: RawResult | undefined, field: string): WhatsAppResult => {
  if (!r) throw new ApiError('BAD_RESPONSE', `No ${field} in the answer.`)
  if (r.ok) return { ok: true, status: r.status === 'ok' || r.status === 'rejected' ? r.status : null, rejection: rejectionOf(r) }
  const known = whatsAppRefusals.find((code) => code === r.reason)
  if (!known) throw new ApiError(r.reason ?? 'UNKNOWN', 'The API refused with a code this console does not know.')
  return { ok: false, reason: known, rejection: rejectionOf(r) }
}

export const loadWhatsApp = async (): Promise<WhatsAppStatus> =>
  (
    await query(
      `{ whatsAppAccount { enabled dripfunnel choice sender account { hint businessAccountId phoneNumberId language templates { message name } status lastTestedAt } } }`,
      z.object({ whatsAppAccount: statusSchema }),
    )
  ).whatsAppAccount

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

export const setWhatsAppChoice = async (account: WhatsAppChoice): Promise<WhatsAppResult> =>
  resultOf((await query(`mutation Choose($account: String!) { setWhatsAppChoice(account: $account) { ${fields} } }`, z.object({ setWhatsAppChoice: resultSchema }), { account })).setWhatsAppChoice, 'setWhatsAppChoice')

export const removeWhatsApp = async (): Promise<WhatsAppResult> =>
  resultOf((await query(`mutation { removeWhatsAppAccount { ${fields} } }`, z.object({ removeWhatsAppAccount: resultSchema }))).removeWhatsAppAccount, 'removeWhatsAppAccount')

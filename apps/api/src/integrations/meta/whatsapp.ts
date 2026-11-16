import { z } from 'zod'
import { SmsRefused, smsTimeoutMs, SmsUnavailable } from '#core/sms'
import type { WhatsAppAccountCheck, WhatsAppSender } from '#core/whatsapp'

// A partner's WhatsApp Business number on Meta's Cloud API (THIRD-PARTY-ACCESS §2.8, §4; #1504): approved templates only,
// sent and checked with the partner's system-user token. No number, code or token is ever logged or kept in an error.

/** Pinned so a Graph API change reaches us only when this line does. */
export const graphApiVersion = 'v26.0'
const graph = `https://graph.facebook.com/${graphApiVersion}`

export interface MetaWhatsAppCredentials {
  accessToken: string
  phoneNumberId: string
}

const sentSchema = z.object({ messages: z.array(z.object({ id: z.string().min(1) }).loose()).min(1) }).loose()
const errorSchema = z.object({ error: z.object({ code: z.number() }).loose() }).loose()

// Meta's codes for a token, permission, throttling, billing or account problem: the partner's to fix or Meta's to
// clear, so retried, never dropped (#1504). Every other refusal is the message's or the number's, given up.
const accountCodes = new Set([0, 3, 4, 10, 190, 368, 80007, 130429, 131000, 131016, 131031, 131042, 131048, 131056, 133010])
const isAccountCode = (code: number) => accountCodes.has(code) || (code >= 200 && code <= 299)

const codeOf = async (response: Response): Promise<number | null> => {
  const error = errorSchema.safeParse(await response.json().catch(() => null))
  return error.success ? error.data.error.code : null
}

const get = (fetchImpl: typeof fetch, accessToken: string, path: string): Promise<Response> =>
  fetchImpl(`${graph}/${path}`, { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' }, signal: AbortSignal.timeout(smsTimeoutMs) })

export const metaWhatsAppSender = ({ accessToken, phoneNumberId, fetchImpl = fetch }: MetaWhatsAppCredentials & { fetchImpl?: typeof fetch }): WhatsAppSender => ({
  send: async (message, signal) => {
    const timeout = AbortSignal.timeout(smsTimeoutMs)
    const text = (value: string) => ({ type: 'text', text: value })
    const components: unknown[] = [{ type: 'body', parameters: message.vars.map(text) }]
    // An authentication template's Copy code button is a `url` button at index 0 in the send, as Meta documents it.
    if (message.copyCode !== undefined) components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [text(message.copyCode)] })
    let response: Response
    try {
      response = await fetchImpl(`${graph}/${encodeURIComponent(phoneNumberId)}/messages`, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: message.to.replace(/^\+/, ''),
          type: 'template',
          template: { name: message.template, language: { code: message.language }, components },
        }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
    } catch {
      throw new SmsUnavailable('no answer')
    }
    if (response.ok) {
      // A 2xx is Meta accepting the message: retrying an unreadable answer would send it twice.
      const sent = sentSchema.safeParse(await response.json().catch(() => null))
      return { providerId: sent.success ? (sent.data.messages[0]?.id ?? 'meta') : 'meta' }
    }
    const code = await codeOf(response)
    if (response.status >= 500 || response.status === 429 || response.status === 401 || response.status === 403 || (code !== null && isAccountCode(code))) throw new SmsUnavailable(`answered ${response.status}`)
    throw new SmsRefused(`meta_wa_${code ?? response.status}`)
  },
})

const phoneSchema = z.object({ id: z.string() }).loose()
const templatesSchema = z.object({ data: z.array(z.object({ name: z.string(), language: z.string(), status: z.string() }).loose()) }).loose()

type Answer<T> = { ok: true; data: T } | { ok: false; check: WhatsAppAccountCheck }

/** One read: the token's refusal is the token's, any other 4xx is the object's (`refused`). */
const read = async <T>(fetchImpl: typeof fetch, accessToken: string, path: string, schema: z.ZodType<T>, refused: WhatsAppAccountCheck): Promise<Answer<T>> => {
  let response: Response
  try {
    response = await get(fetchImpl, accessToken, path)
  } catch {
    return { ok: false, check: { status: 'unavailable' } }
  }
  if (response.ok) {
    const parsed = schema.safeParse(await response.json().catch(() => null))
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, check: { status: 'unavailable' } }
  }
  if (response.status >= 500 || response.status === 429) return { ok: false, check: { status: 'unavailable' } }
  const code = await codeOf(response)
  if (code === 4 || code === 80007) return { ok: false, check: { status: 'unavailable' } }
  const tokenCode = code !== null && (code === 0 || code === 3 || code === 10 || code === 190 || (code >= 200 && code <= 299))
  if (response.status === 401 || response.status === 403 || tokenCode) return { ok: false, check: { status: 'rejected', problem: 'token' } }
  return { ok: false, check: refused }
}

export interface MetaWhatsAppAccountToCheck extends MetaWhatsAppCredentials {
  businessAccountId: string
  language: string
  /** The templates named on the account, by message: each must be approved in `language`. */
  templates: Readonly<Record<string, string>>
}

/** Reads the phone number, then each named template in the business account; nothing is sent (#1504). */
export const checkMetaWhatsAppAccount = async ({ accessToken, phoneNumberId, businessAccountId, language, templates, fetchImpl = fetch }: MetaWhatsAppAccountToCheck & { fetchImpl?: typeof fetch }): Promise<WhatsAppAccountCheck> => {
  const phone = await read(fetchImpl, accessToken, `${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`, phoneSchema, { status: 'rejected', problem: 'phone_number' })
  if (!phone.ok) return phone.check
  const answers = await Promise.all(
    Object.entries(templates).map(async ([message, name]) => {
      const query = new URLSearchParams({ name, fields: 'name,language,status', limit: '100' })
      const found = await read(fetchImpl, accessToken, `${encodeURIComponent(businessAccountId)}/message_templates?${query.toString()}`, templatesSchema, { status: 'rejected', problem: 'business_account' })
      if (!found.ok) return found.check
      // The name filter may match loosely, so the exact name and language are found here.
      const approved = found.data.data.some((t) => t.name === name && t.language === language && t.status === 'APPROVED')
      return approved ? null : ({ status: 'rejected', problem: 'template', template: message } as const)
    }),
  )
  return answers.find((a) => a?.status === 'unavailable') ?? answers.find((a) => a !== null) ?? { status: 'ok' }
}

import { z } from 'zod'
import { amzDate, authorization } from './sigv4'

// DripFunnel's Amazon SES account (THIRD-PARTY-ACCESS §2.4) through the SES v2 HTTP API, signed
// with SigV4 by an IAM user that may only send. Bounces and complaints come back through hooks/ses.ts.

export const sesTimeoutMs = 8_000

/** SES didn't answer in time, throttled or failed itself: the outbox tries again later. */
export class SesUnavailable extends Error {
  override name = 'SesUnavailable'
}

/** SES refused this message, e.g. an unverified sender or, in the sandbox, recipient. `code` is SES's. */
export class SesRefused extends Error {
  override name = 'SesRefused'
  constructor(readonly code: string) {
    super(`ses refused: ${code}`)
  }
}

export interface SesCredentials {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export interface OutgoingEmail {
  /** `"Display name" <address>`, already formatted by the caller. */
  from: string
  /** Up to 50 (SES's limit); each is named in its own bounce or complaint. */
  to: readonly string[]
  subject: string
  text: string
  html: string
  /** Name/value pairs SES hands back on bounce and complaint events; ids only, never personal data. */
  tags: Record<string, string>
}

export interface SesApi {
  send: (email: OutgoingEmail, signal?: AbortSignal) => Promise<{ messageId: string }>
}

const sentSchema = z.object({ MessageId: z.string().min(1) })
const errorSchema = z.object({ __type: z.string().optional(), code: z.string().optional() }).loose()

// SES's error type arrives as `MessageRejected` or a namespaced `…#MessageRejected`, in the body or the header.
const errorCode = (response: Response, json: unknown) => {
  const parsed = errorSchema.safeParse(json)
  const raw = response.headers.get('x-amzn-errortype') ?? (parsed.success ? (parsed.data.__type ?? parsed.data.code) : undefined) ?? 'refused'
  return raw.split(':')[0]?.split('#').at(-1) ?? 'refused'
}

// SES accepts tag names and values of letters, digits, `_`, `-`, `.` and `@`.
const tagValue = (value: string) => value.replace(/[^A-Za-z0-9_.@-]/g, '_').slice(0, 256)

export const sesClient = ({ region, accessKeyId, secretAccessKey, fetchImpl = fetch, now = () => new Date() }: SesCredentials & { fetchImpl?: typeof fetch; now?: () => Date }): SesApi => ({
  send: async (email, signal) => {
    const host = `email.${region}.amazonaws.com`
    const path = '/v2/email/outbound-emails'
    const body = JSON.stringify({
      FromEmailAddress: email.from,
      Destination: { ToAddresses: email.to },
      Content: {
        Simple: {
          Subject: { Data: email.subject, Charset: 'UTF-8' },
          Body: { Text: { Data: email.text, Charset: 'UTF-8' }, Html: { Data: email.html, Charset: 'UTF-8' } },
        },
      },
      EmailTags: Object.entries(email.tags).map(([Name, Value]) => ({ Name: tagValue(Name), Value: tagValue(Value) })),
    })
    const headers: Record<string, string> = { 'content-type': 'application/json', host, 'x-amz-date': amzDate(now()) }
    const signed = await authorization({ accessKeyId, secretAccessKey, region, service: 'ses' }, { method: 'POST', path, headers, body })
    const timeout = AbortSignal.timeout(sesTimeoutMs)
    let response: Response
    try {
      response = await fetchImpl(`https://${host}${path}`, {
        method: 'POST',
        headers: { ...headers, authorization: signed },
        body,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
    } catch {
      throw new SesUnavailable('no answer')
    }
    const json: unknown = await response.json().catch(() => null)
    if (response.status >= 500 || response.status === 429) throw new SesUnavailable(`answered ${response.status}`)
    if (!response.ok) throw new SesRefused(errorCode(response, json))
    const parsed = sentSchema.safeParse(json)
    if (!parsed.success) throw new SesUnavailable('answered in a shape we do not read')
    return { messageId: parsed.data.MessageId }
  },
})

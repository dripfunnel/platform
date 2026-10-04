import type postgres from 'postgres'
import { z } from 'zod'
import { logEvent } from '#core/log'
import { suppress } from '#db/scoped/emailSuppression'
import { withSystemScope } from '#db/scoped/index'
import { isSnsUrl, snsMessageSchema, type SnsVerifier } from '#integrations/ses/index'

// hooks.<host>/ses (THIRD-PARTY-ACCESS §2.4): SES's bounces and complaints through Amazon SNS. Only
// our own topic is read, since any AWS account's topic is signed by SNS too; then the signature;
// then a permanent bounce or a complaint suppresses each address it names (migrations/0034).
export const sesHookPath = '/ses'

const maxBodyBytes = 256 * 1024
const confirmTimeoutMs = 5_000

const recipients = z.array(z.object({ emailAddress: z.string().max(320) }).loose()).max(100)
// Event publishing says `eventType`; an identity's own notifications say `notificationType`.
const sesEvent = z
  .object({
    eventType: z.string().optional(),
    notificationType: z.string().optional(),
    bounce: z.object({ bounceType: z.string(), bouncedRecipients: recipients }).loose().optional(),
    complaint: z.object({ complainedRecipients: recipients }).loose().optional(),
  })
  .loose()

export interface SesHookDeps {
  sql: postgres.Sql
  verifier: SnsVerifier
  topicArn: string
  fetchImpl?: typeof fetch
  now: () => Date
}

export const handleSesHook = async (request: Request, { sql, verifier, topicArn, fetchImpl = fetch, now }: SesHookDeps): Promise<Response> => {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } })
  if (Number(request.headers.get('content-length') ?? 0) > maxBodyBytes) return new Response(null, { status: 413 })
  const body = await request.text()
  if (new TextEncoder().encode(body).byteLength > maxBodyBytes) return new Response(null, { status: 413 })
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return new Response(null, { status: 400 })
  }
  const parsed = snsMessageSchema.safeParse(json)
  if (!parsed.success || parsed.data.TopicArn !== topicArn) return new Response(null, { status: 400 })
  const message = parsed.data

  let verified: boolean
  try {
    verified = await verifier.verify(message)
  } catch {
    // SNS's certificate couldn't be fetched: a 5xx is how SNS is told to deliver again.
    logEvent({ event: 'ses_event', api: 'hooks', code: 'certificate_unavailable' })
    return new Response(null, { status: 503 })
  }
  if (!verified) return new Response(null, { status: 400 })

  if (message.Type === 'SubscriptionConfirmation') {
    if (!message.SubscribeURL || !isSnsUrl(message.SubscribeURL)) return new Response(null, { status: 400 })
    const confirmed = await fetchImpl(message.SubscribeURL, { signal: AbortSignal.timeout(confirmTimeoutMs) }).then((r) => r.ok, () => false)
    logEvent({ event: 'ses_event', api: 'hooks', code: confirmed ? 'subscribed' : 'subscribe_failed' })
    return new Response(null, { status: confirmed ? 200 : 503 })
  }
  if (message.Type === 'UnsubscribeConfirmation') return new Response(null, { status: 200 })

  let event: z.infer<typeof sesEvent>
  try {
    event = sesEvent.parse(JSON.parse(message.Message))
  } catch {
    // Signed by SNS on our topic but not an SES event: acknowledged, so it isn't sent again.
    logEvent({ event: 'ses_event', api: 'hooks', code: 'unreadable' })
    return new Response(null, { status: 200 })
  }
  const type = event.eventType ?? event.notificationType
  const addresses =
    type === 'Complaint'
      ? { reason: 'complaint' as const, list: event.complaint?.complainedRecipients ?? [] }
      : type === 'Bounce' && event.bounce?.bounceType === 'Permanent'
        ? { reason: 'bounce' as const, list: event.bounce.bouncedRecipients }
        : null
  if (addresses && addresses.list.length > 0) {
    const at = now()
    await withSystemScope(sql, async (tx) => {
      for (const r of addresses.list) await suppress(tx, r.emailAddress, addresses.reason, at)
    })
  }
  logEvent({ event: 'ses_event', api: 'hooks', code: addresses ? addresses.reason : (type ?? 'unknown').toLowerCase(), count: addresses?.list.length ?? 0 })
  return new Response(null, { status: 200 })
}

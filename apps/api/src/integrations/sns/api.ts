import { SmsRefused, smsTimeoutMs, SmsUnavailable, type SmsAccountCheck, type SmsSender } from '#core/sms'
import { amzDate, authorization } from '#integrations/ses/index'

// DripFunnel's or a partner's own AWS SNS account for texts (THIRD-PARTY-ACCESS §2.8, #1017): the Query API's Publish to a
// phone number, signed with SigV4 by an IAM user allowed only `sns:Publish` and `sns:GetSMSAttributes`.

export interface SnsCredentials {
  accessKeyId: string
  secretAccessKey: string
  region: string
  /** India's DLT header and entity, sent with a +91 text's template; absent where the account doesn't serve India. */
  senderId?: string | undefined
  entityId?: string | undefined
}

type Deps = SnsCredentials & { fetchImpl?: typeof fetch; now?: () => Date }

const attribute = (entries: [string, string][]) =>
  Object.fromEntries(
    entries.flatMap(([name, value], i) => [
      [`MessageAttributes.entry.${i + 1}.Name`, name],
      [`MessageAttributes.entry.${i + 1}.Value.DataType`, 'String'],
      [`MessageAttributes.entry.${i + 1}.Value.StringValue`, value],
    ]),
  )

/** One signed Query API call; throws only when SNS gave no answer. */
const call = async ({ accessKeyId, secretAccessKey, region, fetchImpl = fetch, now = () => new Date() }: Deps, params: Record<string, string>, signal?: AbortSignal) => {
  const host = `sns.${region}.amazonaws.com`
  const body = new URLSearchParams({ ...params, Version: '2010-03-31' }).toString()
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8', host, 'x-amz-date': amzDate(now()) }
  const signed = await authorization({ accessKeyId, secretAccessKey, region, service: 'sns' }, { method: 'POST', path: '/', headers, body })
  const timeout = AbortSignal.timeout(smsTimeoutMs)
  const response = await fetchImpl(`https://${host}/`, { method: 'POST', headers: { ...headers, authorization: signed }, body, signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
  return { status: response.status, text: await response.text().catch(() => '') }
}

// SNS answers in XML; its error <Code> (e.g. InvalidParameter) is safe to log, its <Message> can echo the number.
const tag = (xml: string, name: string) => new RegExp(`<${name}>([^<]{1,200})</${name}>`).exec(xml)?.[1] ?? null

export const snsSender = (deps: Deps): SmsSender => ({
  send: async (sms, signal) => {
    const attributes: [string, string][] = [['AWS.SNS.SMS.SMSType', 'Transactional']]
    if (sms.dlt) {
      if (!deps.senderId || !deps.entityId) throw new SmsRefused('no_dlt_template')
      attributes.push(['AWS.SNS.SMS.SenderID', deps.senderId], ['AWS.MM.SMS.EntityId', deps.entityId], ['AWS.MM.SMS.TemplateId', sms.dlt.templateId])
    }
    let answer: { status: number; text: string }
    try {
      answer = await call(deps, { Action: 'Publish', PhoneNumber: sms.to, Message: sms.text, ...attribute(attributes) }, signal)
    } catch {
      throw new SmsUnavailable('no answer')
    }
    const code = tag(answer.text, 'Code')
    // A refused credential is the account owner's to fix, not the number's fault: retried, never dropped.
    if (answer.status >= 500 || answer.status === 429 || answer.status === 401 || answer.status === 403 || code === 'Throttling' || code === 'Throttled') throw new SmsUnavailable(`answered ${answer.status}`)
    if (answer.status < 200 || answer.status >= 300) throw new SmsRefused(`sns_${code ?? answer.status}`)
    // A 2xx is SNS accepting the text: retrying an unreadable answer would send it twice.
    return { providerId: tag(answer.text, 'MessageId') ?? 'unknown' }
  },
})

/** Whether SNS takes the key, by reading the account's SMS settings (`GetSMSAttributes`): nothing is sent (#1017). */
export const checkSnsAccount = async (deps: Deps): Promise<SmsAccountCheck> => {
  let answer: { status: number }
  try {
    answer = await call(deps, { Action: 'GetSMSAttributes' })
  } catch {
    return 'unavailable'
  }
  if (answer.status >= 200 && answer.status < 300) return 'ok'
  return answer.status >= 500 || answer.status === 429 ? 'unavailable' : 'rejected'
}

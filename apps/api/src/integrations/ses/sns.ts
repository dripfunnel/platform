import { importX509 } from 'jose'
import { z } from 'zod'

// Amazon SNS messages carrying SES's bounce and complaint events (THIRD-PARTY-ACCESS §2.4). There is
// no shared secret: each message is signed with a certificate SNS hosts, so the certificate's
// address is checked before it is fetched, and only SignatureVersion 2 (SHA-256) is accepted.
// https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html

export const snsMessageSchema = z
  .object({
    Type: z.enum(['Notification', 'SubscriptionConfirmation', 'UnsubscribeConfirmation']),
    MessageId: z.string().max(100),
    TopicArn: z.string().max(256),
    Message: z.string(),
    Timestamp: z.string().max(40),
    SignatureVersion: z.literal('2'),
    Signature: z.string().max(1024),
    SigningCertURL: z.string().max(512),
    Subject: z.string().max(100).optional(),
    SubscribeURL: z.string().max(2048).optional(),
    Token: z.string().max(1024).optional(),
  })
  .loose()
export type SnsMessage = z.infer<typeof snsMessageSchema>

/** Only SNS's own hosts, over https: anything else would let a caller pick the key that "verifies" it. */
export const isSnsUrl = (value: string, path?: RegExp): boolean => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return url.protocol === 'https:' && /^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(url.hostname) && url.port === '' && (!path || path.test(url.pathname))
}

const signedFields = (message: SnsMessage): (keyof SnsMessage)[] =>
  message.Type === 'Notification'
    ? ['Message', 'MessageId', ...(message.Subject === undefined ? [] : (['Subject'] as const)), 'Timestamp', 'TopicArn', 'Type']
    : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type']

export const stringToSign = (message: SnsMessage): string | null => {
  let out = ''
  for (const field of signedFields(message)) {
    const value = message[field]
    if (typeof value !== 'string') return null
    out += `${field}\n${value}\n`
  }
  return out
}

const base64Bytes = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0))

export const snsCertTimeoutMs = 5_000

/** One per isolate: SNS signs with few certificates, so each is fetched once. */
export const snsVerifier = ({
  fetchImpl = fetch,
  importCertificate = (pem: string) => importX509(pem, 'RS256'),
}: { fetchImpl?: typeof fetch; importCertificate?: (pem: string) => Promise<CryptoKey> } = {}) => {
  const keys = new Map<string, Promise<CryptoKey>>()
  const keyFor = (url: string) => {
    let key = keys.get(url)
    if (!key) {
      key = (async () => {
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(snsCertTimeoutMs) })
        if (!response.ok) throw new Error(`certificate answered ${response.status}`)
        return importCertificate(await response.text())
      })()
      key.catch(() => keys.delete(url))
      keys.set(url, key)
    }
    return key
  }
  return {
    verify: async (message: SnsMessage): Promise<boolean> => {
      if (!isSnsUrl(message.SigningCertURL, /\.pem$/)) return false
      const signed = stringToSign(message)
      if (signed === null) return false
      let signature: Uint8Array<ArrayBuffer>
      try {
        signature = base64Bytes(message.Signature)
      } catch {
        return false
      }
      const key = await keyFor(message.SigningCertURL)
      return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, new TextEncoder().encode(signed))
    },
  }
}
export type SnsVerifier = ReturnType<typeof snsVerifier>

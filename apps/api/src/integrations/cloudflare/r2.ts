import { z } from 'zod'

// The R2 storefront upload credential (THIRD-PARTY-ACCESS.md §2.1): the parent from which the API mints a store build's
// 15-minute credential and signs its 15-minute read links (storefront LIVE-SHOP.md §4 steps 3 and 8). Only this Worker
// holds it; nothing here logs, keeps or returns the parent's values.

const apiBase = 'https://api.cloudflare.com/client/v4'
const timeoutMs = 10_000

export class R2Unavailable extends Error {
  override name = 'R2Unavailable'
}

export interface R2Parent {
  accountId: string
  /** The parent R2 token's access key id, and its S3 secret, which signs the read links. */
  accessKeyId: string
  secretAccessKey: string
  /** The same token's value, which asks Cloudflare's API for temporary credentials. */
  apiToken: string
}

export interface TemporaryCredential {
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
}

export interface StorefrontR2 {
  /** S3's endpoint for the account: the runner uploads there with a temporary credential. */
  endpoint: string
  /** Read and write under `prefix` in `bucket` only, for `ttlSeconds`. */
  mintPrefix: (bucket: string, prefix: string, ttlSeconds: number) => Promise<TemporaryCredential>
  /** A GET link to one object, good for `expiresSeconds` from `now`. */
  readLink: (bucket: string, key: string, expiresSeconds: number, now: Date) => Promise<string>
}

const envelope = z.object({
  success: z.literal(true),
  result: z.object({ accessKeyId: z.string().min(1), secretAccessKey: z.string().min(1), sessionToken: z.string().min(1) }).loose(),
})

const encoder = new TextEncoder()
const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
const sha256Hex = async (text: string) => hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)))
const hmac = async (key: ArrayBuffer | Uint8Array<ArrayBuffer>, text: string): Promise<ArrayBuffer> =>
  crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), encoder.encode(text))

/** RFC 3986 as SigV4 wants it: everything but unreserved characters escaped, `/` kept in paths. */
const uriEncode = (value: string, keepSlash: boolean) =>
  [...encoder.encode(value)].map((b) => {
    const c = String.fromCharCode(b)
    return /[A-Za-z0-9\-._~]/.test(c) || (keepSlash && c === '/') ? c : `%${b.toString(16).toUpperCase().padStart(2, '0')}`
  }).join('')

const amzDate = (now: Date) => now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

/** A SigV4 query-signed GET (AWS's "Authenticating Requests: Using Query Parameters"), which R2 accepts with region `auto`. */
export const presignGet = async (o: { host: string; path: string; accessKeyId: string; secretAccessKey: string; region: string; expiresSeconds: number; now: Date }): Promise<string> => {
  const date = amzDate(o.now)
  const day = date.slice(0, 8)
  const scope = `${day}/${o.region}/s3/aws4_request`
  const query = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${o.accessKeyId}/${scope}`],
    ['X-Amz-Date', date],
    ['X-Amz-Expires', String(o.expiresSeconds)],
    ['X-Amz-SignedHeaders', 'host'],
  ]
    .map(([k, v]) => `${uriEncode(k ?? '', false)}=${uriEncode(v ?? '', false)}`)
    .sort()
    .join('&')
  const path = uriEncode(o.path, true)
  const request = ['GET', path, query, `host:${o.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n')
  const toSign = ['AWS4-HMAC-SHA256', date, scope, await sha256Hex(request)].join('\n')
  let key = await hmac(encoder.encode(`AWS4${o.secretAccessKey}`), day)
  for (const part of [o.region, 's3', 'aws4_request']) key = await hmac(key, part)
  return `https://${o.host}${path}?${query}&X-Amz-Signature=${hex(await hmac(key, toSign))}`
}

export const storefrontR2 = (parent: R2Parent, fetchImpl: typeof fetch = fetch): StorefrontR2 => {
  const host = `${parent.accountId}.r2.cloudflarestorage.com`
  return {
    endpoint: `https://${host}`,
    mintPrefix: async (bucket, prefix, ttlSeconds) => {
      let response: Response
      try {
        response = await fetchImpl(`${apiBase}/accounts/${parent.accountId}/r2/temp-access-credentials`, {
          method: 'POST',
          headers: { authorization: `Bearer ${parent.apiToken}`, 'content-type': 'application/json' },
          body: JSON.stringify({ bucket, parentAccessKeyId: parent.accessKeyId, permission: 'object-read-write', ttlSeconds, prefixes: [prefix] }),
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch {
        throw new R2Unavailable('no answer')
      }
      if (!response.ok) throw new R2Unavailable(`answered ${response.status}`)
      const parsed = envelope.safeParse(await response.json().catch(() => null))
      if (!parsed.success) throw new R2Unavailable('answered in a shape we do not read')
      const { accessKeyId, secretAccessKey, sessionToken } = parsed.data.result
      return { accessKeyId, secretAccessKey, sessionToken }
    },
    readLink: (bucket, key, expiresSeconds, now) =>
      presignGet({ host, path: `/${bucket}/${key}`, accessKeyId: parent.accessKeyId, secretAccessKey: parent.secretAccessKey, region: 'auto', expiresSeconds, now }),
  }
}

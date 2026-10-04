// AWS Signature Version 4 for one request, over Web Crypto (Workers have no AWS SDK).
// https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html

export interface SigningKey {
  accessKeyId: string
  secretAccessKey: string
  region: string
  service: string
}

const encoder = new TextEncoder()

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')

const sha256 = async (data: string) => hex(await crypto.subtle.digest('SHA-256', encoder.encode(data)))

const hmac = async (key: ArrayBuffer | Uint8Array<ArrayBuffer>, data: string) => {
  const imported = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', imported, encoder.encode(data))
}

/** `20150830T123600Z`: ISO 8601 basic, to the second, in UTC. */
export const amzDate = (at: Date) => at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

/**
 * The `authorization` header for a request whose `headers` already hold every header to sign,
 * `host` and `x-amz-date` included. Names are lower-case; values are signed as given.
 */
export const authorization = async (
  key: SigningKey,
  request: { method: string; path: string; query?: string; headers: Record<string, string>; body: string },
): Promise<string> => {
  const date = request.headers['x-amz-date']
  if (!date) throw new Error('x-amz-date must be signed')
  const names = Object.keys(request.headers).sort()
  const canonicalRequest = [
    request.method,
    request.path,
    request.query ?? '',
    ...names.map((name) => `${name}:${(request.headers[name] ?? '').trim()}`),
    '',
    names.join(';'),
    await sha256(request.body),
  ].join('\n')
  const scope = `${date.slice(0, 8)}/${key.region}/${key.service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', date, scope, await sha256(canonicalRequest)].join('\n')
  let signing = await hmac(encoder.encode(`AWS4${key.secretAccessKey}`), date.slice(0, 8))
  for (const part of [key.region, key.service, 'aws4_request']) signing = await hmac(signing, part)
  const signature = hex(await hmac(signing, stringToSign))
  return `AWS4-HMAC-SHA256 Credential=${key.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`
}

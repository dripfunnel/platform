import { describe, expect, it } from 'vitest'
import { presignGet, R2Unavailable, storefrontR2 } from './r2'

// INF 2b (#517): the R2 storefront upload credential's two uses, against a fake Cloudflare API.

const parent = { accountId: 'a'.repeat(32), accessKeyId: 'b'.repeat(32), secretAccessKey: 'c'.repeat(64), apiToken: 'parent-token-value-xyz' }

describe('presignGet', () => {
  it('signs as AWS’s own presigned-URL example does', async () => {
    // docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html, "An example".
    const url = await presignGet({
      host: 'examplebucket.s3.amazonaws.com',
      path: '/test.txt',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      expiresSeconds: 86400,
      now: new Date('2013-05-24T00:00:00Z'),
    })
    expect(url).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    )
  })
})

describe('storefrontR2', () => {
  it('asks for a read-and-write credential on one prefix of one bucket, for the time given, with the parent token', async () => {
    const asked: { url: string; auth: string | null; body: unknown }[] = []
    const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
      asked.push({ url: String(input), auth: new Headers(init?.headers).get('authorization'), body: JSON.parse(String(init?.body)) })
      return Response.json({ success: true, errors: [], result: { accessKeyId: 'tmp-id', secretAccessKey: 'tmp-secret', sessionToken: 'tmp-session' } })
    }) as typeof fetch
    const r2 = storefrontR2(parent, fake)
    expect(await r2.mintPrefix('storefront-sites', 'stores/s1/uploads/b1/', 900)).toEqual({ accessKeyId: 'tmp-id', secretAccessKey: 'tmp-secret', sessionToken: 'tmp-session' })
    expect(asked).toEqual([
      {
        url: `https://api.cloudflare.com/client/v4/accounts/${parent.accountId}/r2/temp-access-credentials`,
        auth: `Bearer ${parent.apiToken}`,
        body: { bucket: 'storefront-sites', parentAccessKeyId: parent.accessKeyId, permission: 'object-read-write', ttlSeconds: 900, prefixes: ['stores/s1/uploads/b1/'] },
      },
    ])
    expect(r2.endpoint).toBe(`https://${parent.accountId}.r2.cloudflarestorage.com`)
  })

  it('says Cloudflare is unavailable for a refusal, a strange answer or no answer, and never repeats the token', async () => {
    const answers = [
      async () => new Response('no', { status: 403 }),
      async () => Response.json({ success: true, result: {} }),
      async () => {
        throw new TypeError('fetch failed')
      },
    ]
    for (const answer of answers) {
      const error = await storefrontR2(parent, answer as unknown as typeof fetch)
        .mintPrefix('storefront-sites', 'stores/s1/uploads/b1/', 900)
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(R2Unavailable)
      expect(String((error as Error).message)).not.toContain(parent.apiToken)
    }
  })

  it('links one object for the time given, signed with the parent key id and never its secret', async () => {
    const url = new URL(await storefrontR2(parent).readLink('storefront-drafts', 'sources/s1/b1.bundle', 900, new Date('2026-10-11T10:00:00Z')))
    expect(url.host).toBe(`${parent.accountId}.r2.cloudflarestorage.com`)
    expect(url.pathname).toBe('/storefront-drafts/sources/s1/b1.bundle')
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900')
    expect(url.searchParams.get('X-Amz-Credential')).toBe(`${parent.accessKeyId}/20261011/auto/s3/aws4_request`)
    expect(url.href).not.toContain(parent.secretAccessKey)
  })
})

import { describe, expect, it } from 'vitest'
import { postPublic } from './publicPost'

const lookup = (answers: Record<string, string[]>) => ({ resolve: async (host: string, type: string) => answers[`${type} ${host}`] ?? [] })

describe('postPublic', () => {
  it('posts to a public https name and answers its status, never following a redirect', async () => {
    const sent: { url: string; init: RequestInit | undefined }[] = []
    const fetchImpl = async (url: URL | RequestInfo, init?: RequestInit) => {
      sent.push({ url: String(url), init })
      return new Response(null, { status: 302, headers: { location: 'https://10.0.0.1/' } })
    }
    const result = await postPublic('https://hooks.example.com/x', '{}', { 'content-type': 'application/json' }, { lookup: lookup({ 'A hooks.example.com': ['93.184.216.34'] }), fetchImpl, timeoutMs: 1000 })
    expect(result).toMatchObject({ ok: true, status: 302 })
    expect(sent).toHaveLength(1)
    expect(sent[0]?.init).toMatchObject({ method: 'POST', redirect: 'manual', body: '{}' })
  })

  it('refuses http, private, loopback, link-local and metadata addresses before any request', async () => {
    let asked = 0
    const fetchImpl = async () => {
      asked++
      return new Response(null)
    }
    const o = { lookup: lookup({ 'A inside.example.com': ['10.1.2.3'], 'A meta.example.com': ['169.254.169.254'], 'AAAA six.example.com': ['fe80::1'], 'A loop.example.com': ['127.0.0.1'] }), fetchImpl, timeoutMs: 1000 }
    expect(await postPublic('http://hooks.example.com/x', '', {}, o)).toMatchObject({ ok: false, code: 'BAD_URL' })
    expect(await postPublic('https://127.0.0.1/x', '', {}, o)).toMatchObject({ ok: false, code: 'BAD_URL' })
    expect(await postPublic('https://localhost/x', '', {}, o)).toMatchObject({ ok: false, code: 'BAD_URL' })
    for (const host of ['inside', 'meta', 'six', 'loop']) expect(await postPublic(`https://${host}.example.com/x`, '', {}, o), host).toMatchObject({ ok: false, code: 'PRIVATE_ADDRESS' })
    expect(asked).toBe(0)
  })

  it('times out a slow endpoint', async () => {
    const fetchImpl = (_: URL | RequestInfo, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    expect(await postPublic('https://hooks.example.com/x', '', {}, { lookup: lookup({ 'A hooks.example.com': ['93.184.216.34'] }), fetchImpl, timeoutMs: 20 })).toMatchObject({ ok: false, code: 'TIMEOUT' })
  })
})

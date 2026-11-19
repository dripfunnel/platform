import { describe, expect, it } from 'vitest'
import { fetchLocal, localLink } from './localFetch'

const prefix = '/shop-api/assets'
const png = new Uint8Array([1, 2, 3, 4])
const o = { maxBytes: 10, timeoutMs: 1_000 }

describe('localLink', () => {
  it('takes only an http(s) *.localhost link to a public asset', () => {
    expect(localLink('https://juptier.my-store.localhost/shop-api/assets/abc?w=1', prefix)?.search).toBe('?w=1')
    expect(localLink('http://store.northstar.localhost/shop-api/assets/abc', prefix)).not.toBeNull()
  })

  it('refuses another host, another path, another scheme and a link that is not one', () => {
    expect(localLink('https://cdn.example.com/shop-api/assets/abc', prefix)).toBeNull()
    expect(localLink('https://localhost/shop-api/assets/abc', prefix)).toBeNull()
    expect(localLink('https://store.localhost/api/graphql', prefix)).toBeNull()
    expect(localLink('https://store.localhost/shop-api/assetsx/abc', prefix)).toBeNull()
    expect(localLink('ftp://store.localhost/shop-api/assets/abc', prefix)).toBeNull()
    expect(localLink('not a link', prefix)).toBeNull()
  })
})

describe('fetchLocal', () => {
  const link = new URL('https://store.localhost/shop-api/assets/abc?w=1')

  it('reads the link from the local Worker, query string included', async () => {
    const asked: string[] = []
    const fetchImpl: typeof fetch = async (url) => {
      asked.push(String(url))
      return new Response(png)
    }
    expect(await fetchLocal(link, { ...o, fetchImpl })).toEqual({ ok: true, bytes: png })
    expect(asked).toEqual(['http://store.localhost:8787/shop-api/assets/abc?w=1'])
  })

  it('does not follow a redirect', async () => {
    const asked: string[] = []
    const fetchImpl: typeof fetch = async (url, init) => {
      asked.push(`${String(url)} ${init?.redirect}`)
      return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } })
    }
    expect(await fetchLocal(link, { ...o, fetchImpl })).toEqual({ ok: false, code: 'UNAVAILABLE' })
    expect(asked).toEqual(['http://store.localhost:8787/shop-api/assets/abc?w=1 manual'])
  })

  it('refuses a body over the cap, by its length or as it is read', async () => {
    expect(await fetchLocal(link, { ...o, fetchImpl: async () => new Response(png, { headers: { 'content-length': '11' } }) })).toEqual({ ok: false, code: 'TOO_LARGE' })
    expect(await fetchLocal(link, { ...o, maxBytes: 3, fetchImpl: async () => new Response(png) })).toEqual({ ok: false, code: 'TOO_LARGE' })
  })

  it('says a missing photo is not found, and a refusal or a failed request is unavailable', async () => {
    expect(await fetchLocal(link, { ...o, fetchImpl: async () => new Response(null, { status: 404 }) })).toEqual({ ok: false, code: 'NOT_FOUND' })
    expect(await fetchLocal(link, { ...o, fetchImpl: async () => new Response(null, { status: 500 }) })).toEqual({ ok: false, code: 'UNAVAILABLE' })
    expect(await fetchLocal(link, { ...o, fetchImpl: async () => Promise.reject(new Error('down')) })).toEqual({ ok: false, code: 'UNAVAILABLE' })
  })
})

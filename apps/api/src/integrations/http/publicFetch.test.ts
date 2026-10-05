import { describe, expect, it } from 'vitest'
import { fetchPublic, isPrivateIpv4, isPrivateIpv6 } from './publicFetch'

const lookup = (answers: Record<string, string[]>) => ({ resolve: async (host: string, type: string) => answers[`${type} ${host}`] ?? [] })
const png = new Uint8Array([1, 2, 3, 4])

describe('fetchPublic', () => {
  it('fetches https from a name that resolves only to public addresses', async () => {
    const result = await fetchPublic('https://cdn.example.com/a.png', { lookup: lookup({ 'A cdn.example.com': ['93.184.216.34'] }), maxBytes: 10, fetchImpl: async () => new Response(png) })
    expect(result).toEqual({ ok: true, bytes: png })
  })

  it('refuses plain http, an address, a local name, and a name resolving to a private address, before any request', async () => {
    let asked = 0
    const fetchImpl = async () => {
      asked++
      return new Response(png)
    }
    const o = { lookup: lookup({ 'A inside.example.com': ['10.1.2.3'], 'AAAA six.example.com': ['fd00::1'], 'A cdn.example.com': ['93.184.216.34'] }), maxBytes: 10, fetchImpl }
    expect(await fetchPublic('http://cdn.example.com/a.png', o)).toEqual({ ok: false, code: 'BAD_URL' })
    expect(await fetchPublic('https://127.0.0.1/a.png', o)).toEqual({ ok: false, code: 'BAD_URL' })
    expect(await fetchPublic('https://printer.local/a.png', o)).toEqual({ ok: false, code: 'BAD_URL' })
    expect(await fetchPublic('https://cdn.example.com:8443/a.png', o)).toEqual({ ok: false, code: 'BAD_URL' })
    expect(await fetchPublic('https://inside.example.com/a.png', o)).toEqual({ ok: false, code: 'PRIVATE_ADDRESS' })
    expect(await fetchPublic('https://six.example.com/a.png', o)).toEqual({ ok: false, code: 'PRIVATE_ADDRESS' })
    expect(await fetchPublic('https://nowhere.example.com/a.png', o)).toEqual({ ok: false, code: 'NOT_FOUND' })
    expect(asked).toBe(0)
  })

  it('checks every redirect the same way', async () => {
    const fetchImpl = async () => new Response(null, { status: 302, headers: { location: 'https://inside.example.com/x' } })
    const result = await fetchPublic('https://cdn.example.com/a.png', { lookup: lookup({ 'A cdn.example.com': ['93.184.216.34'], 'A inside.example.com': ['192.168.0.9'] }), maxBytes: 10, fetchImpl })
    expect(result).toEqual({ ok: false, code: 'PRIVATE_ADDRESS' })
  })

  it('stops past the size cap, says a 404 is gone, and retries a 5xx a bounded number of times', async () => {
    const o = { lookup: lookup({ 'A cdn.example.com': ['93.184.216.34'] }), maxBytes: 3 }
    expect(await fetchPublic('https://cdn.example.com/a.png', { ...o, fetchImpl: async () => new Response(png) })).toEqual({ ok: false, code: 'TOO_LARGE' })
    expect(await fetchPublic('https://cdn.example.com/a.png', { ...o, fetchImpl: async () => new Response('', { status: 404 }) })).toEqual({ ok: false, code: 'NOT_FOUND' })
    let tries = 0
    const failing = async () => {
      tries++
      return new Response('', { status: 503 })
    }
    expect(await fetchPublic('https://cdn.example.com/a.png', { ...o, fetchImpl: failing, tries: 2 })).toEqual({ ok: false, code: 'UNAVAILABLE' })
    expect(tries).toBe(2)
  })

  it('knows the private ranges', () => {
    expect(['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.20.1.1', '192.168.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1'].every(isPrivateIpv4)).toBe(true)
    expect(['93.184.216.34', '8.8.8.8', '172.32.0.1'].some(isPrivateIpv4)).toBe(false)
    expect(['::1', 'fe80::1', 'fd12::1', '::ffff:10.0.0.1', '2001:db8::1'].every(isPrivateIpv6)).toBe(true)
    expect(isPrivateIpv6('2606:4700::1111')).toBe(false)
  })
})

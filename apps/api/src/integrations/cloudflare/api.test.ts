import { describe, expect, it } from 'vitest'
import { cloudflareClient, CloudflareRefused, CloudflareUnavailable, hostStatusOf } from './api'

const host = { id: 'h1', hostname: 'portal.example.com', status: 'pending', ssl: { status: 'initializing' } }
const reply = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))

describe('hostStatusOf', () => {
  it.each([
    ['pending', 'initializing', 'verifying'],
    ['pending', 'pending_validation', 'verifying'],
    ['active', 'pending_issuance', 'issuing'],
    ['pending', 'pending_deployment', 'issuing'],
    ['active', 'active', 'live'],
    ['blocked', 'active', 'failed'],
    ['pending', 'validation_timed_out', 'failed'],
  ] as const)('%s hostname with %s certificate is %s', (status, ssl, expected) => {
    expect(hostStatusOf({ status, ssl: { status: ssl } })).toBe(expected)
  })
})

describe('cloudflareClient', () => {
  it('returns a registered host without creating it again', async () => {
    const calls: string[] = []
    const api = cloudflareClient({ token: 't', zoneId: 'z', fetchImpl: (url, init) => (calls.push(`${init?.method} ${String(url)}`), reply({ success: true, result: [host] })) })
    expect((await api.ensureHostname('portal.example.com')).id).toBe('h1')
    expect(calls).toEqual(['GET https://api.cloudflare.com/client/v4/zones/z/custom_hostnames?hostname=portal.example.com'])
  })

  it('creates the host when none is registered', async () => {
    const methods: string[] = []
    const api = cloudflareClient({
      token: 't',
      zoneId: 'z',
      fetchImpl: (_url, init) => (methods.push(init?.method ?? ''), reply({ success: true, result: init?.method === 'POST' ? host : [] })),
    })
    expect((await api.ensureHostname('portal.example.com')).hostname).toBe('portal.example.com')
    expect(methods).toEqual(['GET', 'POST'])
  })

  it('tells a refusal from an outage', async () => {
    const refused = cloudflareClient({ token: 't', zoneId: 'z', fetchImpl: () => reply({ success: false }, 403) })
    await expect(refused.ensureHostname('a.example.com')).rejects.toBeInstanceOf(CloudflareRefused)
    const down = cloudflareClient({ token: 't', zoneId: 'z', fetchImpl: () => reply({}, 503) })
    await expect(down.ensureHostname('a.example.com')).rejects.toBeInstanceOf(CloudflareUnavailable)
  })
})

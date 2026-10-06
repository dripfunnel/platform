import type postgres from 'postgres'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { localCloudflare, localDns, localEmail, localMessageMarker, localSms } from './index'

const printed = () => vi.mocked(console.log).mock.calls.map(([line]) => String(line))

afterEach(() => vi.restoreAllMocks())

describe('the local stand-ins', () => {
  it('print an email and a text on one marked line each, as the provider would have taken them', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const sent = await localEmail().send({ from: 'Kesari <no-reply@mail.localhost>', to: ['owner@kesari.example'], subject: 'Your code', text: 'Code 123456', html: '<p>Code 123456</p>', tags: {} })
    const texted = await localSms().send({ to: '+919800000000', text: 'Your code is 654321', dlt: null })
    expect(sent.messageId).toMatch(/^local-/)
    expect(texted.providerId).toMatch(/^local-/)
    const lines = printed()
    expect(lines.every((line) => line.startsWith(`${localMessageMarker} `))).toBe(true)
    expect(lines.map((line) => JSON.parse(line.slice(localMessageMarker.length + 1)) as unknown)).toEqual([
      { kind: 'email', to: ['owner@kesari.example'], from: 'Kesari <no-reply@mail.localhost>', subject: 'Your code', text: 'Code 123456' },
      { kind: 'sms', to: '+919800000000', text: 'Your code is 654321' },
    ])
  })

  it('sends every name but a .localhost one to the real resolver', async () => {
    const resolver = { resolve: vi.fn(async () => ['portal.edge.dripfunnel.net']) }
    const dns = localDns({} as postgres.Sql, resolver)
    expect(await dns.resolve('store.acme.com', 'CNAME', AbortSignal.timeout(1000))).toEqual(['portal.edge.dripfunnel.net'])
    expect(resolver.resolve).toHaveBeenCalledWith('store.acme.com', 'CNAME', expect.anything())
  })

  it('keeps a .localhost name from Cloudflare and sends every other name to the real client', async () => {
    const real = { ensureHostname: vi.fn(async (hostname: string) => ({ id: 'cf-1', hostname, status: 'pending', ssl: { status: 'initializing' } })), removeHostname: vi.fn(async () => undefined) }
    const cloudflare = localCloudflare(real)
    expect(await cloudflare.ensureHostname('store.acme.localhost')).toMatchObject({ status: 'active', ssl: { status: 'active' } })
    await cloudflare.removeHostname('store.acme.localhost')
    expect(real.ensureHostname).not.toHaveBeenCalled()
    expect(real.removeHostname).not.toHaveBeenCalled()
    expect(await cloudflare.ensureHostname('store.acme.com')).toMatchObject({ id: 'cf-1', status: 'pending' })
    await cloudflare.removeHostname('store.acme.com')
    expect(real.removeHostname).toHaveBeenCalledWith('store.acme.com')
  })
})

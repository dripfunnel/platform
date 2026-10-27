import { describe, expect, it, vi } from 'vitest'
import { googleRoutesClient, RoutesUnavailable, routesUrl } from './api'

const from = { latitude: 26.9, longitude: 75.8 }
const to = { latitude: 26.92, longitude: 75.79 }
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('googleRoutesClient', () => {
  it('asks for the duration only, with the key in a header and never in the address', async () => {
    const fetchImpl = vi.fn(async () => reply({ routes: [{ duration: '754s' }] }))
    expect(await googleRoutesClient({ key: 'AIzaKEY', fetchImpl }).durationSeconds(from, to)).toBe(754)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(routesUrl)
    expect(url).not.toContain('AIzaKEY')
    expect(init.headers).toMatchObject({ 'x-goog-api-key': 'AIzaKEY', 'x-goog-fieldmask': 'routes.duration' })
    expect(JSON.parse(String(init.body))).toMatchObject({ travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE', origin: { location: { latLng: from } }, destination: { location: { latLng: to } } })
  })

  it('has no estimate when Google has no route, refuses the request, or answers something unreadable', async () => {
    expect(await googleRoutesClient({ key: 'k', fetchImpl: async () => reply({}) }).durationSeconds(from, to)).toBeNull()
    expect(await googleRoutesClient({ key: 'k', fetchImpl: async () => reply({ error: {} }, 403) }).durationSeconds(from, to)).toBeNull()
    expect(await googleRoutesClient({ key: 'k', fetchImpl: async () => reply({ routes: [{ duration: 'soon' }] }) }).durationSeconds(from, to)).toBeNull()
  })

  it('retries once after a failure on Google’s side, and then gives up without a second retry', async () => {
    const flaky = vi.fn().mockResolvedValueOnce(reply({}, 503)).mockResolvedValueOnce(reply({ routes: [{ duration: '60s' }] }))
    expect(await googleRoutesClient({ key: 'k', fetchImpl: flaky }).durationSeconds(from, to)).toBe(60)
    expect(flaky).toHaveBeenCalledTimes(2)

    const down = vi.fn(async () => reply({}, 500))
    await expect(googleRoutesClient({ key: 'k', fetchImpl: down }).durationSeconds(from, to)).rejects.toBeInstanceOf(RoutesUnavailable)
    expect(down).toHaveBeenCalledTimes(2)
  })

  it('does not retry a refusal, and keeps the key and the points out of its error', async () => {
    const refused = vi.fn(async () => reply({}, 400))
    await googleRoutesClient({ key: 'AIzaKEY', fetchImpl: refused }).durationSeconds(from, to)
    expect(refused).toHaveBeenCalledTimes(1)
    const error = await googleRoutesClient({ key: 'AIzaKEY', fetchImpl: async () => { throw new Error('connect to 26.9,75.8 with AIzaKEY failed') } }).durationSeconds(from, to).catch((e: unknown) => e)
    expect(String(error)).not.toMatch(/AIzaKEY|26\.9/)
  })
})

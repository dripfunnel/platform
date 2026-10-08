import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createShopClient, ShopApiError } from './client'

const respond = (body: unknown, init?: ResponseInit) => {
  const fetchMock = vi.fn(async () => Response.json(body, init))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const sentHeaders = (fetchMock: ReturnType<typeof respond>) => (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createShopClient', () => {
  it('returns data from the Shop API', async () => {
    respond({ data: { health: 'ok' } })
    await expect(createShopClient().request('{ health }')).resolves.toEqual({ health: 'ok' })
  })

  it('raises the error code the API returned', async () => {
    respond({ errors: [{ message: 'Coupon expired', extensions: { code: 'COUPON_EXPIRED' } }] })
    await expect(createShopClient().request('{ health }')).rejects.toEqual(new ShopApiError('COUPON_EXPIRED', 'Coupon expired'))
  })

  it('sends the store key and the shopper’s choices, and nothing empty', async () => {
    const fetchMock = respond({ data: { health: 'ok' } })
    await createShopClient({ storeKey: 'pk_1', state: () => ({ language: 'hi', currency: 'INR', cartToken: '', sessionToken: undefined }) }).request('{ health }')
    expect(sentHeaders(fetchMock)).toEqual({ 'content-type': 'application/json', 'x-shop-key': 'pk_1', 'x-shop-language': 'hi', 'x-shop-currency': 'INR' })
  })

  it('names a network failure and an HTTP error with no body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))))
    await expect(createShopClient().request('{ health }')).rejects.toMatchObject({ code: 'NETWORK' })
    respond({}, { status: 503 })
    await expect(createShopClient().request('{ health }')).rejects.toMatchObject({ code: 'HTTP_503' })
  })

  it('decodes an answer with its schema, and refuses one that drifted', async () => {
    respond({ data: { store: { name: 'Juniper' } } })
    await expect(createShopClient().query('{ store { name } }', z.object({ store: z.object({ name: z.string() }) }))).resolves.toEqual({ store: { name: 'Juniper' } })
    respond({ data: { store: { name: 7 } } })
    await expect(createShopClient().query('{ store { name } }', z.object({ store: z.object({ name: z.string() }) }))).rejects.toMatchObject({ code: 'BAD_RESPONSE' })
  })
})

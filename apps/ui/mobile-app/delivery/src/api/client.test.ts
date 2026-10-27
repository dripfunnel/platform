import { createBrandClient, createDeliveryClient, deliveryPath, shopPath } from './client'

const mockFetch = jest.fn()

beforeEach(() => {
  mockFetch.mockReset()
  mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { ok: true } }) })
  global.fetch = mockFetch as unknown as typeof fetch
})

describe('the clients', () => {
  it('call the Delivery API on the store’s host, with the trailing slash its route needs', async () => {
    await createDeliveryClient('acme.my-store.one').request('{ me { id } }')

    expect(deliveryPath).toBe('/delivery-api/')
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain('https://acme.my-store.one/delivery-api/')
  })

  it('read the store’s look from the Shop API, which the rider app uses for nothing else', async () => {
    await createBrandClient('acme.my-store.one').request('{ store { name } }', undefined, { get: true })

    expect(shopPath).toBe('/shop-api/')
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain('https://acme.my-store.one/shop-api/')
  })
})

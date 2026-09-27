import { afterEach, describe, expect, it, vi } from 'vitest'
import { createShopClient, ShopApiError } from './client'

const respond = (body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => Response.json(body)))

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
})

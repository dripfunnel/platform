import { createApiClient } from '@dripfunnel/mobile-shared/graphql'

/** The Delivery API's path on the store's host, with the trailing slash its route needs (docs/api/DELIVERY.md §4). */
export const deliveryPath = '/delivery-api/'

/** The Shop API's path, read only for the store's look and country: the rider app has no shopper session (docs/mobile-app/delivery/ARCHITECTURE.md §2). */
export const shopPath = '/shop-api/'

type Options = { timeoutMs?: number; token?: () => string | null }

export const createDeliveryClient = (host: string, { timeoutMs, token }: Options = {}) =>
  createApiClient({ domain: host, path: deliveryPath, ...(timeoutMs === undefined ? {} : { timeoutMs }), ...(token ? { token } : {}) })

export const createBrandClient = (host: string, timeoutMs?: number) => createApiClient({ domain: host, path: shopPath, ...(timeoutMs === undefined ? {} : { timeoutMs }) })

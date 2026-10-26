import { createApiClient } from '@dripfunnel/mobile-shared/graphql'
import { shopHeaders, type Tokens } from '../session/tokens'

/** The Shop API's path on the store's host, with the trailing slash the `/shop-api/*` route needs. */
export const apiPath = '/shop-api/'

export const createShopClient = (host: string, tokens: Tokens, timeoutMs?: number) =>
  createApiClient({ domain: host, path: apiPath, extraHeaders: () => shopHeaders(tokens), ...(timeoutMs === undefined ? {} : { timeoutMs }) })

import { createApiClient } from '@dripfunnel/mobile-shared/graphql'
import { marketHeaders, noChoice, type Choice } from '../features/markets/choice'
import { shopHeaders, type Tokens } from '../session/tokens'

/** The Shop API's path on the store's host, with the trailing slash the `/shop-api/*` route needs. */
export const apiPath = '/shop-api/'

export const createShopClient = (host: string, tokens: Tokens, timeoutMs?: number, choice: Choice = noChoice) =>
  createApiClient({ domain: host, path: apiPath, extraHeaders: () => ({ ...shopHeaders(tokens), ...marketHeaders(choice) }), ...(timeoutMs === undefined ? {} : { timeoutMs }) })

import { createApiClient, typedQuery } from '@dripfunnel/shared/graphql'

// The one client of this app (ui/README.md §3). Every module in src/api/ sends its operation
// through `query` and decodes the answer with a zod schema written from apps/api/schema/platform.graphql.
export const api = createApiClient()

export const query = typedQuery(api)

export { isApiError, outcome } from '@dripfunnel/shared/graphql'

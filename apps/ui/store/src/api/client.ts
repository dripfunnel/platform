import { createApiClient, typedQuery } from '@dripfunnel/shared/graphql'
import { actingHeaders } from '../acting'

// The one client of this app (ui/README.md §3). Every module in src/api/ sends its operation
// through `query`, decoded with a zod schema written from apps/api/schema/store.graphql.
export const api = createApiClient({ headers: actingHeaders })

export const query = typedQuery(api)

export { isApiError, outcome } from '@dripfunnel/shared/graphql'

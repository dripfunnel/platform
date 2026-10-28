import { z } from 'zod'
import { decode, type ApiClient } from '@dripfunnel/mobile-shared/graphql'

/** The build below which the app says "Update required"; null when staff set none (docs/api/DELIVERY.md §4, §5). Needs no sign-in. */
export const fetchMinimumBuild = async (client: ApiClient): Promise<number | null> =>
  decode(z.object({ minimumBuild: z.number().int().nullable() }), await client.request<unknown>('{ minimumBuild }')).minimumBuild

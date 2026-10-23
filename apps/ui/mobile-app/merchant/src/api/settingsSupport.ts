import { z } from 'zod'
import { typedQuery, type ApiClient } from '@dripfunnel/mobile-shared/graphql'

// Settings › Support access (SetAccess "support"; ACCESS.md §8; apps/api src/apis/store/support.ts): the switch, and the log of the last 90 days.

const sessionSchema = z.object({
  id: z.string(),
  agentName: z.string(),
  partnerName: z.string(),
  actingAs: z.object({ name: z.string(), role: z.string(), supplier: z.string().nullable() }),
  reason: z.string(),
  ticket: z.string().nullable(),
  startedAt: z.string(),
  expiresAt: z.string(),
  endedAt: z.string().nullable(),
  endedBy: z.string().nullable(),
  access: z.enum(['read', 'write']),
  allowedBy: z.string().nullable(),
  writeRequest: z.object({ state: z.enum(['pending', 'allowed', 'denied']) }).nullable(),
})
export type SupportSession = z.infer<typeof sessionSchema>

const accessSchema = z.object({
  allowed: z.boolean(),
  sessions: z.object({ nodes: z.array(sessionSchema), pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }) }),
})
export type SupportAccess = z.infer<typeof accessSchema>

/** The switch, and a page of the last 90 days' sessions, newest first. */
export const loadSupportAccess = async (client: ApiClient, after: string | null = null): Promise<SupportAccess> => {
  const { supportAccess } = await typedQuery(client)(
    'query SupportAccess($after: String) { supportAccess(after: $after) { allowed sessions { nodes { id agentName partnerName actingAs { name role supplier } reason ticket startedAt expiresAt endedAt endedBy access allowedBy writeRequest { state } } pageInfo { hasNextPage endCursor } } } }',
    z.object({ supportAccess: accessSchema.nullable() }),
    { after },
  )
  if (!supportAccess) throw new Error('support access missing')
  return supportAccess
}

/** Answers how many open sessions turning it off ended. */
export const setSupportAccess = async (client: ApiClient, allowed: boolean): Promise<number> =>
  (
    await typedQuery(client)(
      'mutation SetSupportAccess($a: Boolean!) { setSupportAccess(allowed: $a) { allowed ended } }',
      z.object({ setSupportAccess: z.object({ allowed: z.boolean(), ended: z.number().int() }).nullable() }),
      { a: allowed },
    )
  ).setSupportAccess?.ended ?? 0

/** The elevation banner's two answers (ACCESS.md §8): an Owner or a Manager lets the agent change things for this one session, or doesn't. */
export const answerSupportWrite = async (client: ApiClient, sessionId: string, allow: boolean): Promise<void> => {
  const field = allow ? 'allowSupportWrite' : 'denySupportWrite'
  await typedQuery(client)(`mutation AnswerSupport($id: ID!) { ${field}(sessionId: $id) }`, z.object({ [field]: z.boolean().nullable() }), { id: sessionId })
}

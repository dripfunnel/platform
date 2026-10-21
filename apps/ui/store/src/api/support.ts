import { z } from 'zod'
import { query } from './client'

// Settings › Support access (SetAccess "support", FIRST-RELEASE §15, ACCESS §8; apps/api/src/apis/store/support.ts).

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
export const loadSupportAccess = async (after: string | null = null): Promise<SupportAccess> =>
  (
    await query(
      'query S($after: String) { supportAccess(after: $after) { allowed sessions { nodes { id agentName partnerName actingAs { name role supplier } reason ticket startedAt expiresAt endedAt endedBy access allowedBy writeRequest { state } } pageInfo { hasNextPage endCursor } } } }',
      z.object({ supportAccess: accessSchema }),
      { after },
    )
  ).supportAccess

/** Answers how many open sessions turning it off ended. */
export const setSupportAccess = async (allowed: boolean): Promise<number> =>
  (await query('mutation S($a: Boolean!) { setSupportAccess(allowed: $a) { allowed ended } }', z.object({ setSupportAccess: z.object({ allowed: z.boolean(), ended: z.number().int() }) }), { a: allowed })).setSupportAccess.ended

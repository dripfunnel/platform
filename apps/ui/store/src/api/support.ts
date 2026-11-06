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

/** A one-time code an Owner or a Manager reads to the agent (ACCESS §8); shown once, never kept here. */
export const issueSupportWriteCode = async (sessionId: string): Promise<{ code: string; expiresAt: string }> =>
  (await query('mutation C($id: ID!) { issueSupportWriteCode(sessionId: $id) { code expiresAt } }', z.object({ issueSupportWriteCode: z.object({ code: z.string(), expiresAt: z.string() }) }), { id: sessionId })).issueSupportWriteCode

/** The agent types the store's code to make changes for the rest of the session. */
export const redeemSupportWriteCode = async (code: string): Promise<void> => {
  await query('mutation R($c: String!) { redeemSupportWriteCode(code: $c) }', z.object({ redeemSupportWriteCode: z.boolean() }), { c: code })
}

/** Allow or Deny the agent's open request; an Owner's or a Manager's to answer. */
export const answerSupportWrite = async (sessionId: string, allow: boolean): Promise<void> => {
  const field = allow ? 'allowSupportWrite' : 'denySupportWrite'
  await query(`mutation A($id: ID!) { ${field}(sessionId: $id) }`, z.object({ [field]: z.boolean() }), { id: sessionId })
}

/** The agent asks the store to let it make changes, saying what for. */
export const requestSupportWrite = async (note: string): Promise<void> => {
  await query('mutation Q($n: String!) { requestSupportWrite(note: $n) }', z.object({ requestSupportWrite: z.boolean() }), { n: note })
}

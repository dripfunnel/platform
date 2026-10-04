import { ApiError, type PageInfo, type PageRequest } from '@dripfunnel/shared/graphql'
import { z } from 'zod'
import { query } from './client'

// Support on the Platform API (FIRST-RELEASE.md §12, §16; #202). Whether a session may start, be
// returned to or ended is the API's verdict on each row; the console words its codes.
export const startRefusals = ['STORE_CANCELLED', 'SUPPORT_OFF', 'NOT_ACCEPTED', 'SUSPENDED', 'COLLEAGUE_IN_SESSION'] as const
export type StartRefusal = (typeof startRefusals)[number]

export const sessionRefusals = [
  'NOT_FOUND',
  'INVALID_INPUT',
  'REASON_REQUIRED',
  'REAUTH_REQUIRED',
  'SUPPORT_SESSION_ALREADY_OPEN',
  'PORTAL_NOT_LIVE',
  'NOT_SESSION_OWNER',
  'SESSION_ENDED',
  'SESSION_EXPIRED',
] as const
export type SessionRefusal = (typeof sessionRefusals)[number]

export type SupportRefusal = StartRefusal | SessionRefusal

const refusalCodes: readonly string[] = [...startRefusals, ...sessionRefusals]
const isRefusal = (code: string | null): code is SupportRefusal => code !== null && refusalCodes.includes(code)

// A code this console doesn't know is an error with that code, never worded as a known one.
const refusalOf = (code: string | null): SupportRefusal => {
  if (isRefusal(code)) return code
  throw new ApiError(code ?? 'UNKNOWN', 'The API refused with a code this console does not know.')
}

const verdictSchema = z.object({ allowed: z.boolean(), reason: z.string().nullable() }).transform((v): Verdict => (v.allowed ? { allowed: true } : { allowed: false, reason: refusalOf(v.reason) }))
export type Verdict = { allowed: true } | { allowed: false; reason: SupportRefusal }

const named = z.object({ id: z.string(), name: z.string() })

const targetSchema = z.object({
  membershipId: z.string(),
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  type: z.enum(['store', 'supplier']),
  store: named,
  role: z.string(),
  supplier: z.string().nullable(),
  lastSignInAt: z.string().nullable(),
  status: z.enum(['active', 'invited', 'suspended']),
  start: verdictSchema,
  storeOwner: z.string().nullable(),
  colleague: z.object({ name: z.string(), minutesLeft: z.number().int() }).nullable(),
  mySessionId: z.string().nullable(),
})
export type SupportTarget = z.infer<typeof targetSchema>

const sessionSchema = z.object({
  id: z.string(),
  user: z.object({ name: z.string(), role: z.string(), supplier: z.string().nullable() }),
  store: named,
  agent: named,
  you: z.boolean(),
  reason: z.string(),
  ticket: z.string().nullable(),
  startedAt: z.string(),
  expiresAt: z.string(),
  endedAt: z.string().nullable(),
  endedBy: z.enum(['agent', 'colleague', 'expired']).nullable(),
  endedByName: z.string().nullable(),
  end: verdictSchema,
  return: verdictSchema,
})
export type SupportSession = z.infer<typeof sessionSchema>

const pageInfoSchema = z.object({ startCursor: z.string().nullable(), endCursor: z.string().nullable(), hasPreviousPage: z.boolean(), hasNextPage: z.boolean() })

export interface Page<T> {
  items: readonly T[]
  pageInfo: PageInfo
}

const pageInfoFields = 'pageInfo { startCursor endCursor hasPreviousPage hasNextPage }'
const verdictFields = '{ allowed reason }'
const targetFields = `items { membershipId userId name email type store { id name } role supplier lastSignInAt status start ${verdictFields} storeOwner colleague { name minutesLeft } mySessionId } ${pageInfoFields}`
const oneSession = `id user { name role supplier } store { id name } agent { id name } you reason ticket startedAt expiresAt endedAt endedBy endedByName end ${verdictFields} return ${verdictFields}`
const sessionFields = `items { ${oneSession} } ${pageInfoFields}`

// Found by name, email or store (§12.1); never the partner's own team, staff or shoppers.
export const loadSupportTargets = async (search: string | undefined, page: PageRequest): Promise<Page<SupportTarget>> =>
  (
    await query(
      `query Targets($search: String, $after: String, $before: String) { supportTargets(search: $search, after: $after, before: $before) { ${targetFields} } }`,
      z.object({ supportTargets: z.object({ items: z.array(targetSchema), pageInfo: pageInfoSchema }) }),
      { search: search ?? null, after: page.after, before: page.before },
    )
  ).supportTargets

export const loadSupportSessions = async (open: boolean, page: PageRequest): Promise<Page<SupportSession>> =>
  (
    await query(
      `query Sessions($open: Boolean!, $after: String, $before: String) { supportSessions(open: $open, after: $after, before: $before) { ${sessionFields} } }`,
      z.object({ supportSessions: z.object({ items: z.array(sessionSchema), pageInfo: pageInfoSchema }) }),
      { open, after: page.after, before: page.before },
    )
  ).supportSessions

export const reauthRefusals = ['WRONG_CODE', 'LOCKED', 'NOT_CONNECTED', 'NO_SECOND_FACTOR', 'CODE_EXPIRED'] as const
export type ReauthRefusal = (typeof reauthRefusals)[number]

export type Reauth = { ok: true; proof: string } | { ok: false; reason: ReauthRefusal; triesLeft: number | null; lockedMinutes: number | null }

// ACCESS.md §8: the caller's own 2-factor code buys a single-use proof for one start.
export const reauthenticate = async (code: string): Promise<Reauth> => {
  const { reauthenticate: r } = await query(
    `mutation Reauth($code: String!) { reauthenticate(code: $code) { ok reason proof triesLeft lockedMinutes } }`,
    z.object({ reauthenticate: z.object({ ok: z.boolean(), reason: z.string().nullable(), proof: z.string().nullable(), triesLeft: z.number().int().nullable(), lockedMinutes: z.number().int().nullable() }) }),
    { code },
  )
  if (r.ok && r.proof) return { ok: true, proof: r.proof }
  const reason = reauthRefusals.find((known) => known === r.reason)
  if (!reason) throw new ApiError(r.reason ?? 'UNKNOWN', 'The API refused with a code this console does not know.')
  return { ok: false, reason, triesLeft: r.triesLeft, lockedMinutes: r.lockedMinutes }
}

// The link carries a single-use handoff: opened once, in a new tab, never kept (ACCESS.md §8.3).
export type Opened = { ok: true; link: string } | { ok: false; reason: SupportRefusal; sessionId: string | null }

const linkSchema = z.object({ ok: z.boolean(), reason: z.string().nullable(), sessionId: z.string().nullable(), link: z.string().nullable() })

const openedOf = (r: z.infer<typeof linkSchema>): Opened => {
  if (r.ok && r.link?.startsWith('https://')) return { ok: true, link: r.link }
  if (r.ok) throw new ApiError('BAD_RESPONSE', 'The API answered without a session link.')
  return { ok: false, reason: refusalOf(r.reason), sessionId: r.sessionId }
}

export const startSupportSession = async (input: { membershipId: string; reason: string; ticket: string | null; proof: string }): Promise<Opened> =>
  openedOf(
    (
      await query(
        `mutation Start($membershipId: ID!, $reason: String!, $ticket: String, $proof: String!) { startSupportSession(membershipId: $membershipId, reason: $reason, ticket: $ticket, proof: $proof) { ok reason sessionId link } }`,
        z.object({ startSupportSession: linkSchema }),
        input,
      )
    ).startSupportSession,
  )

export const returnToSupportSession = async (id: string): Promise<Opened> =>
  openedOf(
    (await query(`mutation Return($id: ID!) { returnToSupportSession(id: $id) { ok reason sessionId link } }`, z.object({ returnToSupportSession: linkSchema }), { id }))
      .returnToSupportSession,
  )

export type Ended = { ok: true } | { ok: false; reason: SupportRefusal }

export const endSupportSession = async (id: string): Promise<Ended> => {
  const { endSupportSession: r } = await query(
    `mutation End($id: ID!) { endSupportSession(id: $id) { ok reason } }`,
    z.object({ endSupportSession: z.object({ ok: z.boolean(), reason: z.string().nullable() }) }),
    { id },
  )
  return r.ok ? { ok: true } : { ok: false, reason: refusalOf(r.reason) }
}

// The caller's own open session, whichever page of the open list it would fall on.
export const loadMySupportSession = async (): Promise<SupportSession | null> =>
  (await query(`{ mySupportSession { ${oneSession} } }`, z.object({ mySupportSession: sessionSchema.nullable() }))).mySupportSession

// Enough pages for any one person's memberships; past that the row is reported missing, never guessed.
export const findPagesMax = 8

// One user's row in one store: the search is their email, paged until that pair turns up.
export const findSupportTarget = async (person: { id: string; email: string }, storeId: string): Promise<SupportTarget | null> => {
  let after: string | undefined
  for (let page = 0; page < findPagesMax; page += 1) {
    const found = await loadSupportTargets(person.email, after ? { after } : {})
    const target = found.items.find((t) => t.userId === person.id && t.store.id === storeId)
    if (target) return target
    if (!found.pageInfo.hasNextPage || !found.pageInfo.endCursor) return null
    after = found.pageInfo.endCursor
  }
  return null
}

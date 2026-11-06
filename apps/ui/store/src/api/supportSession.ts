import { z } from 'zod'
import { rememberActing } from '../acting'
import { postAuth } from './staffSession'

// The agent's side of a partner support session (ACCESS.md §8.3): the console's one-time link is
// exchanged for the support cookie on this host; a spent, expired or unknown link is HANDOFF_INVALID.
const opened = z.object({ ok: z.literal(true), session: z.object({ id: z.string(), state: z.literal('open') }) })

/** True once the support cookie is set; false for a link that no longer works. No answer throws. */
export const exchangeSupportHandoff = async (token: string): Promise<boolean> => {
  if (!opened.safeParse(await postAuth('support-handoff', { token })).success) return false
  // The session names its own store; one remembered from before would read as a crossing.
  rememberActing(null)
  return true
}

/** Whether this browser holds a support cookie, open or over: an agent, not a person signed out. */
export const holdsSupportSession = async (): Promise<boolean> =>
  z.object({ ok: z.literal(true), session: z.object({ id: z.string() }).nullable() }).safeParse(await postAuth('support-session', {})).data?.session != null

/** The agent's one 30-minute extension (ACCESS.md §8): the session's new end, or null when refused. */
export const extendSupportSession = async (id: string): Promise<string | null> => {
  const parsed = z.object({ ok: z.literal(true), expiresAt: z.string() }).safeParse(await postAuth('extend-support-session', { id }))
  return parsed.success ? parsed.data.expiresAt : null
}

/** The agent's End now (ACCESS.md §8.3): true once the server ended the session the cookie holds. */
export const endSupportSession = async (id: string): Promise<boolean> =>
  z.object({ ok: z.literal(true) }).safeParse(await postAuth('end-support-session', { id })).success

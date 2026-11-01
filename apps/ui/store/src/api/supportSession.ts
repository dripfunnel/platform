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

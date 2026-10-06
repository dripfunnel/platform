import { z } from 'zod'
import { personEmailChanged, type RequestFacts } from '#auth/activity'
import { hashSessionId } from '#auth/session'
import { withSystemScope } from '#db/scoped/index'
import { applyEmailChange, selectEmailChangeByToken } from '#db/scoped/profile'
import type { StoreAuthDeps } from './admission'
import { json, readBody, refuse } from './authHttp'

const tokenInput = z.strictObject({ token: z.string().min(1).max(200) })

/** The link sent to the new address (FIRST-RELEASE §4): once, within a day, on the host's partner only. */
export const confirmEmailChange = async (request: Request, deps: StoreAuthDeps, facts: RequestFacts): Promise<Response> => {
  const input = await readBody(request, tokenInput)
  if (!input) return refuse({ code: 'EMAIL_CHANGE_INVALID' })
  const tokenHash = await hashSessionId(input.token)
  const now = deps.now()
  const changed = await withSystemScope(deps.sql, async (tx) => {
    const change = await selectEmailChangeByToken(tx, deps.partnerId, tokenHash, now)
    if (!change || !(await applyEmailChange(tx, change, deps.partnerId, now))) return false
    await deps.activity.record(tx, personEmailChanged({ id: change.user_id, partnerId: deps.partnerId }, facts))
    return true
  })
  return changed ? json(200, { ok: true }) : refuse({ code: 'EMAIL_CHANGE_INVALID' })
}

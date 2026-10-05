import type { ScopedSql } from '#db/scoped/index'
import { issueEmailChangeToken } from '#db/scoped/profile'
import { hashSessionId, newSessionId } from './session'

/** A new address is proven by a link sent there, valid for a day (FIRST-RELEASE §4: "changed through a link"). */
export const emailChangeValidMs = 24 * 60 * 60 * 1000

export const mintEmailChangeToken = async (tx: ScopedSql, changeId: string, now: Date): Promise<string | null> => {
  const token = newSessionId()
  return (await issueEmailChangeToken(tx, changeId, await hashSessionId(token), now)) ? token : null
}

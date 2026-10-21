import type { ScopedSql } from '#db/scoped/index'
import { issueStaffInvitationToken } from '#db/scoped/staffMembers'
import { hashSessionId, newSessionId } from './session'

/**
 * The staff invitation link's token, minted when the email is sent so none rests in the outbox
 * (ACCESS.md §6.1), stored only as a hash; null for an invitation no longer open. The email
 * deliverer calls it (system scope); a resend's new invitation gets its own.
 */
export const mintStaffInvitationToken = async (tx: ScopedSql, invitationId: string, now: Date): Promise<string | null> => {
  const token = newSessionId()
  return (await issueStaffInvitationToken(tx, invitationId, await hashSessionId(token), now)) ? token : null
}

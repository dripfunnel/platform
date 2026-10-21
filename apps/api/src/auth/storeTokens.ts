import type { ScopedSql } from '#db/scoped/index'
import { issueStoreInvitationToken, issueUserResetToken } from '#db/scoped/userInvitations'
import { resetValidMs } from './partnerTokens'
import { hashSessionId, newSessionId } from './session'

// A merchant's links, minted when the email is sent so no secret rests in the outbox (ACCESS.md
// §6.1), as auth/partnerTokens.ts does for the partner console.

/** The outbox kind a merchant's reset request queues, whether or not the email has an account. */
export const userPasswordResetRequestKind = 'user_password_reset.request'

export const mintStoreInvitationToken = async (tx: ScopedSql, invitationId: string, now: Date): Promise<string | null> => {
  const token = newSessionId()
  return (await issueStoreInvitationToken(tx, invitationId, await hashSessionId(token), now)) ? token : null
}

export const mintUserResetToken = async (tx: ScopedSql, resetId: string, now: Date): Promise<string | null> => {
  const token = newSessionId()
  return (await issueUserResetToken(tx, resetId, await hashSessionId(token), now, resetValidMs)) ? token : null
}

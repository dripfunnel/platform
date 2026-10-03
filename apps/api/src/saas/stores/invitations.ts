import type { StoreRow } from '#db/schema/saas'
import type { ScopedSql } from '#db/scoped/index'
import { insertStoreInvitation, revokeStoreInvitation, selectOpenStoreInvitation } from '#db/scoped/stores'
import { queueSideEffect } from '#saas/outbox/index'

export const storeInvitationDays = 7
const dayMs = 24 * 60 * 60 * 1000

/** ACCESS.md §6.3: a fresh owner invitation, the old link revoked; null when none is open. */
export const reissueOwnerInvitation = async (tx: ScopedSql, store: Pick<StoreRow, 'id' | 'partner_id'>, invitedByLabel: string, at: Date): Promise<{ invitationId: string; email: string } | null> => {
  const open = await selectOpenStoreInvitation(tx, store.id)
  if (!open) return null
  await revokeStoreInvitation(tx, open.id, at)
  const invitationId = await insertStoreInvitation(tx, { storeId: store.id, email: open.email, role: 'owner', expiresAt: new Date(at.getTime() + storeInvitationDays * dayMs), invitedByLabel })
  await queueSideEffect(tx, {
    kind: 'email',
    idempotencyKey: `store-owner-invitation:${invitationId}`,
    payload: { template: 'store-owner-invitation', invitationId, to: open.email, storeId: store.id },
    partnerId: store.partner_id,
    storeId: store.id,
  })
  return { invitationId, email: open.email }
}

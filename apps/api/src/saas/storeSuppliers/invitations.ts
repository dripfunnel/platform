import type { StoreCaller } from '#auth/storeCaller'
import type { ScopedSql } from '#db/scoped/index'
import { countInvitationsSince, invitee, revokeInvitation } from '#db/scoped/people'
import { holdInvitedSupplierSeat, insertSupplierInvitation } from '#db/scoped/suppliers'
import type { SupplierRole } from '#db/scoped/supplierTeam'
import { queueSideEffect } from '#saas/outbox/index'
import { perAddressPerDay, perInviterPerHour } from '#saas/storePeople/index'

// A supplier's invitation, whoever sends it: the merchant's Owner (SetTeam) or the supplier's own admin
// (VendorViews), with People's limits and email (ACCESS §6.2, §7.5).

const invitationDays = 7
const day = 24 * 60 * 60 * 1000

export type InvitationRefusal = { reason: 'ALREADY_MEMBER' } | { reason: 'RATE_LIMITED'; per: 'inviter' | 'address' }

/** 0007's membership trigger: a person is never both the merchant's staff and a supplier in one store. */
const isBothSides = (error: unknown) => error instanceof Error && error.message.includes('never both the merchant')

/** The invitation, its held seat and its email; the answer is its id. A suspended or deleted account gets the same answer and no email. */
export const sendSupplierInvitation = async (
  tx: ScopedSql,
  caller: StoreCaller,
  i: { sellerId: string; email: string; role: SupplierRole; replacing: string | null; now: Date },
): Promise<InvitationRefusal | string> => {
  const storeId = caller.store.id
  if ((await countInvitationsSince(tx, storeId, new Date(i.now.getTime() - 60 * 60 * 1000), { inviterId: caller.person.id })) >= perInviterPerHour) return { reason: 'RATE_LIMITED', per: 'inviter' }
  if ((await countInvitationsSince(tx, storeId, new Date(i.now.getTime() - day), { email: i.email })) >= perAddressPerDay) return { reason: 'RATE_LIMITED', per: 'address' }
  const userId = await invitee(tx, i.email, i.email.split('@')[0] ?? i.email)
  if (userId) {
    // A supplier can't see the merchant side's memberships, so the trigger's refusal is the check.
    try {
      await tx.savepoint((sp) => holdInvitedSupplierSeat(sp, storeId, i.sellerId, userId, i.role, caller.person.id))
    } catch (error) {
      if (isBothSides(error)) return { reason: 'ALREADY_MEMBER' }
      throw error
    }
  }
  if (i.replacing) await revokeInvitation(tx, i.replacing, i.now)
  const invitationId = await insertSupplierInvitation(tx, { storeId, sellerId: i.sellerId, email: i.email, role: i.role, expiresAt: new Date(i.now.getTime() + invitationDays * day), invitedBy: { id: caller.person.id, label: caller.person.name }, now: i.now })
  if (userId) await queueSideEffect(tx, { kind: 'email', idempotencyKey: `store-invitation:${invitationId}`, payload: { template: 'store-owner-invitation', invitationId, to: i.email, storeId }, partnerId: caller.person.partnerId, storeId })
  return invitationId
}

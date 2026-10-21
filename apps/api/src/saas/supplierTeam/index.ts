import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import type { StoreCaller } from '#auth/storeCaller'
import { isUuid } from '#core/ids'
import type { PageWindow } from '#core/paging'
import { withScope, type ScopedSql } from '#db/scoped/index'
import { lockStorePeople, revokeInvitation } from '#db/scoped/people'
import {
  countOtherSupplierAdmins,
  isInSupplier,
  openSupplierInvitationTo,
  removeSupplierMember,
  selectOpenSupplierInvitation,
  selectSupplierMember,
  selectSupplierTeam,
  setSupplierMemberRole,
} from '#db/scoped/supplierTeam'
import { sendSupplierInvitation, supplierRoleOf, type InvitationRefusal } from '#saas/storeSuppliers/index'
import { normalisedEmail } from '#saas/storePeople/index'

// Your team (ACCESS §7.5, VendorViews): a Supplier admin's own supplier only, in its scope. A supplier
// always keeps one admin; every write takes the store's People lock, as Settings › People does.

export const supplierTeamAudit = {
  invited: 'supplier_team.invited',
  invitationResent: 'supplier_team.invitation_resent',
  invitationRevoked: 'supplier_team.invitation_revoked',
  roleChanged: 'supplier_team.role_changed',
  removed: 'supplier_team.removed',
} as const

export type SupplierTeamRefusal = { reason: 'NOT_FOUND' | 'INVALID_INPUT' | 'INVALID_EMAIL' | 'LAST_ADMIN' | 'ALREADY_MEMBER' } | InvitationRefusal
export type SupplierTeamResult<T> = { ok: true; value: T } | ({ ok: false } & SupplierTeamRefusal)

class Refused extends Error {
  constructor(readonly refusal: SupplierTeamRefusal) {
    super(refusal.reason)
  }
}

export interface SupplierTeamDeps {
  sql: postgres.Sql
  caller: StoreCaller
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
}

export const createSupplierTeamService = ({ sql, caller, activity, facts, now }: SupplierTeamDeps) => {
  const storeId = caller.store.id
  const scope = caller.context.sellerScope
  if (scope.kind !== 'seller') throw new Error('supplier team: a supplier caller only')
  const sellerId = scope.sellerId

  const entry = (action: string, target: { type: string; id: string; label: string }, reason: string | null): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'person',
    actorId: caller.person.id,
    actorLabel: null,
    partnerId: caller.person.partnerId,
    storeId,
    sellerId,
    target,
    reason,
    api: 'store',
    visibility: 'store',
    ...facts,
  })

  const run = async <T>(work: (tx: ScopedSql) => Promise<T>): Promise<SupplierTeamResult<T>> => {
    try {
      return { ok: true, value: await withScope(sql, caller.context, async (tx) => {
        await lockStorePeople(tx, storeId)
        return work(tx)
      }) }
    } catch (error) {
      if (error instanceof Refused) return { ok: false, ...error.refusal }
      throw error
    }
  }

  const list = (window: PageWindow) => withScope(sql, caller.context, (tx) => selectSupplierTeam(tx, storeId, sellerId, window))

  const invite = (rawEmail: string, rawRole: string) =>
    run(async (tx) => {
      const email = normalisedEmail(rawEmail)
      const role = supplierRoleOf(rawRole)
      if (!email) throw new Refused({ reason: 'INVALID_EMAIL' })
      if (!role) throw new Refused({ reason: 'INVALID_INPUT' })
      if (await isInSupplier(tx, storeId, sellerId, email)) throw new Refused({ reason: 'ALREADY_MEMBER' })
      const sent = await sendSupplierInvitation(tx, caller, { sellerId, email, role, replacing: await openSupplierInvitationTo(tx, storeId, sellerId, email), now: now() })
      if (typeof sent !== 'string') throw new Refused(sent)
      await activity.record(tx, entry(supplierTeamAudit.invited, { type: 'invitation', id: sent, label: email }, role))
      return sent
    })

  /** A new link replaces the old (ACCESS §6.3). */
  const resend = (invitationId: string) =>
    run(async (tx) => {
      const open = isUuid(invitationId) ? await selectOpenSupplierInvitation(tx, storeId, sellerId, invitationId) : null
      if (!open) throw new Refused({ reason: 'NOT_FOUND' })
      const sent = await sendSupplierInvitation(tx, caller, { sellerId, email: open.email, role: open.role_key, replacing: open.id, now: now() })
      if (typeof sent !== 'string') throw new Refused(sent)
      await activity.record(tx, entry(supplierTeamAudit.invitationResent, { type: 'invitation', id: sent, label: open.email }, null))
      return sent
    })

  const revoke = (invitationId: string) =>
    run(async (tx) => {
      const open = isUuid(invitationId) ? await selectOpenSupplierInvitation(tx, storeId, sellerId, invitationId) : null
      if (!open) throw new Refused({ reason: 'NOT_FOUND' })
      await revokeInvitation(tx, open.id, now())
      await activity.record(tx, entry(supplierTeamAudit.invitationRevoked, { type: 'invitation', id: open.id, label: open.email }, null))
      return true
    })

  const changeRole = (membershipId: string, rawRole: string) =>
    run(async (tx) => {
      const role = supplierRoleOf(rawRole)
      if (!role) throw new Refused({ reason: 'INVALID_INPUT' })
      const member = isUuid(membershipId) ? await selectSupplierMember(tx, storeId, sellerId, membershipId) : null
      if (!member) throw new Refused({ reason: 'NOT_FOUND' })
      if (member.role_key === role) return true
      if (member.role_key === 'supplier-admin' && (await countOtherSupplierAdmins(tx, storeId, sellerId, member.id)) === 0) throw new Refused({ reason: 'LAST_ADMIN' })
      await setSupplierMemberRole(tx, member.id, role)
      await activity.record(tx, { ...entry(supplierTeamAudit.roleChanged, { type: 'membership', id: member.id, label: member.label }, null), changes: [{ field: 'role', before: member.role_key, after: role }] })
      return true
    })

  /** They lose access to this store at once; their account and other stores are untouched (ACCESS §6.3). */
  const remove = (membershipId: string) =>
    run(async (tx) => {
      const member = isUuid(membershipId) ? await selectSupplierMember(tx, storeId, sellerId, membershipId) : null
      if (!member) throw new Refused({ reason: 'NOT_FOUND' })
      if (member.role_key === 'supplier-admin' && (await countOtherSupplierAdmins(tx, storeId, sellerId, member.id)) === 0) throw new Refused({ reason: 'LAST_ADMIN' })
      await removeSupplierMember(tx, member.id)
      await activity.record(tx, entry(supplierTeamAudit.removed, { type: 'membership', id: member.id, label: member.label }, null))
      return true
    })

  return { list, invite, resend, revoke, changeRole, remove }
}

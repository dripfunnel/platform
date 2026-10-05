import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import type { StoreCaller } from '#auth/storeCaller'
import { supplierTiers, type SupplierTier } from '#auth/storePermissions'
import type { PageWindow } from '#core/paging'
import { withScope, type ScopedSql } from '#db/scoped/index'
import { lockStorePeople } from '#db/scoped/people'
import {
  countLiveSuppliers,
  countSuppliers,
  endSupplierAccess,
  hideSupplierProducts,
  holdsSeatHere,
  insertSupplier,
  lockSupplier,
  markSupplierRemoved,
  markSupplierResumed,
  markSupplierSuspended,
  restoreSupplierProducts,
  selectSupplier,
  selectSuppliers,
  setSupplierShipping,
  setSupplierTier,
  supplierNameTaken,
  type LabelAccount,
  type ShippingMode,
  type SupplierFilter,
} from '#db/scoped/suppliers'
import { allowanceFor, planLimitFor, type PlanLimit } from '#saas/entitlements/index'
import { openSupplierInvitationTo, type SupplierRole } from '#db/scoped/supplierTeam'
import { normalisedEmail } from '#saas/storePeople/index'
import { sendSupplierInvitation } from './invitations'

export { sendSupplierInvitation, type InvitationRefusal } from './invitations'
import { isUuid } from '#core/ids'

// Settings › Supplier (ACCESS §5.2, §7.5; SetTeam): the merchant's suppliers, every write under the store's
// People lock, so a count against the plan or a name kept unique still holds when it commits.

export const suppliersAudit = {
  invited: 'supplier.invited',
  accessChanged: 'supplier.access_changed',
  shippingModeChanged: 'supplier.shipping_mode_changed',
  suspended: 'supplier.suspended',
  resumed: 'supplier.resumed',
  removed: 'supplier.removed',
  personAdded: 'supplier.person_added',
} as const

export type SuppliersRefusal =
  | { reason: 'NOT_FOUND' | 'INVALID_INPUT' | 'INVALID_EMAIL' | 'DUPLICATE_SUPPLIER' | 'ALREADY_MEMBER' | 'NOT_SUSPENDED' | 'ALREADY_SUSPENDED' | 'SUSPENDED' }
  | { reason: 'RATE_LIMITED'; per: 'inviter' | 'address' }
  | { reason: 'PLAN_LIMIT'; limit: PlanLimit }
export type SuppliersResult<T> = { ok: true; value: T } | ({ ok: false } & SuppliersRefusal)

const tierOf = (value: string): SupplierTier | null => supplierTiers.find((t) => t === value) ?? null
const modeOf = (value: string): ShippingMode | null => (value === 'to-store' || value === 'to-shopper' ? value : null)
export const supplierRoleOf = (value: string): SupplierRole | null => (value === 'supplier-admin' || value === 'supplier-member' ? value : null)
const labelsOf = (value: string | null | undefined): LabelAccount | null => (value === undefined || value === null || value === 'store' ? 'store' : value === 'own' ? 'own' : null)

class Refused extends Error {
  constructor(readonly refusal: SuppliersRefusal) {
    super(refusal.reason)
  }
}

export interface StoreSuppliersDeps {
  sql: postgres.Sql
  caller: StoreCaller
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
}

export const createStoreSuppliersService = ({ sql, caller, activity, facts, now }: StoreSuppliersDeps) => {
  const storeId = caller.store.id
  const inStore = <T>(work: (tx: ScopedSql) => Promise<T>) => withScope(sql, caller.context, work)

  const entry = (action: string, target: { id: string; label: string }, reason: string | null): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'person',
    actorId: caller.person.id,
    actorLabel: null,
    partnerId: caller.person.partnerId,
    storeId,
    target: { type: 'supplier', ...target },
    reason,
    api: 'store',
    visibility: 'store',
    ...facts,
  })

  const run = async <T>(work: (tx: ScopedSql) => Promise<T>): Promise<SuppliersResult<T>> => {
    try {
      return { ok: true, value: await inStore(work) }
    } catch (error) {
      if (error instanceof Refused) return { ok: false, ...error.refusal }
      throw error
    }
  }

  /** The supplier, locked, or NOT_FOUND. */
  const locked = async (tx: ScopedSql, id: string) => {
    const supplier = isUuid(id) ? await lockSupplier(tx, storeId, id) : null
    if (!supplier) throw new Refused({ reason: 'NOT_FOUND' })
    return supplier
  }

  const list = (filter: SupplierFilter, window: PageWindow) => inStore((tx) => selectSuppliers(tx, storeId, filter, window))
  const counts = () => inStore((tx) => countSuppliers(tx, storeId))
  const one = (id: string) => inStore((tx) => (isUuid(id) ? selectSupplier(tx, storeId, id) : Promise.resolve(null)))

  /**
   * SetTeam's three steps in one: the company and its first user, the Supplier admin (ACCESS §7.5), with
   * the plan's suppliers switch and limit (SAAS §6.2). The answer is the new supplier's id.
   */
  const invite = async (input: { name: string; email: string; accessLevel: string; shippingMode?: string | null | undefined; labelAccount?: string | null | undefined }): Promise<SuppliersResult<string>> => {
    const name = input.name.trim()
    const email = normalisedEmail(input.email)
    const tier = tierOf(input.accessLevel)
    const mode = modeOf(input.shippingMode ?? 'to-store')
    const labels = labelsOf(input.labelAccount)
    if (name === '' || name.length > 120 || !tier || !mode || !labels) return { ok: false, reason: 'INVALID_INPUT' }
    if (!email) return { ok: false, reason: 'INVALID_EMAIL' }
    const switchedOff = await planLimitFor(sql, caller.context, { key: 'suppliers_enabled' }, now())
    if (switchedOff) return { ok: false, reason: 'PLAN_LIMIT', limit: switchedOff }
    const allowance = await allowanceFor(sql, caller.context, 'suppliers', now())
    const result = await run(async (tx): Promise<{ id: string } | { over: number }> => {
      await lockStorePeople(tx, storeId)
      if (await supplierNameTaken(tx, storeId, name)) throw new Refused({ reason: 'DUPLICATE_SUPPLIER' })
      // Someone on the merchant side here can't also be a supplier here (DATA-MODEL §3.3).
      if (await holdsSeatHere(tx, storeId, null, email)) throw new Refused({ reason: 'ALREADY_MEMBER' })
      const wanted = (await countLiveSuppliers(tx, storeId)) + 1
      if (wanted > allowance) return { over: wanted }
      const id = crypto.randomUUID()
      await insertSupplier(tx, { id, storeId, name, tier, mode, labels, now: now() })
      const sent = await sendSupplierInvitation(tx, caller, { sellerId: id, email, role: 'supplier-admin', replacing: null, now: now() })
      if (typeof sent !== 'string') throw new Refused(sent)
      await activity.record(tx, entry(suppliersAudit.invited, { id, label: name }, tier))
      return { id }
    })
    if (!result.ok) return result
    if ('id' in result.value) return { ok: true, value: result.value.id }
    // Nothing was written; the plan that unlocks one more is read outside the locked transaction.
    const limit = await planLimitFor(sql, caller.context, { key: 'suppliers', total: result.value.over }, now())
    return { ok: false, reason: 'PLAN_LIMIT', limit: limit ?? { key: 'suppliers', limit: allowance, unlockedBy: null } }
  }

  /**
   * SetTeam's "Add a person": another login for the supplier, a member unless the Owner appoints an admin,
   * which is how a supplier whose last admin left gets one (ACCESS §7.5).
   */
  const addPerson = (id: string, rawEmail: string, rawRole: string | null | undefined) =>
    run(async (tx) => {
      const email = normalisedEmail(rawEmail)
      const role = supplierRoleOf(rawRole ?? 'supplier-member')
      if (!role) throw new Refused({ reason: 'INVALID_INPUT' })
      if (!email) throw new Refused({ reason: 'INVALID_EMAIL' })
      await lockStorePeople(tx, storeId)
      const supplier = await locked(tx, id)
      if (supplier.status === 'suspended') throw new Refused({ reason: 'SUSPENDED' })
      if (await holdsSeatHere(tx, storeId, id, email)) throw new Refused({ reason: 'ALREADY_MEMBER' })
      const sent = await sendSupplierInvitation(tx, caller, { sellerId: id, email, role, replacing: await openSupplierInvitationTo(tx, storeId, id, email), now: now() })
      if (typeof sent !== 'string') throw new Refused(sent)
      await activity.record(tx, entry(suppliersAudit.personAdded, { id, label: supplier.name }, role))
      return sent
    })

  /** It applies to every user of the supplier on their next request (ACCESS §7.5). */
  const setAccess = (id: string, accessLevel: string) =>
    run(async (tx) => {
      const tier = tierOf(accessLevel)
      if (!tier) throw new Refused({ reason: 'INVALID_INPUT' })
      const supplier = await locked(tx, id)
      if (supplier.access_level !== tier) {
        await setSupplierTier(tx, id, tier)
        await activity.record(tx, entry(suppliersAudit.accessChanged, { id, label: supplier.name }, `${supplier.access_level} → ${tier}`))
      }
      return true
    })

  /** Open orders keep the mode they were placed under (ACCESS §7.3); this one applies to orders placed after it. */
  const setShipping = (id: string, shippingMode: string, labelAccount: string | null | undefined) =>
    run(async (tx) => {
      const mode = modeOf(shippingMode)
      const given = labelAccount === null || labelAccount === undefined ? null : labelsOf(labelAccount)
      if (!mode || (labelAccount !== null && labelAccount !== undefined && !given)) throw new Refused({ reason: 'INVALID_INPUT' })
      const supplier = await locked(tx, id)
      // None sent keeps the stored choice: who books labels is asked only for to-shopper.
      const labels = given ?? supplier.label_account
      if (supplier.shipping_mode !== mode || supplier.label_account !== labels) {
        await setSupplierShipping(tx, id, mode, labels)
        await activity.record(tx, entry(suppliersAudit.shippingModeChanged, { id, label: supplier.name }, `${mode}, labels: ${labels}`))
      }
      return true
    })

  /** Its people can't sign in to the store; its products hide or keep selling, as the Owner chooses. Answers how many it hid. */
  const suspend = (id: string, hideProducts: boolean) =>
    run(async (tx) => {
      const supplier = await locked(tx, id)
      if (supplier.status === 'suspended') throw new Refused({ reason: 'ALREADY_SUSPENDED' })
      await markSupplierSuspended(tx, id, hideProducts, now())
      const hidden = hideProducts ? await hideSupplierProducts(tx, storeId, id, 'seller_suspended', now()) : 0
      await activity.record(tx, entry(suppliersAudit.suspended, { id, label: supplier.name }, hideProducts ? `products hidden: ${hidden}` : 'products keep selling'))
      return hidden
    })

  /** Hidden products come back as they were. Answers how many it showed again. */
  const resume = (id: string) =>
    run(async (tx) => {
      const supplier = await locked(tx, id)
      if (supplier.status !== 'suspended') throw new Refused({ reason: 'NOT_SUSPENDED' })
      await markSupplierResumed(tx, id)
      const restored = await restoreSupplierProducts(tx, storeId, id, now())
      await activity.record(tx, entry(suppliersAudit.resumed, { id, label: supplier.name }, `products back: ${restored}`))
      return restored
    })

  /** Its people lose access at once; its products are hidden and kept, still marked as its own (ACCESS §7.5). Answers how many it hid. */
  const remove = (id: string) =>
    run(async (tx) => {
      const supplier = await locked(tx, id)
      await markSupplierRemoved(tx, id, now())
      await endSupplierAccess(tx, storeId, id, now())
      const hidden = await hideSupplierProducts(tx, storeId, id, 'seller_removed', now())
      await activity.record(tx, entry(suppliersAudit.removed, { id, label: supplier.name }, `products hidden: ${hidden}`))
      return hidden
    })

  return { list, counts, one, invite, addPerson, setAccess, setShipping, suspend, resume, remove }
}

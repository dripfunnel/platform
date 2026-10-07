import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import { isUuid } from '#core/ids'
import type { TenantContext } from '#core/tenancy'
import { serialise, withScope } from '#db/scoped/index'
import { maxAddresses, removeAddress, renameShopper, saveAddress, selectAccount, selectAddresses } from '#db/scoped/shopper'
import { cleanAddress, type AddressInput } from '#engine/modules/cart/index'

export type { AddressRow } from '#db/scoped/shopper'

// A signed-in shopper's own account (ACCESS §2.1; FIRST-RELEASE §19 `account`, `addresses`): its name and saved
// addresses, read and written as the shopper, every change logged as an account event (LOGGING §3).

export const shopperAccountAudit = {
  updated: 'customer.updated',
  addressSaved: 'customer.address_saved',
  addressRemoved: 'customer.address_removed',
} as const

export type AccountRefusal = 'SIGNED_OUT' | 'INVALID_INPUT' | 'NOT_FOUND' | 'TOO_MANY'
export type AccountResult<T> = { ok: true; value: T } | { ok: false; reason: AccountRefusal }

export interface ShopperAccountDeps {
  sql: postgres.Sql
  context: TenantContext
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
}

export const createShopperAccount = ({ sql, context, activity, facts, now }: ShopperAccountDeps) => {
  const customerId = context.caller.kind === 'shopper' ? context.caller.customerId : null

  const entry = (action: string, id: string, label: string): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'customer',
    actorId: customerId,
    actorLabel: null,
    partnerId: context.partnerId,
    storeId: context.storeId,
    customerId,
    target: { type: action === shopperAccountAudit.updated ? 'customer' : 'customer_address', id, label },
    reason: null,
    api: 'shop',
    visibility: 'store',
    ...facts,
  })

  const signedIn = <T>(work: (me: string) => Promise<AccountResult<T>>): Promise<AccountResult<T>> => (customerId ? work(customerId) : Promise.resolve({ ok: false, reason: 'SIGNED_OUT' }))

  /** The shopper's own account with its addresses; null when signed out. */
  const account = async () => {
    if (!customerId) return null
    return withScope(sql, context, async (tx) => {
      const me = await selectAccount(tx, customerId)
      return me ? { ...me, addresses: await selectAddresses(tx, customerId) } : null
    })
  }

  const rename = (name: string | null) =>
    signedIn(async (me) => {
      const clean = name?.trim() || null
      if ((clean?.length ?? 0) > 200) return { ok: false, reason: 'INVALID_INPUT' }
      return withScope(sql, context, async (tx) => {
        await renameShopper(tx, me, clean)
        // recordAll returns nothing: the shopper can't read back an entry written for the merchant (visibility store).
        await activity.recordAll(tx, [entry(shopperAccountAudit.updated, me, 'Name')])
        return { ok: true, value: true as const }
      })
    })

  /** A new address, or one of the shopper's own changed; the default one is the only default. */
  const save = (id: string | null, input: AddressInput, isDefault: boolean) =>
    signedIn(async (me) => {
      const address = cleanAddress(input)
      if (!address || (id !== null && !isUuid(id))) return { ok: false, reason: 'INVALID_INPUT' }
      return withScope(sql, context, async (tx): Promise<AccountResult<string>> => {
        // One save at a time per shopper, so two at once can't both pass the cap.
        await serialise(tx, `customer_address:${me}`)
        if (id === null && (await selectAddresses(tx, me)).length >= maxAddresses) return { ok: false, reason: 'TOO_MANY' }
        const saved = await saveAddress(tx, context.storeId, me, id, { ...address, isDefault })
        if (!saved) return { ok: false, reason: 'NOT_FOUND' }
        await activity.recordAll(tx, [entry(shopperAccountAudit.addressSaved, saved, 'Address')])
        return { ok: true, value: saved }
      })
    })

  const remove = (id: string) =>
    signedIn(async (me) =>
      withScope(sql, context, async (tx): Promise<AccountResult<true>> => {
        if (!isUuid(id) || !(await removeAddress(tx, me, id, now()))) return { ok: false, reason: 'NOT_FOUND' }
        await activity.recordAll(tx, [entry(shopperAccountAudit.addressRemoved, id, 'Address')])
        return { ok: true, value: true }
      }),
    )

  return { account, rename, save, remove }
}

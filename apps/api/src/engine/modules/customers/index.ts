import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import { isUuid } from '#core/ids'
import type { PageWindow } from '#core/paging'
import type { TenantContext } from '#core/tenancy'
import { withScope, type ScopedSql } from '#db/scoped/index'
import {
  countCustomerGroups,
  countStoreCustomers,
  deleteCustomerGroup,
  groupNameTaken,
  insertCustomerGroup,
  insertStoreCustomer,
  liveGroupIds,
  lockCustomerGroup,
  lockStoreCustomer,
  recordConsentStopped,
  saveDefaultAddress,
  selectCustomerByContact,
  selectCustomerGroups,
  selectStoreCustomer,
  selectStoreCustomers,
  setCustomerGroups,
  setCustomerNote,
  setCustomerTags,
  updateCustomerGroup,
  updateStoreCustomer,
  type CustomerDetailRow,
  type CustomerFilter,
  type CustomerListRow,
  type GroupRow,
} from '#db/scoped/storeCustomers'
import { cleanAddress, cleanContact, type AddressInput } from '#engine/modules/cart/index'

// The store's customers (FIRST-RELEASE §7; DATA-MODEL §7.5): the merchant side only, in the caller's own scope, so row
// security keeps a supplier and another store out; a supplier is refused before any query runs.

export { ensureGuestCustomer, type ConsentState, type CustomerDetailRow, type CustomerFilter, type CustomerListRow, type GroupRow } from '#db/scoped/storeCustomers'
export { buildCustomerExport, createCustomerExportService, customerExportAudit, type CustomerExportDto } from './exports'

export const customersAudit = {
  added: 'customer.added',
  edited: 'customer.edited',
  tagsChanged: 'customer.tags_changed',
  noteChanged: 'customer.note_changed',
  consentRecorded: 'customer.consent_recorded',
  groupsChanged: 'customer.groups_changed',
  groupCreated: 'customer_group.created',
  groupUpdated: 'customer_group.updated',
  groupDeleted: 'customer_group.deleted',
} as const

export const maxTags = 20
export const maxTagLength = 24
export const maxCustomerNote = 2000
/** Groups a store keeps: the list and the chips show every one, so it is bounded rather than paged. */
export const maxGroups = 100

export type CustomersRefusal = 'INVALID_INPUT' | 'NOT_FOUND' | 'READ_ONLY' | 'TOO_MANY' | 'NAME_TAKEN' | 'NUMBER_TAKEN' | 'VERIFIED' | 'DELETED'
export type CustomersResult<T> = { ok: true; value: T } | { ok: false; reason: CustomersRefusal }

export interface CustomersDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
}

class Refused extends Error {
  constructor(readonly reason: CustomersRefusal) {
    super(reason)
  }
}

const cleanName = (raw: string, max: number): string | null => {
  const name = raw.trim()
  return name.length > 0 && name.length <= max ? name : null
}

export const createCustomersService = ({ sql, context, actor, activity, facts, now }: CustomersDeps) => {
  const { storeId } = context
  const supplier = context.sellerScope.kind === 'seller'
  const readOnly = context.caller.kind === 'support' && context.caller.access === 'read'

  // No shopper detail in an entry (LOGGING §4.1): the customer's id is the target, a note's text and the tags' values stay out.
  const entry = (action: string, target: { type: 'customer' | 'customer_group'; id: string; label: string }, changes: ActivityEntry['changes'] = []): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'person',
    actorId: actor.id,
    actorLabel: null,
    partnerId: actor.partnerId,
    storeId,
    ...(target.type === 'customer' ? { customerId: target.id } : {}),
    target,
    reason: null,
    changes,
    api: 'store',
    visibility: 'store',
    ...facts,
  })
  const customerTarget = (id: string) => ({ type: 'customer' as const, id, label: 'Customer' })
  const fieldsChanged = (fields: readonly string[]) => fields.map((field) => ({ field, before: null, after: 'changed' }))

  const read = <T>(work: (tx: ScopedSql) => Promise<T>, empty: T): Promise<T> => (supplier ? Promise.resolve(empty) : withScope(sql, context, work))
  const write = async <T>(work: (tx: ScopedSql) => Promise<T>): Promise<CustomersResult<T>> => {
    if (supplier) return { ok: false, reason: 'NOT_FOUND' }
    if (readOnly) return { ok: false, reason: 'READ_ONLY' }
    try {
      return { ok: true, value: await withScope(sql, context, work) }
    } catch (error) {
      if (error instanceof Refused) return { ok: false, reason: error.reason }
      throw error
    }
  }
  const locked = async (tx: ScopedSql, id: string) => {
    const found = isUuid(id) ? await lockStoreCustomer(tx, storeId, id) : null
    if (!found) throw new Refused('NOT_FOUND')
    return found
  }

  const list = (filter: CustomerFilter, window: PageWindow): Promise<CustomerListRow[]> => {
    if (filter.groupId !== null && !isUuid(filter.groupId)) return Promise.resolve([])
    const search = filter.search?.trim().slice(0, 100) || null
    return read((tx) => selectStoreCustomers(tx, storeId, { groupId: filter.groupId, search }, window), [])
  }
  const count = (): Promise<number> => read((tx) => countStoreCustomers(tx, storeId), 0)
  const detail = (id: string): Promise<CustomerDetailRow | null> => (isUuid(id) ? read((tx) => selectStoreCustomer(tx, storeId, id), null) : Promise.resolve(null))
  const groups = (): Promise<GroupRow[]> => read((tx) => selectCustomerGroups(tx, storeId), [])

  /** For people who buy in person or by phone (PortalOrders "Add a customer"): no email goes to them. */
  const add = (input: { name: string; email: string; phone: string | null }): Promise<CustomersResult<{ id: string; existed: boolean }>> =>
    write(async (tx) => {
      const name = cleanName(input.name, 200)
      const contact = cleanContact({ email: input.email, phone: input.phone })
      if (!name || !contact?.email) throw new Refused('INVALID_INPUT')
      const existing = await selectCustomerByContact(tx, storeId, contact.email, null)
      if (existing) {
        if (existing.status === 'deleted') throw new Refused('DELETED')
        return { id: existing.id, existed: true }
      }
      if (contact.phone && (await selectCustomerByContact(tx, storeId, null, contact.phone))) throw new Refused('NUMBER_TAKEN')
      const id = await insertStoreCustomer(tx, { storeId, name, email: contact.email, phone: contact.phone, byUserId: actor.id, now: now() })
      // Taken by a checkout or sign-up a moment ago: answered as the customer that now is.
      if (!id) {
        const raced = await selectCustomerByContact(tx, storeId, contact.email, null)
        if (!raced) throw new Refused('NUMBER_TAKEN')
        return { id: raced.id, existed: true }
      }
      await activity.record(tx, entry(customersAudit.added, customerTarget(id)))
      return { id, existed: false }
    })

  // The team edits what the shopper hasn't proven: a number proven by a code is the shopper's own (ACCESS §2.1).
  const edit = (id: string, input: { name?: string | null | undefined; phone?: string | null | undefined; address?: AddressInput | null | undefined }): Promise<CustomersResult<true>> =>
    write(async (tx) => {
      const found = await locked(tx, id)
      const name = input.name === undefined || input.name === null ? (found.name ?? '') : cleanName(input.name, 200)
      const phone = input.phone === undefined ? found.phone : input.phone === null || input.phone.trim() === '' ? null : (cleanContact({ phone: input.phone })?.phone ?? undefined)
      const address = input.address ? cleanAddress(input.address) : null
      if (name === null || name === '' || phone === undefined || (input.address && !address)) throw new Refused('INVALID_INPUT')
      if (phone !== found.phone && found.phone_verified) throw new Refused('VERIFIED')
      if (phone !== null && phone !== found.phone && (await selectCustomerByContact(tx, storeId, null, phone))) throw new Refused('NUMBER_TAKEN')
      const changed = [...(name !== found.name ? ['name'] : []), ...(phone !== found.phone ? ['phone'] : []), ...(address ? ['address'] : [])]
      if (changed.length === 0) return true as const
      await updateStoreCustomer(tx, found.id, { name, phone })
      if (address) await saveDefaultAddress(tx, storeId, found.id, address)
      await activity.record(tx, entry(customersAudit.edited, customerTarget(found.id), fieldsChanged(changed)))
      return true as const
    })

  const setTags = (id: string, raw: readonly string[]): Promise<CustomersResult<string[]>> =>
    write(async (tx) => {
      const tags: string[] = []
      for (const t of raw) {
        const tag = t.trim()
        if (tag.length === 0 || tag.length > maxTagLength) throw new Refused('INVALID_INPUT')
        if (!tags.some((x) => x.toLowerCase() === tag.toLowerCase())) tags.push(tag)
      }
      if (tags.length > maxTags) throw new Refused('TOO_MANY')
      const found = await locked(tx, id)
      if (tags.join('\n') === found.tags.join('\n')) return tags
      await setCustomerTags(tx, found.id, tags)
      await activity.record(tx, entry(customersAudit.tagsChanged, customerTarget(found.id), [{ field: 'tags', before: String(found.tags.length), after: String(tags.length) }]))
      return tags
    })

  const setNote = (id: string, raw: string | null): Promise<CustomersResult<true>> =>
    write(async (tx) => {
      const note = raw?.trim() || null
      if ((note?.length ?? 0) > maxCustomerNote) throw new Refused('INVALID_INPUT')
      const found = await locked(tx, id)
      await setCustomerNote(tx, found.id, note)
      await activity.record(tx, entry(customersAudit.noteChanged, customerTarget(found.id)))
      return true as const
    })

  /** Only the shopper opts in; the team records that they asked to stop (FIRST-RELEASE §7). */
  const recordStop = (id: string): Promise<CustomersResult<true>> =>
    write(async (tx) => {
      const found = await locked(tx, id)
      if (found.consent_state === 'stopped') return true as const
      await recordConsentStopped(tx, found.id, now())
      await activity.record(tx, entry(customersAudit.consentRecorded, customerTarget(found.id), [{ field: 'consent', before: found.consent_state, after: 'stopped' }]))
      return true as const
    })

  const setGroups = (id: string, raw: readonly string[]): Promise<CustomersResult<string[]>> =>
    write(async (tx) => {
      const ids = [...new Set(raw.map((g) => g.toLowerCase()))]
      if (!ids.every(isUuid) || ids.length > maxGroups) throw new Refused('INVALID_INPUT')
      const found = await locked(tx, id)
      // Another store's group is as unknown as one that doesn't exist.
      const live = await liveGroupIds(tx, storeId, ids)
      if (live.length !== ids.length) throw new Refused('NOT_FOUND')
      await setCustomerGroups(tx, storeId, found.id, live)
      await activity.record(tx, entry(customersAudit.groupsChanged, customerTarget(found.id), [{ field: 'groups', before: null, after: String(live.length) }]))
      return live
    })

  const cleanGroup = (input: { name: string; description?: string | null | undefined }) => {
    const name = cleanName(input.name, 60)
    const description = input.description?.trim() || null
    if (!name || (description?.length ?? 0) > 200) throw new Refused('INVALID_INPUT')
    return { name, description }
  }
  const groupTarget = (id: string, name: string) => ({ type: 'customer_group' as const, id, label: name })

  const createGroup = (input: { name: string; description?: string | null | undefined }): Promise<CustomersResult<string>> =>
    write(async (tx) => {
      const g = cleanGroup(input)
      if ((await countCustomerGroups(tx, storeId)) >= maxGroups) throw new Refused('TOO_MANY')
      if (await groupNameTaken(tx, storeId, g.name, null)) throw new Refused('NAME_TAKEN')
      const id = await insertCustomerGroup(tx, { storeId, ...g, now: now() })
      await activity.record(tx, entry(customersAudit.groupCreated, groupTarget(id, g.name)))
      return id
    })

  const updateGroup = (id: string, input: { name: string; description?: string | null | undefined }): Promise<CustomersResult<true>> =>
    write(async (tx) => {
      const g = cleanGroup(input)
      const found = isUuid(id) ? await lockCustomerGroup(tx, storeId, id) : null
      if (!found) throw new Refused('NOT_FOUND')
      if (await groupNameTaken(tx, storeId, g.name, found.id)) throw new Refused('NAME_TAKEN')
      await updateCustomerGroup(tx, found.id, g)
      await activity.record(tx, entry(customersAudit.groupUpdated, groupTarget(found.id, g.name), found.name === g.name ? [] : [{ field: 'name', before: found.name, after: g.name }]))
      return true as const
    })

  const deleteGroup = (id: string): Promise<CustomersResult<true>> =>
    write(async (tx) => {
      const found = isUuid(id) ? await lockCustomerGroup(tx, storeId, id) : null
      if (!found) throw new Refused('NOT_FOUND')
      await deleteCustomerGroup(tx, found.id, now())
      await activity.record(tx, entry(customersAudit.groupDeleted, groupTarget(found.id, found.name)))
      return true as const
    })

  return { list, count, detail, groups, add, edit, setTags, setNote, recordStop, setGroups, createGroup, updateGroup, deleteGroup }
}

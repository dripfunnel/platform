import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import { partnerScopedRoles, roleHas } from '#auth/permissions'
import type { StaffMember } from '#auth/staff'
import { countCustomerMatches, selectCustomer, selectCustomers, selectStoreChoices, type CustomerFilter, type CustomerRow, type SignInMethod } from '#db/scoped/customers'
import { withScope } from '#db/scoped/index'
import { selectPartnerNames } from '#db/scoped/stores'
import type { PageInfo } from '#saas/activity/index'
import { decodePage, pageOf, staffEntry, type PageRequest } from '#saas/staff/index'
import { classifySearch, maskEmail, maskPhone } from './mask'

export { classifySearch, maskEmail, maskPhone } from './mask'

// Customers on the Admin API (ui/admin/FIRST-RELEASE.md §5.4; card #36): read-only, masked in
// the list for every role, unmasked on the detail for `customers.contact.read` alone.

export const customerPageSize = 25
export const customerAudit = { viewCustomer: 'customer.viewed' } as const
const day = 24 * 60 * 60 * 1000

export const customerFilter = z.strictObject({
  partner: z.guid().optional(),
  store: z.guid().optional(),
  status: z.enum(['active', 'unverified', 'deleted']).optional(),
  via: z.enum(['email', 'mobile', 'both']).optional(),
  created: z.enum(['7d', '30d']).optional(),
  lastSignIn: z.enum(['7d', '30d']).optional(),
})

export interface CustomersDeps {
  sql: postgres.Sql
  staff: StaffMember
  facts: RequestFacts
  activity: ActivityLog
  now: () => Date
}

const methodOf = (c: CustomerRow): SignInMethod | null => (c.email && c.phone ? 'both' : c.phone ? 'mobile' : c.email ? 'email' : null)
const regionOf = (code: string | null) => (code ? `+${code}` : null)

/** A row with its contact masked, or none at all once the account is deleted (pseudonymised). */
const rowOf = (c: CustomerRow, contact: (c: CustomerRow) => { email: string | null; phone: string | null }) => {
  const deleted = c.status === 'deleted'
  const shown = deleted ? { email: null, phone: null } : contact(c)
  return {
    id: c.id,
    name: deleted ? null : c.name,
    email: shown.email,
    phone: shown.phone,
    // The number's calling code, so one national number in two countries reads as two people (#42).
    phoneRegion: deleted ? null : regionOf(c.phone_country_code),
    store: { id: c.store_id, name: c.store_name },
    partner: { id: c.partner_id, name: c.partner_name },
    signsInWith: deleted ? null : methodOf(c),
    status: c.status,
    // A count only (§5.4); null until the Store strand's order table exists, never a made-up 0.
    orders: null,
    createdAt: c.created_at,
    lastSignInAt: c.last_sign_in_at,
  }
}
const masked = (c: CustomerRow) => ({ email: maskEmail(c.email), phone: maskPhone(c.phone, c.phone_country_code) })
const full = (c: CustomerRow) => ({ email: c.email, phone: c.phone })

export type CustomerRowDto = ReturnType<typeof rowOf>

export const createCustomersService = ({ sql, staff, facts, activity, now }: CustomersDeps) => {
  const context = { caller: { kind: 'staff' as const, staffId: staff.id } }
  const assignedTo = partnerScopedRoles.includes(staff.role) ? staff.id : undefined
  const mayContact = roleHas(staff.role, 'customers.contact.read')

  /** Null for a filter, search or cursor it cannot read. The search travels apart from the filter: never in a URL (#42). */
  const customers = async (raw: unknown, search: string | null, page: PageRequest) => {
    const parsed = customerFilter.safeParse(raw ?? {})
    if (!parsed.success) return null
    const decoded = decodePage(page, customerPageSize)
    if (!decoded.ok) return null
    const term = search === null || search.trim() === '' ? undefined : classifySearch(search.slice(0, 254))
    if (term === null) return null
    const f = parsed.data
    const at = now()
    const within = (d: '7d' | '30d') => new Date(at.getTime() - (d === '7d' ? 7 : 30) * day)
    const filter: CustomerFilter = {
      partnerId: f.partner,
      storeId: f.store,
      status: f.status,
      method: f.via,
      createdAfter: f.created ? within(f.created) : undefined,
      signedInAfter: f.lastSignIn ? within(f.lastSignIn) : undefined,
      assignedTo,
      search: term,
    }
    return withScope(sql, context, async (tx) => {
      const rows = await selectCustomers(tx, filter, decoded, decoded.limit)
      const { rows: pageRows, pageInfo } = pageOf(rows, decoded, (r) => ({ occurredAt: r.created_at, id: r.id }))
      // §5.4: an exact search says how many accounts use it, over every page, and the phones' countries.
      const kind = term?.kind === 'email' || term?.kind === 'phone' ? term.kind : null
      const counted = kind ? await countCustomerMatches(tx, filter) : null
      return {
        items: pageRows.map((r) => rowOf(r, masked)),
        pageInfo: pageInfo as PageInfo,
        match: kind && counted ? { kind, accounts: counted.accounts, regions: kind === 'phone' ? counted.codes.map((code) => `+${code}`) : [] } : null,
        partners: await selectPartnerNames(tx, assignedTo),
        stores: f.partner ? await selectStoreChoices(tx, f.partner, assignedTo) : [],
      }
    })
  }

  /** The detail, logged as a view (§5.4); null outside the caller's reach, as for an unknown id. */
  const customer = async (id: string) => {
    if (!z.guid().safeParse(id).success) return null
    return withScope(sql, context, async (tx) => {
      const c = await selectCustomer(tx, id, assignedTo)
      if (!c) return null
      const row = rowOf(c, mayContact ? full : masked)
      await activity.record(
        tx,
        staffEntry(staff, facts)({
          category: 'security',
          action: customerAudit.viewCustomer,
          reason: null,
          partnerId: c.partner_id,
          storeId: c.store_id,
          // Named, so a search or a data request by customer finds who looked (staff-only visibility).
          customerId: c.id,
          target: { type: 'customer', id: c.id, label: `${row.name ?? 'Deleted customer'} at ${c.store_name}` },
          visibility: 'staff',
        }),
      )
      return {
        ...row,
        emailVerified: c.email_verified_at !== null,
        phoneVerified: c.phone_verified_at !== null,
        // The API says it withheld the full values, so the page can say who may see them.
        contactsMasked: !mayContact && c.status !== 'deleted',
        // No erasure record exists yet (§11's requests), so a deleted account has no date to give.
        deletedAt: null,
        storeSuspension: c.store_suspended ? { reason: c.store_suspended_reason ?? '' } : null,
      }
    })
  }

  return { customers, customer }
}

export type CustomersService = ReturnType<typeof createCustomersService>
export type CustomerDetailDto = NonNullable<Awaited<ReturnType<CustomersService['customer']>>>
export type CustomerPageDto = NonNullable<Awaited<ReturnType<CustomersService['customers']>>>

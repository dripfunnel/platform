import type { ActivityEntry, ActivityFilter, ActivityPage } from '../../api/activity'

const harness = import.meta.env.DEV || import.meta.env.VITE_STATE_HARNESS === '1'

const entry = (e: Pick<ActivityEntry, 'id' | 'at' | 'action' | 'actor'> & Partial<ActivityEntry>): ActivityEntry => ({ category: 'store', result: 'success', onBehalfOf: null, through: null, target: null, changes: [], reason: null, ...e })

const farhan = { kind: 'person', id: 'p-farhan', label: 'Farhan Ali <farhan@kesarithreads.in>' }
const priya = { kind: 'person', id: 'p-priya', label: 'Priya Shah <priya@kesarithreads.in>' }
const support = { kind: 'support_session', id: 'ss-1', label: 'Farhan Ali' }
const ravi = { kind: 'partner_user', id: 'pu-ravi', label: 'Ravi Kumar <ravi@juniper.example>' }

/** StoreActivity's rows, for the harness (ui/README §6). */
export const sampleActivity: ActivityEntry[] = harness
  ? [
      entry({ id: 'e1', at: '2026-10-11T10:49:00Z', action: 'product.updated', actor: support, onBehalfOf: ravi, through: { kind: 'support_session', id: 'ss-1' }, target: { type: 'product', id: 'prod-1', label: 'Organic Cotton Tee' }, changes: [{ field: 'Main photo', before: 'tee-sand-1.jpg', after: 'tee-sand-2.jpg' }], reason: 'Ticket #4821' }),
      entry({ id: 'e2', at: '2026-10-11T10:47:00Z', action: 'support_session.write_allowed', actor: farhan }),
      entry({ id: 'e3', at: '2026-10-11T10:14:00Z', action: 'order.placed', actor: { kind: 'customer', id: 'c-ananya', label: 'Ananya Rao' }, target: { type: 'order', id: 'ord-1051', label: 'KT-1051' } }),
      entry({ id: 'e4', at: '2026-10-11T09:30:00Z', action: 'stock.adjusted', actor: { kind: 'api_key', id: 'k1', label: 'Warehouse stock sync' }, target: { type: 'product_version', id: 'v1', label: 'Mara Linen Shirt / M' }, changes: [{ field: 'Quantity', before: '0', after: '6' }] }),
      entry({ id: 'e5', at: '2026-10-10T17:20:00Z', action: 'order.refunded', actor: priya, target: { type: 'order', id: 'ord-1031', label: 'KT-1031' }, reason: 'Arrived damaged' }),
      entry({ id: 'e6', at: '2026-10-10T02:00:00Z', action: 'orders.exported', actor: { kind: 'app_grant', id: 'g1', label: 'Ledger Sync' } }),
      entry({ id: 'e7', at: '2026-10-02T12:11:00Z', action: 'person.sign_in_refused', result: 'denied', actor: { kind: 'person', id: 'p-tom', label: 'Tom Okafor <tom@kesarithreads.in>' } }),
      entry({ id: 'e8', at: '2026-10-01T18:05:00Z', action: 'api_key.created', actor: farhan, target: { type: 'api_key', id: 'k1', label: 'Warehouse stock sync' }, changes: [{ field: 'scopes', before: null, after: 'catalog.read, stock.read' }] }),
    ]
  : []

/** The log under ?state=: the sample, filtered as the API would by person and words. */
export const sampleRead = async (filter: ActivityFilter): Promise<ActivityPage> => ({
  entries: sampleActivity.filter((e) => (!filter.person || (e.actor.kind === filter.person.kind && e.actor.id === filter.person.id)) && (!filter.search || `${e.actor.label ?? ''} ${e.target?.label ?? ''}`.toLowerCase().includes(filter.search.toLowerCase()))),
  next: null,
})

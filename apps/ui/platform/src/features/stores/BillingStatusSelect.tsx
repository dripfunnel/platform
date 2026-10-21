import { billingStatuses, type BillingStatus, type StoreRow } from '../../api/stores'
import { fill, messages } from '../../messages'

const words = messages.stores.billingStatus

export interface BillingStatusSelectProps {
  store: StoreRow
  allowed: boolean
  onChange: (store: StoreRow, status: BillingStatus) => void
}

// Own-billing mode (§6.1, §11.4): the partner sets each store's status inline; a refused role sees it disabled, the reason once above the table.
export const BillingStatusSelect = ({ store, allowed, onChange }: BillingStatusSelectProps) => {
  if (store.billingStatus === null) return <span className="df-muted">{messages.stores.noSales}</span>
  return (
    <select
      className="df-billing-select"
      value={store.billingStatus}
      aria-label={fill(words.label, { name: store.name })}
      disabled={!allowed}
      aria-describedby={allowed ? undefined : 'billing-status-refused'}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => {
        const status = billingStatuses.find((candidate) => candidate === event.target.value)
        if (status) onChange(store, status)
      }}
    >
      {billingStatuses.map((status) => (
        <option key={status} value={status}>
          {words.statuses[status]}
        </option>
      ))}
    </select>
  )
}

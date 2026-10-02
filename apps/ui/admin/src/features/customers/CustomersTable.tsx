import { Link } from '@tanstack/react-router'
import type { CustomerRow } from '../../api/customers'
import { formatCount, formatCountry, formatDate, messages } from '../../messages'
import { ClickableRow } from '@dripfunnel/shared/ui'
import { CustomerStatusPill } from './customerLook'
import '@dripfunnel/shared/ui/list.css'
import './customers.css'

const words = messages.customers

export interface CustomersTableProps {
  customers: readonly CustomerRow[]
  // On a store's page the Store and Partner columns would say the same thing on every row.
  inStore: boolean
  // After a phone search spanning countries, each number names its country (decided on #42).
  showPhoneRegion: boolean
}

// The §5.4 columns, in the prototype's order. Email and phone are shown as the API sent them.
const Row = ({ customer, inStore, showPhoneRegion }: { customer: CustomerRow } & Omit<CustomersTableProps, 'customers'>) => (
  <ClickableRow>
    <th scope="row">
      <Link to="/customers/$customerId" params={{ customerId: customer.id }} className={customer.name ? 'df-row-title' : 'df-row-title df-row-title--deleted'}>
        {customer.name ?? words.deletedName}
      </Link>
    </th>
    <td>
      <code>{customer.email ?? words.none}</code>
    </td>
    <td className="df-nowrap">
      <div className="df-stack">
        <code>{customer.phone ?? words.none}</code>
        {showPhoneRegion && customer.phoneRegion && <span className="df-muted">{formatCountry(customer.phoneRegion)}</span>}
      </div>
    </td>
    {!inStore && (
      <>
        <td>
          <Link to="/stores/$storeId" params={{ storeId: customer.store.id }} className="df-row-link">
            {customer.store.name}
          </Link>
        </td>
        <td>
          <Link to="/partners/$partnerId" params={{ partnerId: customer.partner.id }} className="df-row-link">
            {customer.partner.name}
          </Link>
        </td>
      </>
    )}
    <td>{customer.signsInWith ? words.signInMethods[customer.signsInWith] : words.none}</td>
    <td>
      <CustomerStatusPill status={customer.status} />
    </td>
    <td className="df-number">{formatCount(customer.orders)}</td>
    <td className="df-muted df-nowrap">{formatDate(customer.createdAt)}</td>
    <td className="df-muted df-nowrap">{customer.lastSignInAt ? formatDate(customer.lastSignInAt) : words.none}</td>
  </ClickableRow>
)

// Scrolls sideways inside itself on a narrow screen, and takes focus so a keyboard can
// scroll it (WCAG 2.1.1).
export const CustomersTable = ({ customers, inStore, showPhoneRegion }: CustomersTableProps) => {
  const columns = Object.entries(words.columns)
    .filter(([key]) => !inStore || (key !== 'store' && key !== 'partner'))
    .map(([, label]) => label)
  return (
    <div className="df-table-scroll" role="region" aria-label={words.tableLabel} tabIndex={0}>
      <table className="df-table df-customers-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col" className={column === words.columns.orders ? 'df-number' : undefined}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {customers.map((customer) => (
            <Row key={customer.id} customer={customer} inStore={inStore} showPhoneRegion={showPhoneRegion} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

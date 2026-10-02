import { Link } from '@tanstack/react-router'
import type { Customer } from '../../api/customers'
import { fill, messages } from '../../messages'
import { Tile } from '../common/Tile'
import { CustomerStatusPill } from './customerLook'
import '@dripfunnel/shared/ui/list.css'
import '../common/detail.css'

const words = messages.customer

// The prototype's customer header: Customer · partner › store, the status, then where the
// account lives and the reminder that opening it was recorded.
export const CustomerHeader = ({ customer }: { customer: Customer }) => {
  const name = customer.name ?? messages.customers.deletedName
  return (
    <header className="df-detail-header">
      <nav aria-label={words.breadcrumbLabel} className="df-breadcrumb">
        <Link to="/customers">{words.breadcrumb}</Link>
        <span aria-hidden="true">›</span>
        <span aria-current="page">{name}</span>
      </nav>
      <div className="df-detail-title">
        <Tile name={customer.name ?? ''} {...(customer.name ? {} : { initials: messages.customers.none })} large neutral />
        <div className="df-detail-heading">
          <p className="df-eyebrow">{fill(words.level, { partner: customer.partner.name, store: customer.store.name })}</p>
          <div className="df-detail-name">
            <h1 className="df-page-title">{name}</h1>
            <CustomerStatusPill status={customer.status} />
          </div>
        </div>
      </div>
      <dl className="df-detail-meta">
        <div>
          <dt>{words.meta.store}</dt>
          <dd>
            <Link to="/stores/$storeId" params={{ storeId: customer.store.id }} className="df-meta-link">
              {customer.store.name}
            </Link>
          </dd>
        </div>
        <div>
          <dt>{words.meta.partner}</dt>
          <dd>
            <Link to="/partners/$partnerId" params={{ partnerId: customer.partner.id }} className="df-meta-link">
              {customer.partner.name}
            </Link>
          </dd>
        </div>
        <div>
          <dd className="df-meta-value">{words.meta.recorded}</dd>
        </div>
      </dl>
    </header>
  )
}

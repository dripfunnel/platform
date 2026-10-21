import { Tile } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import { fill, messages } from '../../messages'
import { StoreActions, type StoreActionsProps } from './StoreActions'
import { DomainCell, StatusSub, StoreStatusPill } from './storeLook'

const words = messages.store

// The prototype's store header (§6.3): initials, "Store · {product}", name, status, code, the live link, Actions ▾.
export const StoreHeader = ({ store, product, onAction }: StoreActionsProps & { product: string }) => (
  <header className="df-detail-header">
    <nav aria-label={words.breadcrumbLabel} className="df-breadcrumb">
      <Link to="/stores">{messages.screens.stores.title}</Link>
      <span aria-hidden="true">›</span>
      <span aria-current="page">{store.name}</span>
    </nav>
    <div className="df-detail-title">
      <Tile name={store.name} large neutral />
      <div className="df-detail-heading">
        <p className="df-eyebrow">{fill(words.level, { product })}</p>
        <div className="df-detail-name">
          <h1 className="df-page-title">{store.name}</h1>
          <StoreStatusPill state={store.state} />
        </div>
        <div className="df-store-meta">
          <code className="df-muted">{store.code}</code>
          <DomainCell domain={store.domain} code={store.code} />
          <StatusSub state={store.state} />
        </div>
      </div>
    </div>
    <StoreActions store={store} onAction={onAction} />
  </header>
)

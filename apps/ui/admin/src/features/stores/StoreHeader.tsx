import { Link } from '@tanstack/react-router'
import { fill, messages } from '../../messages'
import { Tile } from '../common/Tile'
import { StoreActions, type StoreActionsProps } from './StoreActions'
import { DomainPill, StatusSub, StoreStatusPill } from './storeLook'
import './stores.css'

const words = messages.store

// The prototype's store header: Stores › partner, the status and its line, then Live,
// Partner and Code.
export const StoreHeader = ({ store, onAction, onJob }: StoreActionsProps) => (
  <header className="df-detail-header">
    <nav aria-label={words.breadcrumbLabel} className="df-breadcrumb">
      <Link to="/stores">{words.breadcrumb}</Link>
      <span aria-hidden="true">›</span>
      <Link to="/partners/$partnerId" params={{ partnerId: store.partner.id }}>
        {store.partner.name}
      </Link>
      <span aria-hidden="true">›</span>
      <span aria-current="page">{store.name}</span>
    </nav>
    <div className="df-detail-title">
      <Tile name={store.name} large neutral />
      <div className="df-detail-heading">
        <p className="df-eyebrow">{fill(words.level, { partner: store.partner.name })}</p>
        <div className="df-detail-name">
          <h1 className="df-page-title">{store.name}</h1>
          <StoreStatusPill state={store.state} />
        </div>
        <StatusSub state={store.state} />
      </div>
    </div>
    <dl className="df-detail-meta">
      <div>
        <dt>{words.meta.live}</dt>
        <dd>
          <a href={`https://${store.domain.host}`} target="_blank" rel="noopener noreferrer" className="df-meta-link">
            {store.domain.host}
          </a>
          {store.domain.status !== 'live' && <DomainPill status={store.domain.status} />}
        </dd>
      </div>
      <div>
        <dt>{words.meta.partner}</dt>
        <dd>
          <Link to="/partners/$partnerId" params={{ partnerId: store.partner.id }} className="df-meta-link">
            {store.partner.name}
          </Link>
        </dd>
      </div>
      <div>
        <dt>{words.meta.code}</dt>
        <dd className="df-meta-value">{store.code}</dd>
      </div>
    </dl>
    <StoreActions store={store} onAction={onAction} onJob={onJob} />
  </header>
)

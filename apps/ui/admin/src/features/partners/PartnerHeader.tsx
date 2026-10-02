import { Link } from '@tanstack/react-router'
import type { Partner, PartnerAction } from '../../api/partners'
import { formatCount, messages } from '../../messages'
import { PartnerActions } from './PartnerActions'
import { Tile } from '@dripfunnel/shared/ui'
import { HostPill, HouseBadge, InvitationPill, PartnerStatePill } from './partnerLook'
import './partners.css'

const words = messages.partner

export interface PartnerHeaderProps {
  partner: Partner
  onAction: (action: PartnerAction) => void
}

export const PartnerHeader = ({ partner, onAction }: PartnerHeaderProps) => {
  const { portalHost, owner } = partner
  return (
    <header className="df-detail-header">
      <nav aria-label={words.breadcrumbLabel} className="df-breadcrumb">
        <Link to="/partners">{words.breadcrumb}</Link>
        <span aria-hidden="true">›</span>
        <span aria-current="page">{partner.name}</span>
      </nav>
      <div className="df-detail-title">
        <Tile name={partner.name} large />
        <div className="df-detail-heading">
          <p className="df-eyebrow">{words.level}</p>
          <div className="df-detail-name">
            <h1 className="df-page-title">{partner.name}</h1>
            <PartnerStatePill state={partner.state} />
            {partner.house && <HouseBadge />}
          </div>
          {partner.state === 'paused' && <p className="df-paused-note">{words.pausedNote}</p>}
        </div>
      </div>
      <dl className="df-detail-meta">
        <div>
          <dt>{words.meta.portalHost}</dt>
          <dd>
            {portalHost.host && <code className="df-host">{portalHost.host}</code>}
            <HostPill status={portalHost.status} />
          </dd>
        </div>
        <div>
          <dt>{words.meta.stores}</dt>
          <dd>
            <Link to="/partners/$partnerId" params={{ partnerId: partner.id }} search={{ tab: 'stores' }} className="df-row-link">
              {formatCount(partner.stores)}
            </Link>
          </dd>
        </div>
        <div>
          <dt>{words.meta.owner}</dt>
          <dd>
            {owner.invitation === 'active' && owner.name ? (
              owner.name
            ) : (
              <>
                {owner.email} <InvitationPill status={owner.invitation} />
              </>
            )}
          </dd>
        </div>
      </dl>
      <PartnerActions partner={partner} onAction={onAction} />
    </header>
  )
}

import { Link } from '@tanstack/react-router'
import type { PartnerRow } from '../../api/partners'
import { fill, formatCount, formatDate, messages } from '../../messages'
import { HostPill, HouseBadge, InvitationPill, PartnerStatePill, PartnerTile } from './partnerLook'
import './partners.css'

const words = messages.partners
const columns = words.columns

const Row = ({ partner }: { partner: PartnerRow }) => {
  const { setup, owner, portalHost } = partner
  return (
    <tr>
      <th scope="row">
        <div className="df-partner-cell">
          <PartnerTile name={partner.name} />
          <div>
            <p className="df-partner-name">
              <Link to="/partners/$partnerId" params={{ partnerId: partner.id }} className="df-row-title">
                {partner.name}
              </Link>
              {partner.house && <HouseBadge />}
            </p>
            <p className="df-muted">
              {partner.kind} · {partner.region}
            </p>
          </div>
        </div>
      </th>
      <td>
        <PartnerStatePill state={partner.state} />
      </td>
      <td className="df-number">
        <Link
          to="/stores"
          search={{ partner: partner.id }}
          className="df-row-link"
          aria-label={fill(words.storesLabel, { count: formatCount(partner.stores), name: partner.name })}
        >
          {formatCount(partner.stores)}
        </Link>
      </td>
      <td>
        <div className="df-stack">
          {portalHost.host && <code className="df-host">{portalHost.host}</code>}
          <HostPill status={portalHost.status} />
        </div>
      </td>
      <td>
        {setup.done === setup.total ? (
          <span className="df-setup df-setup--complete">{words.setupComplete}</span>
        ) : (
          <span className="df-setup">{fill(words.setupProgress, { done: formatCount(setup.done), total: formatCount(setup.total) })}</span>
        )}
      </td>
      <td>
        <div className="df-stack">
          <span>{owner.name ?? words.notJoined}</span>
          <span className="df-muted">{owner.email}</span>
          <InvitationPill status={owner.invitation} />
          {owner.invitation === 'sent' && owner.invitationSentAt && (
            <span className="df-muted">{fill(words.invitationSent, { date: formatDate(owner.invitationSentAt) })}</span>
          )}
        </div>
      </td>
      <td className="df-muted df-nowrap">{formatDate(partner.createdAt)}</td>
    </tr>
  )
}

// Scrolls sideways inside itself on a narrow screen, and takes focus so a keyboard can
// scroll it (WCAG 2.1.1).
export const PartnersTable = ({ partners }: { partners: readonly PartnerRow[] }) => (
  <div className="df-table-scroll" role="region" aria-label={words.tableLabel} tabIndex={0}>
    <table className="df-table">
      <thead>
        <tr>
          <th scope="col">{columns.partner}</th>
          <th scope="col">{columns.state}</th>
          <th scope="col" className="df-number">
            {columns.stores}
          </th>
          <th scope="col">{columns.portalHost}</th>
          <th scope="col">{columns.setup}</th>
          <th scope="col">{columns.owner}</th>
          <th scope="col">{columns.created}</th>
        </tr>
      </thead>
      <tbody>
        {partners.map((partner) => (
          <Row key={partner.id} partner={partner} />
        ))}
      </tbody>
    </table>
  </div>
)

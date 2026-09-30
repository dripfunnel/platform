import { Link } from '@tanstack/react-router'
import type { ActionPermission } from '../../api/partners'
import { messages } from '../../messages'
import { PermissionDenied } from '../common/PermissionDenied'
import { refusalText } from './refusal'
import './partners.css'

const words = messages.partners

// Create partner is its own screen (#61); the list only links to it.
export const CreatePartner =({ permission }: { permission: ActionPermission }) => {
  const reason = refusalText(permission, 'create', '')
  if (reason !== null) return <PermissionDenied actionLabel={words.create} reason={reason} />
  return (
    <Link to="/partners/new" className="df-button df-button--primary">
      {words.create}
    </Link>
  )
}

export const PartnersHeader = ({ create }: { create?: ActionPermission }) => (
  <header className="df-list-header">
    <div className="df-list-heading">
      <p className="df-eyebrow">{words.level}</p>
      <h1 className="df-page-title">{words.title}</h1>
      <p className="df-page-lede">{words.sub}</p>
    </div>
    {create && <CreatePartner permission={create} />}
  </header>
)

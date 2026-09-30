import { Link } from '@tanstack/react-router'
import type { ActionPermission } from '../../api/partners'
import { messages } from '../../messages'
import { ListHeader } from '../common/ListHeader'
import { PermissionDenied } from '../common/PermissionDenied'
import { refusalText } from './refusal'

const words = messages.partners

// Create partner is its own screen (#61); the list only links to it.
export const CreatePartner = ({ permission }: { permission: ActionPermission }) => {
  const reason = refusalText(permission, 'create', '')
  if (reason !== null) return <PermissionDenied actionLabel={words.create} reason={reason} />
  return (
    <Link to="/partners/new" className="df-button df-button--primary">
      {words.create}
    </Link>
  )
}

export const PartnersHeader = ({ create }: { create?: ActionPermission }) => (
  <ListHeader level={words.level} title={words.title} sub={words.sub} action={create && <CreatePartner permission={create} />} />
)

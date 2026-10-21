import { PermissionDenied } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import type { CreatePermission } from '../../api/stores'
import { fill, messages } from '../../messages'

export interface CreateStoreButtonProps {
  permission: CreatePermission
  product: string
  label?: string
}

// The API's answer, rendered: a link for Owners and Admins, otherwise disabled with the reason (ui/README.md §5).
export const CreateStoreButton = ({ permission, product, label = messages.stores.create }: CreateStoreButtonProps) =>
  permission.allowed ? (
    <Link to="/stores/new" className="df-button df-button--primary">
      {label}
    </Link>
  ) : (
    <PermissionDenied actionLabel={label} reason={fill(messages.stores.refused[permission.reason], { product })} />
  )

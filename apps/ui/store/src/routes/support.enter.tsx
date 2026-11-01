import { handoffSearch } from '@dripfunnel/shared/ui'
import { createFileRoute } from '@tanstack/react-router'
import { SupportEnter } from '../features/support-session/SupportEnter'

const Enter = () => {
  const { token } = Route.useSearch()
  const navigate = Route.useNavigate()
  return <SupportEnter token={token} replaceUrl={(to) => void navigate({ to, search: {}, replace: true })} />
}

export const Route = createFileRoute('/support/enter')({ validateSearch: handoffSearch, component: Enter })

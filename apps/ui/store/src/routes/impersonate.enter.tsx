import { handoffSearch, HandoffScreen } from '@dripfunnel/shared/ui'
import { createFileRoute } from '@tanstack/react-router'
import { adminConsoleUrl, staffSession } from '../api/staffSession'
import { messages } from '../messages'

const Enter = () => {
  const { token } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <HandoffScreen
      token={token}
      client={staffSession}
      words={messages.staffSession}
      adminUrl={adminConsoleUrl}
      replaceUrl={(to) => void navigate({ to, search: {}, replace: true })}
    />
  )
}

export const Route = createFileRoute('/impersonate/enter')({ validateSearch: handoffSearch, component: Enter })

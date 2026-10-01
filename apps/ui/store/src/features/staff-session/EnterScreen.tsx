import { HandoffScreen } from '@dripfunnel/shared/ui'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useCallback } from 'react'
import { adminConsoleUrl, staffSession } from '../../api/staffSession'
import { messages } from '../../messages'

const enterRoute = getRouteApi('/impersonate/enter')
const words = messages.staffSession

export const EnterScreen = () => {
  const { token } = enterRoute.useSearch()
  const navigate = useNavigate()
  const clearUrl = useCallback(() => void navigate({ to: '/impersonate/enter', search: {}, replace: true }), [navigate])
  const onEntered = useCallback(() => void navigate({ to: '/', replace: true }), [navigate])
  return (
    <HandoffScreen
      token={token}
      client={staffSession}
      clearUrl={clearUrl}
      onEntered={onEntered}
      pending={words.pending}
      invalid={words.invalid}
      action={{ label: words.action, href: adminConsoleUrl }}
    />
  )
}

import type { ErrorDetails } from '@dripfunnel/shared/ui'
import { Navigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { isApiError } from '../../api/client'
import { messages } from '../../messages'

const words = messages.states.error

// The stable code behind an error view's "Technical details" (ui/README.md §6): the API's
// code, never its message, which can carry internals.
export const errorDetails = (error: unknown): ErrorDetails => ({
  label: words.detailsLabel,
  codeLabel: words.codeLabel,
  code: isApiError(error) ? error.code : 'UNKNOWN',
  requestIdLabel: words.requestIdLabel,
})

export interface RouteErrorProps {
  error: unknown
  // The screen's own error view, given the details to show behind a click.
  view: (details: ErrorDetails) => ReactNode
  // The screen's permission-denied view, for a record outside the caller's assignment
  // (ui/README.md §5, consoles).
  denied?: ReactNode
}

// Every route maps a loader failure by its code (ui/README.md §3): a session that ended goes
// back to sign-in, a refusal shows the denied view, anything else the screen's error state.
export const RouteError = ({ error, view, denied }: RouteErrorProps) => {
  if (isApiError(error, 'UNAUTHENTICATED')) return <Navigate to="/sign-in" />
  if (denied !== undefined && isApiError(error, 'FORBIDDEN')) return <>{denied}</>
  return <>{view(errorDetails(error))}</>
}

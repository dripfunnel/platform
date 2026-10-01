import { createFileRoute } from '@tanstack/react-router'
import { EnterScreen } from '../features/staff-session/EnterScreen'

// The token is read once and dropped from the URL by the screen (ACCESS.md §8.1).
export const Route = createFileRoute('/impersonate/enter')({
  validateSearch: (search: Record<string, unknown>): { token?: string } =>
    typeof search.token === 'string' && search.token.length <= 4096 ? { token: search.token } : {},
  component: EnterScreen,
})

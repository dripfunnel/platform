import { ErrorState } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/states.css'
import { useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { messages } from '../../messages'
import { RouteError } from '../common/RouteError'
import { AuthLayout } from './AuthLayout'

const words = messages.shell.loadError

// The console couldn't learn who is signed in (ui/README.md §6 "Error"): the designed error with
// Try again, never the thrown error's message, which can carry internals.
export const ShellError = ({ error }: ErrorComponentProps) => {
  const router = useRouter()
  return (
    <RouteError
      error={error}
      view={(details) => (
        <AuthLayout>
          <main className="df-shell-error">
            <ErrorState title={words.title} body={words.body} details={details} retry={{ label: words.retry, onRetry: () => void router.invalidate() }} />
          </main>
        </AuthLayout>
      )}
    />
  )
}

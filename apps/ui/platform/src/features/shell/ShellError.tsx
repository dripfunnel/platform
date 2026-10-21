import { ErrorState } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/states.css'
import { useRouter } from '@tanstack/react-router'
import { messages } from '../../messages'
import { AuthLayout } from './AuthLayout'

const words = messages.shell.loadError

// The console couldn't learn who is signed in or the partner's state (FIRST-RELEASE §2.3 "Load
// error"). Never the thrown error's message, which can carry internals (ErrorState).
export const ShellError = () => {
  const router = useRouter()
  return (
    <AuthLayout>
      <main className="df-shell-error">
        <ErrorState title={words.title} body={words.body} retry={{ label: words.retry, onRetry: () => void router.invalidate() }} />
      </main>
    </AuthLayout>
  )
}

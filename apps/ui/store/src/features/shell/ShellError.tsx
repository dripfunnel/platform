import { ErrorState } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/states.css'
import { useRouter } from '@tanstack/react-router'
import { messages } from '../../messages'

const words = messages.shell.loadError

// The shell couldn't learn who is signed in or the store's state (FIRST-RELEASE §3.3 "Load error").
// Never the thrown error's message, which can carry internals.
export const ShellError = () => {
  const router = useRouter()
  return (
    <main className="df-shell-error">
      <ErrorState title={words.title} body={words.body} retry={{ label: words.retry, onRetry: () => void router.invalidate() }} />
    </main>
  )
}

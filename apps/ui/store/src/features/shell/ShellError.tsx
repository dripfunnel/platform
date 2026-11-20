import { ErrorState } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/states.css'
import { useNavigate, useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { signOut } from '../../api/shell'
import { currentBrand } from '../../brand/current'
import { fill, messages } from '../../messages'
import { AuthFrame } from '../auth/AuthFrame'
import { Foot, Secondary } from '../auth/fields'
import { StoreSuspended } from './loadShell'

const words = messages.shell.loadError

// Why and whom to contact, the partner's support never DripFunnel's (SAAS §4.2), and a way on.
const Suspended = ({ suspended }: { suspended: StoreSuspended }) => {
  const navigate = useNavigate()
  const said = messages.shell.banners.suspended
  const brand = currentBrand()
  const support = brand?.supportEmail ?? brand?.supportUrl ?? null
  const body = fill(said.body, { contact: support ? fill(said.contact, { support }) : said.noContact })
  const chooser = messages.chooseStore
  return (
    <AuthFrame panel="in" title={fill(messages.shell.suspended.title, { store: suspended.store })} sub={body} icon={{ name: 'alert', tone: 'warning' }}>
      {!suspended.inSupport && (
        <>
          {suspended.otherStores && <Secondary onClick={() => void navigate({ to: '/stores' })}>{messages.shell.suspended.switch}</Secondary>}
          <Secondary onClick={() => void navigate({ to: '/stores/new' })}>{chooser.create.action}</Secondary>
          <Foot text={chooser.notYou} link={chooser.signOut} onClick={signOut} />
        </>
      )}
    </AuthFrame>
  )
}

// The shell couldn't learn who is signed in or the store's state (FIRST-RELEASE §3.3 "Load error").
// Never the thrown error's message, which can carry internals.
export const ShellError = ({ error }: ErrorComponentProps) => {
  const router = useRouter()
  if (error instanceof StoreSuspended) return <Suspended suspended={error} />
  return (
    <main className="df-shell-error">
      <ErrorState title={words.title} body={words.body} retry={{ label: words.retry, onRetry: () => void router.invalidate() }} />
    </main>
  )
}

import { LoadingState, useScreenState } from '@dripfunnel/shared/ui'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { confirmEmailChangeOnce, isPassing, isRefusal } from '../../api/auth'
import { harnessEnabled } from '../../harness'
import { messages } from '../../messages'
import { confirmEmailStates } from './authStates'
import { AuthFrame } from './AuthFrame'
import { Primary, Secondary } from './fields'
import { refusalText } from './refusals'

const words = messages.auth.confirmEmail

// The link sent to a new address (FIRST-RELEASE §4 "email changed through a link"): once, for a day;
// ?state= per authStates.ts.
export const ConfirmEmail = ({ token }: { token: string | undefined }) => {
  const navigate = useNavigate()
  const forced = useScreenState(confirmEmailStates, harnessEnabled)
  const [answered, setState] = useState<'pending' | 'done' | 'bad' | { retry: string }>(token ? 'pending' : 'bad')
  const [attempt, setAttempt] = useState(0)
  const state = forced ?? answered
  useEffect(() => {
    if (!token || forced) return
    let current = true
    setState('pending')
    void confirmEmailChangeOnce(token).then((answer) => {
      // A failed request isn't a dead link: it is said as such, and can be tried again.
      if (current) setState(isPassing(answer) && isRefusal(answer) ? { retry: refusalText(answer) } : isRefusal(answer) ? 'bad' : 'done')
    })
    return () => {
      current = false
    }
  }, [token, forced, attempt])
  if (typeof state === 'object')
    return (
      <AuthFrame panel="in" title={words.retryTitle} sub={state.retry} icon={{ name: 'alert', tone: 'warning' }}>
        <Secondary onClick={() => setAttempt((n) => n + 1)}>{words.retry}</Secondary>
      </AuthFrame>
    )
  if (state === 'pending') return <AuthFrame panel="in" title={words.title}><LoadingState label={words.title} /></AuthFrame>
  return (
    <AuthFrame panel="in" title={state === 'done' ? words.doneTitle : words.badTitle} sub={state === 'done' ? words.doneSub : words.badSub} icon={{ name: state === 'done' ? 'ok' : 'alert', tone: state === 'done' ? 'info' : 'warning' }}>
      <form className="df-portal-auth-form" onSubmit={(event) => (event.preventDefault(), void navigate({ to: '/sign-in' }))}>
        <Primary>{words.signIn}</Primary>
      </form>
    </AuthFrame>
  )
}

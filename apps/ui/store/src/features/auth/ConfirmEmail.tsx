import { LoadingState, useScreenState } from '@dripfunnel/shared/ui'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { confirmEmailChangeOnce, isRefusal } from '../../api/auth'
import { harnessEnabled } from '../../harness'
import { messages } from '../../messages'
import { confirmEmailStates } from './authStates'
import { AuthFrame } from './AuthFrame'
import { Primary } from './fields'

const words = messages.auth.confirmEmail

// The link sent to a new address (FIRST-RELEASE §4 "email changed through a link"): once, for a day;
// ?state= per authStates.ts.
export const ConfirmEmail = ({ token }: { token: string | undefined }) => {
  const navigate = useNavigate()
  const forced = useScreenState(confirmEmailStates, harnessEnabled)
  const [answered, setState] = useState<'pending' | 'done' | 'bad'>(token ? 'pending' : 'bad')
  const state = forced ?? answered
  useEffect(() => {
    if (!token || forced) return
    let current = true
    void confirmEmailChangeOnce(token).then((answer) => {
      if (current) setState(isRefusal(answer) ? 'bad' : 'done')
    })
    return () => {
      current = false
    }
  }, [token, forced])
  if (state === 'pending') return <AuthFrame panel="in" title={words.title}><LoadingState label={words.title} /></AuthFrame>
  return (
    <AuthFrame panel="in" title={state === 'done' ? words.doneTitle : words.badTitle} sub={state === 'done' ? words.doneSub : words.badSub} icon={{ name: state === 'done' ? 'ok' : 'alert', tone: state === 'done' ? 'info' : 'warning' }}>
      <form className="df-portal-auth-form" onSubmit={(event) => (event.preventDefault(), void navigate({ to: '/sign-in' }))}>
        <Primary>{words.signIn}</Primary>
      </form>
    </AuthFrame>
  )
}

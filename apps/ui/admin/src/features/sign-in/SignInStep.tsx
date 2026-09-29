import { messages } from '../../messages'
import { CodeForm } from './CodeForm'
import { MicrosoftButton } from './MicrosoftButton'
import './signIn.css'
import { isProblemState, type SignInState } from './signInStates'

const words = messages.signIn

// Microsoft shows this number during a real sign-in; a fixture until #13's endpoint exists.
const approvalNumberFixture = '47'

// Seam: #13 replaces every onChange('signing') with the redirect to Microsoft Entra ID, and
// Microsoft's answer picks the next state. Nothing here calls an API.
export const SignInStep = ({ state, onChange }: { state: SignInState; onChange: (next: SignInState) => void }) => {
  if (isProblemState(state)) {
    return (
      <>
        <p className="df-sign-in-box df-sign-in-box--warning" role="alert">
          {words.states[state].detail}
        </p>
        <MicrosoftButton label={words.tryAgain} onClick={() => onChange('signing')} />
      </>
    )
  }

  switch (state) {
    case 'start':
    case 'expired':
      return <MicrosoftButton label={words.microsoftButton} onClick={() => onChange('signing')} />
    case 'signing':
      return (
        <p className="df-sign-in-box" role="status">
          {words.states.signing.waiting}
        </p>
      )
    case 'approve':
      return (
        <>
          <div className="df-sign-in-box df-approval">
            <p>{words.states.approve.tapNumber}</p>
            <p className="df-approval-number">{approvalNumberFixture}</p>
            <p role="status">{words.states.approve.waiting}</p>
          </div>
          <button type="button" className="df-sign-in-link" onClick={() => onChange('code')}>
            {words.states.approve.useCode}
          </button>
        </>
      )
    case 'code':
      return <CodeForm onVerify={() => onChange('signing')} onSendToPhone={() => onChange('approve')} />
    case 'refused':
      return <MicrosoftButton label={words.states.refused.action} onClick={() => onChange('signing')} />
  }
}

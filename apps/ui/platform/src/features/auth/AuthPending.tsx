import { messages } from '../../messages'
import './auth.css'
import { AuthFrame } from './AuthFrame'

// While the invitation is checked: a skeleton, never a half-filled form (ui/README §6).
export const AuthPending = () => (
  <AuthFrame title={messages.acceptInvite.loading.title} body={messages.acceptInvite.loading.body}>
    <div className="df-skeleton" aria-hidden="true" />
  </AuthFrame>
)

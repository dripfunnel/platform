import { Link } from '@tanstack/react-router'
import type { PartnerState } from '../../api/me'
import { messages } from '../../messages'
import './partner.css'

// The partner-state strip under the header (FIRST-RELEASE.md §2.3): Draft, Awaiting approval
// and Sent back each say what merchants can't do yet and where to go. Nothing while Live.
export const PartnerStrip = ({ state }: { state: PartnerState }) => {
  if (state === 'live') return null
  const words = messages.shell.partnerState[state]
  return (
    <div role="status" className={`df-partner-strip df-partner-strip--${state}`}>
      <p>{words.text}</p>
      <Link to="/dashboard">{words.link}</Link>
    </div>
  )
}

import '@dripfunnel/shared/ui/states.css'
import { useState } from 'react'
import { fill, messages } from '../../messages'
import './onboarding.css'

const words = messages.onboarding.live

// The one-time card after approval (FIRST-RELEASE §4; CONSOLE-DESIGN E4), until dismissed.
export const LiveMoment = ({ product, host }: { product: string; host: string }) => {
  const [shown, setShown] = useState(true)
  if (!shown) return null
  return (
    <section role="status" className="df-onb-card df-onb-card--success">
      <div>
        <strong>{fill(words.title, { product, host })}</strong>
        <span>{fill(words.body, { host })}</span>
      </div>
      <button type="button" className="df-button" onClick={() => setShown(false)}>
        {words.dismiss}
      </button>
    </section>
  )
}

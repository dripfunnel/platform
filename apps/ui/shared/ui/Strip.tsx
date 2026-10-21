import type { ReactNode } from 'react'
import './strip.css'

export type StripTone = 'info' | 'warning' | 'danger' | 'offline'

/** One line under the header: what is true about the account, and the one thing to do about it. */
export const Strip = ({ tone, children, action }: { tone: StripTone; children: ReactNode; action?: ReactNode }) => (
  <div role="status" className={`df-strip df-strip--${tone}`}>
    <p>{children}</p>
    {action}
  </div>
)

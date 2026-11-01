import { SessionEndCard, useHandoff } from '@dripfunnel/shared/ui'
import { useCallback, useEffect, useRef } from 'react'
import { exchangeSupportHandoff } from '../../api/supportSession'
import { messages } from '../../messages'
import { partnerConsoleUrl } from '../../partnerConsole'

const words = messages.supportSession

/** Where the partner console's support link lands (ACCESS.md §8.3, `apps/api/src/saas/support/index.ts`). */
export const supportEnterPath = '/support/enter'

export interface SupportEnterProps {
  token: string | undefined
  /** The app's router, replacing the current entry: this page to drop the token, `/` once in. */
  replaceUrl: (to: typeof supportEnterPath | '/') => void
  exchange?: (token: string) => Promise<boolean>
}

/** The console's support link, used once; the token leaves the address bar before it is exchanged (#1112). */
export const SupportEnter = ({ token, replaceUrl, exchange = exchangeSupportHandoff }: SupportEnterProps) => {
  const replace = useRef(replaceUrl)
  replace.current = replaceUrl
  const clearUrl = useCallback(() => replace.current(supportEnterPath), [])
  const result = useHandoff(token, exchange, clearUrl)
  useEffect(() => {
    if (result === 'entered') replace.current('/')
  }, [result])
  if (result === 'invalid') return <SessionEndCard title={words.invalid.title} body={words.invalid.body} action={{ label: words.action, href: partnerConsoleUrl }} />
  return (
    <p className="df-session-pending" role="status">
      {words.pending}
    </p>
  )
}

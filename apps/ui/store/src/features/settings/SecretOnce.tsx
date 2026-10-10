import { useCallback, useState } from 'react'
import { messages } from '../../messages'

const words = messages.settings.developers

export interface SecretOnceProps {
  title: string
  warning: string
  secret: string
  onStored: () => void
}

/** A secret the API answers once (ACCESS §5.6): shown until the Owner says it's stored, then gone from the page. */
export const SecretOnce = ({ title, warning, secret, onStored }: SecretOnceProps) => {
  const [copy, setCopy] = useState<'copied' | 'failed' | null>(null)
  const copyIt = useCallback(() => {
    void (navigator.clipboard?.writeText(secret) ?? Promise.reject(new Error('no clipboard'))).then(
      () => setCopy('copied'),
      () => setCopy('failed'),
    )
  }, [secret])

  return (
    <section className="df-set-card df-dev-new" aria-label={title}>
      <h3 className="df-dev-h3">{title}</h3>
      <p className="df-set-warning df-dev-warn">{warning}</p>
      <div className="df-dev-secret">
        <code>{secret}</code>
        <button type="button" className="df-button df-button--small" onClick={copyIt}>
          {words.copy}
        </button>
      </div>
      {copy && (
        <p className={copy === 'copied' ? 'df-set-help' : 'df-set-problem'} role="status">
          {copy === 'copied' ? words.copied : words.copyFailed}
        </p>
      )}
      <button type="button" className="df-button df-button--primary df-dev-start" onClick={onStored}>
        {words.keys.stored}
      </button>
    </section>
  )
}

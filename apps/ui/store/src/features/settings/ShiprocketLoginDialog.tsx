import { ConfirmDialog } from '@dripfunnel/shared/ui'
import { useEffect, useId, useState } from 'react'
import type { CourierLogin } from '../../api/shipping'
import { fill, messages } from '../../messages'
import { refusalIn } from '../common/refusal'

const words = messages.settings.shipping
const refusalOf = refusalIn(words.refused)

export interface ShiprocketLoginDialogProps {
  name: string
  /** Connects with the login; a refusal is thrown, and the dialog stays open with what was typed. */
  onConnect: (login: CourierLogin) => Promise<void>
  onCancel: () => void
}

/** Connect Shiprocket (#1489): the store's own API user, checked with Shiprocket before anything is kept. */
export const ShiprocketLoginDialog = ({ name, onConnect, onCancel }: ShiprocketLoginDialogProps) => {
  const id = useId()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // The form is taller than a short window: bring a refusal into view, since it sits under the fields.
  useEffect(() => {
    if (error) document.querySelector('dialog[open] [role="alert"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [error])

  return (
    <ConfirmDialog
      open
      title={fill(words.login.title, { name })}
      target=""
      spaced
      consequence={words.login.body}
      confirmLabel={busy ? words.login.connecting : words.login.confirm}
      cancelLabel={messages.settings.payments.cancel}
      blocked={email.trim() === '' || password === '' ? words.login.missing : null}
      error={error}
      onCancel={onCancel}
      onConfirm={() => {
        setError(null)
        setBusy(true)
        onConnect({ email: email.trim(), password, webhookToken: token.trim() === '' ? null : token.trim() })
          .catch((failure: unknown) => setError(refusalOf(failure)))
          .finally(() => setBusy(false))
      }}
    >
      <p className="df-field-hint">
        <a href={words.login.url} target="_blank" rel="noreferrer">
          {words.login.link}
        </a>
      </p>
      <div className="df-field">
        <label htmlFor={`${id}-email`}>{words.login.email}</label>
        <input id={`${id}-email`} type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="df-field">
        <label htmlFor={`${id}-password`}>{words.login.password}</label>
        <input id={`${id}-password`} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div className="df-field">
        <label htmlFor={`${id}-token`}>{words.login.token}</label>
        <input id={`${id}-token`} type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
        <span className="df-field-hint">{words.login.tokenHint}</span>
      </div>
    </ConfirmDialog>
  )
}

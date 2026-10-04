import { Link } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { enrolSecondFactor, groupedKey, skipSecondFactor, startEnrolment, type AuthCode } from '../../api/auth'
import { messages } from '../../messages'
import './auth.css'
import { AuthFrame } from './AuthFrame'
import { sampleSecret } from './authStates'
import { CodeField } from './CodeField'

const words = messages.acceptInvite.twoFactor

export interface EnrolSecondFactorProps {
  // The partner's Security switch (FIRST-RELEASE §14.4): no Skip when it is on.
  required: boolean
  // "Step 2 of 2" after accepting an invitation; nothing at sign-in.
  step?: string | undefined
  finishLabel: string
  // A ?state= render: the sample key, and no request for a real one.
  sample: boolean
  onDone: () => void
}

const codeWords = (code: AuthCode): string => {
  if (code === 'WRONG_CODE' || code === 'CODE_EXPIRED') return words.wrong
  if (code === 'SECOND_FACTOR_REQUIRED') return words.required
  if (code === 'RATE_LIMITED') return messages.auth.rateLimited
  return messages.auth.notConnected
}

// Set up an authenticator app: the API issues the secret once, then checks a code from it
// (apps/api src/apis/platform/auth.ts `enrol`). The session it belongs to is the cookie's.
export const EnrolSecondFactor = ({ required, step, finishLabel, sample, onDone }: EnrolSecondFactorProps) => {
  const [secret, setSecret] = useState<string | null>(sample ? sampleSecret : null)
  // The enrol session lapsed or never existed: only signing in again starts a new one.
  const [stale, setStale] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The secret couldn't be fetched; Try again asks once more.
  const [unloaded, setUnloaded] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  // One request per attempt: each issues a new secret, and the page must show the one the API kept.
  const issued = useRef<ReturnType<typeof startEnrolment> | null>(null)

  const load = useCallback((isCurrent: () => boolean) => {
    issued.current ??= startEnrolment()
    void issued.current.then((result) => {
      if (!isCurrent()) return
      if (result.ok) return setSecret(result.secret)
      issued.current = null
      if (result.code === 'INVALID_CREDENTIALS') return setStale(true)
      setUnloaded(true)
      setError(codeWords(result.code))
    })
  }, [])

  useEffect(() => {
    if (sample) return
    let current = true
    load(() => current)
    return () => {
      current = false
    }
  }, [sample, load])

  const retry = () => {
    setUnloaded(false)
    setError(null)
    load(() => true)
  }

  const submit = async () => {
    setBusy(true)
    const result = await enrolSecondFactor(code)
    setBusy(false)
    setCode('')
    if (result.ok) return onDone()
    if (result.code === 'INVALID_CREDENTIALS') return setStale(true)
    setError(codeWords(result.code))
  }

  const skip = async () => {
    setBusy(true)
    const result = await skipSecondFactor()
    setBusy(false)
    if (result.ok) return onDone()
    if (result.code === 'INVALID_CREDENTIALS') return setStale(true)
    setError(codeWords(result.code))
  }

  if (stale) {
    return (
      <AuthFrame title={words.title} body={messages.auth.enrolStale}>
        <Link to="/sign-in" className="df-button df-button--primary df-sign-in-submit">
          {messages.auth.goToSignIn}
        </Link>
      </AuthFrame>
    )
  }

  return (
    <AuthFrame title={words.title} body={required ? words.bodyRequired : words.bodyOptional} error={error}>
      {step && <p className="df-auth-step">{step}</p>}
      <div className="df-auth-enrol">
        <div className="df-auth-qr" role="img" aria-label={words.qrLabel}>
          {words.qrPlaceholder}
        </div>
        <div className="df-auth-key">
          <span>{words.keyLabel}</span>
          {secret ? <code>{groupedKey(secret)}</code> : !unloaded && <div className="df-skeleton" aria-hidden="true" />}
        </div>
      </div>
      {unloaded && (
        <button type="button" className="df-button df-sign-in-submit" onClick={retry}>
          {messages.auth.retry}
        </button>
      )}
      <form
        className="df-sign-in-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <CodeField value={code} onChange={setCode} />
        <button type="submit" className="df-button df-button--primary df-sign-in-submit" disabled={busy || !secret || !/^\d{6}$/.test(code)}>
          {finishLabel}
        </button>
        {!required && (
          <button type="button" className="df-sign-in-link" onClick={() => void skip()} disabled={busy}>
            {words.skip}
          </button>
        )}
      </form>
    </AuthFrame>
  )
}

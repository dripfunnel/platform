import { ticketError } from '@dripfunnel/shared/format'
import { reserveTab, type ReservedTab } from '@dripfunnel/shared/ui'
import { useEffect, useId, useRef, useState, type ReactElement } from 'react'
import { endSupportSession, reauthenticate, returnToSupportSession, startSupportSession, type Opened, type Reauth, type SupportSession, type SupportTarget } from '../../api/support'
import { fill, messages } from '../../messages'
import { codeComplete, firstStep, type StartStep } from './startFlow'
import { firstOf, minutesLeft, refusalText, roleText } from './supportText'

const words = messages.support.start

export interface StartSupportDialogProps {
  target: SupportTarget | null
  // The caller's own open session, if any: one at a time (§12.2).
  mine: SupportSession | null
  partner: string
  me: string
  onClose: () => void
  // Something changed on the server (started, ended, refused as stale): the page reads again.
  onChanged: () => void
  onStarted: (name: string, tabBlocked: boolean) => void
}

const reauthText = (r: Extract<Reauth, { ok: false }>): string => {
  if (r.reason === 'WRONG_CODE') return r.triesLeft ? fill(words.reauth.WRONG_CODE, { tries: String(r.triesLeft) }) : words.reauth.WRONG_CODE_LAST
  if (r.reason === 'LOCKED') return fill(words.reauth.LOCKED, { minutes: String(r.lockedMinutes ?? 15) })
  return words.reauth[r.reason]
}

// §12.2: Step 1 · Why, Step 2 · Confirm with the caller's own 2-factor code (ACCESS.md §8), then
// the store's portal in a new tab.
export const StartSupportDialog = ({ target, mine, partner, me, onClose, onChanged, onStarted }: StartSupportDialogProps) => {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const reasonId = useId()
  const reasonHintId = useId()
  const ticketId = useId()
  const ticketHintId = useId()
  const codeId = useId()
  const codeErrorId = useId()
  const [step, setStep] = useState<StartStep | null>(null)
  const [reason, setReason] = useState('')
  const [ticket, setTicket] = useState('')
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  // The open session in the way: from the page, or only its id when the API was first to know.
  const [other, setOther] = useState<{ id: string; session: SupportSession | null } | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (!target) {
      if (dialog.open) dialog.close()
      setStep(null)
      return
    }
    setReason('')
    setTicket('')
    setCode('')
    setCodeError(null)
    setMessage(null)
    setOther(mine && { id: mine.id, session: mine })
    setStep(firstStep(target, mine))
    if (!dialog.open) dialog.showModal()
    // Only a new target restarts the flow: the page reading again mid-flow must not reset it.
  }, [target])

  useEffect(() => {
    bodyRef.current?.querySelector<HTMLElement>('input, textarea, button.df-button--primary, button')?.focus()
  }, [step])

  if (!target) return <dialog ref={dialogRef} className="df-dialog df-support-start" />

  const first = firstOf(target.name)
  const reasonMissing = reason.trim() === ''
  const badTicket = ticketError(ticket)

  const fail = (text: string, tab?: ReservedTab) => {
    tab?.close()
    setMessage(text)
    setStep('msg')
  }

  const opened = (result: Opened, tab: ReservedTab) => {
    if (result.ok) {
      tab.go(result.link)
      onChanged()
      onStarted(target.name, tab.blocked)
      return onClose()
    }
    tab.close()
    onChanged()
    if (result.reason === 'SUPPORT_SESSION_ALREADY_OPEN') {
      // The API's answer names the session in the way; the page's copy may be one already ended.
      const id = result.sessionId ?? mine?.id ?? null
      setOther(id ? { id, session: mine?.id === id ? mine : null } : null)
      return setStep('busy')
    }
    if (result.reason === 'REAUTH_REQUIRED') {
      setCode('')
      setCodeError(refusalText(result.reason))
      return setStep('confirm')
    }
    fail(refusalText(result.reason, target))
  }

  const start = () => {
    if (!codeComplete(code)) return setCodeError(words.codeMissing)
    const tab = reserveTab()
    setStep('starting')
    reauthenticate(code)
      .then((proof) => {
        if (!proof.ok) {
          tab.close()
          setCode('')
          setCodeError(reauthText(proof))
          return setStep('confirm')
        }
        return startSupportSession({ membershipId: target.membershipId, reason: reason.trim(), ticket: ticket.trim() === '' ? null : ticket.trim(), proof: proof.proof }).then((result) => opened(result, tab))
      })
      .catch(() => fail(messages.support.toasts.failed, tab))
  }

  const returnTo = () => {
    if (!target.mySessionId) return
    const tab = reserveTab()
    returnToSupportSession(target.mySessionId)
      .then((result) => opened(result, tab))
      .catch(() => fail(messages.support.toasts.failed, tab))
  }

  const endOther = () => {
    if (!other) return
    endSupportSession(other.id)
      .then((result) => {
        onChanged()
        if (!result.ok && result.reason !== 'SESSION_ENDED' && result.reason !== 'SESSION_EXPIRED') return fail(refusalText(result.reason))
        setOther(null)
        setStep('why')
      })
      .catch(() => fail(messages.support.toasts.failed))
  }

  const values = { first, name: target.name }
  const title =
    step === null || step === 'starting'
      ? fill(words.titles.confirm, values)
      : fill(words.titles[step], values)
  const counter = step === 'why' || step === 'confirm' ? fill(words.step, { step: step === 'why' ? '1' : '2', name: words.stepNames[step] }) : null

  const actions = (...buttons: ReactElement[]) => <div className="df-actions">{buttons}</div>
  const cancel = (
    <button key="cancel" type="button" className="df-button" onClick={onClose}>
      {words.cancel}
    </button>
  )

  return (
    <dialog
      ref={dialogRef}
      className="df-dialog df-support-start"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        if (step !== 'starting') onClose()
      }}
    >
      <p className="df-eyebrow">{fill(words.label, { name: target.name })}</p>
      {counter && <p className="df-support-step">{counter}</p>}
      <h2 id={titleId}>{title}</h2>
      <div ref={bodyRef} className="df-support-body">
        {step === 'blocked' && !target.start.allowed && (
          <>
            <p>{refusalText(target.start.reason, target)}</p>
            {actions(
              <button key="close" type="button" className="df-button" onClick={onClose}>
                {words.close}
              </button>,
            )}
          </>
        )}
        {step === 'busy' && (
          <>
            <p>{other?.session ? fill(words.busy, { other: other.session.user.name, minutes: String(minutesLeft(other.session.expiresAt, Date.now())) }) : words.busyUnknown}</p>
            {actions(
              cancel,
              <button key="end" type="button" className="df-button df-button--danger" disabled={!other} onClick={endOther}>
                {words.endAndContinue}
              </button>,
            )}
          </>
        )}
        {step === 'return' && (
          <>
            <p>{fill(words.returnBody, values)}</p>
            {actions(
              cancel,
              <button key="return" type="button" className="df-button df-button--primary" onClick={returnTo}>
                {words.returnTo}
              </button>,
            )}
          </>
        )}
        {step === 'why' && (
          <>
            <div className="df-field">
              <label htmlFor={reasonId}>{words.reason}</label>
              <textarea
                id={reasonId}
                rows={3}
                required
                maxLength={500}
                placeholder={words.reasonHint}
                aria-describedby={reasonMissing ? reasonHintId : undefined}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              {reasonMissing && (
                <p id={reasonHintId} className="df-field-hint">
                  {words.reasonMissing}
                </p>
              )}
            </div>
            <div className="df-field">
              <label htmlFor={ticketId}>{words.ticket}</label>
              <input
                id={ticketId}
                type="url"
                maxLength={500}
                placeholder={words.ticketHint}
                aria-invalid={badTicket}
                aria-describedby={badTicket ? ticketHintId : undefined}
                value={ticket}
                onChange={(event) => setTicket(event.target.value)}
              />
              {badTicket && (
                <p id={ticketHintId} className="df-field-hint">
                  {words.ticketBad}
                </p>
              )}
            </div>
            {actions(
              cancel,
              <button key="next" type="button" className="df-button df-button--primary" disabled={reasonMissing || badTicket} onClick={() => setStep('confirm')}>
                {words.next}
              </button>,
            )}
          </>
        )}
        {(step === 'confirm' || step === 'starting') && (
          <form
            className="df-support-body"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              if (step === 'confirm') start()
            }}
          >
            <p>
              {fill(words.confirm, { name: target.name, first, role: roleText(target), store: target.store.name, partner: firstOf(partner), me: firstOf(me) })}
            </p>
            <dl className="df-support-summary">
              <div>
                <dt>{words.reasonLabel}</dt>
                <dd>{reason.trim()}</dd>
              </div>
              <div>
                <dt>{words.ticketLabel}</dt>
                <dd>{ticket.trim() || words.noTicket}</dd>
              </div>
            </dl>
            <div className="df-field">
              <label htmlFor={codeId}>{words.code}</label>
              <input
                id={codeId}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder={words.codeHint}
                maxLength={6}
                aria-invalid={codeError !== null}
                aria-describedby={codeError ? codeErrorId : undefined}
                value={code}
                disabled={step === 'starting'}
                onChange={(event) => {
                  setCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                  setCodeError(null)
                }}
              />
              {codeError && (
                <p id={codeErrorId} role="alert" className="df-field-error">
                  {codeError}
                </p>
              )}
            </div>
            {actions(
              <button key="back" type="button" className="df-button" disabled={step === 'starting'} onClick={() => setStep('why')}>
                {words.back}
              </button>,
              <button key="go" type="submit" className="df-button df-button--primary" disabled={step === 'starting'}>
                {step === 'starting' ? words.starting : words.submit}
              </button>,
            )}
          </form>
        )}
        {step === 'msg' && message && (
          <>
            <p role="alert">{message}</p>
            {actions(
              <button key="close" type="button" className="df-button" onClick={onClose}>
                {words.close}
              </button>,
            )}
          </>
        )}
      </div>
    </dialog>
  )
}

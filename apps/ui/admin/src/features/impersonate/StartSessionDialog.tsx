import { useEffect, useId, useRef, useState, type ReactElement } from 'react'
import {
  endSession,
  loadMySessions,
  returnToSession,
  startImpersonation,
  startSetupSession,
  type Reauth,
  type StaffSession,
  type StartResult,
} from '../../api/impersonation'
import { fill, messages } from '../../messages'
import type { StaffRole } from '../shell/staffRoles'
import { reservePortalTab, type PortalTab } from './openPortal'
import { sessionsChanged } from './sessionEvents'
import { firstOf, membershipLine, placeText, refusalText, roleText, timeLeftText, whereText } from './sessionText'
import { afterBusy, countedSteps, firstStep, membershipOf, openOfKind, startWithReauth, ticketError, type StartStep, type StartSubject } from './startFlow'
import '@dripfunnel/shared/ui/states.css'
import './impersonate.css'

const words = messages.impersonate.start

export interface StartSessionDialogProps {
  subject: StartSubject | null
  caller: StaffRole
  meName: string
  // ?state=reauthFailed or reauthCancelled: the sign-in's answer, for checking those messages.
  simulate: Reauth | null
  onClose: () => void
  onStarted: (session: StaffSession, tabBlocked: boolean) => void
}

const subjectName = (subject: StartSubject) => (subject.kind === 'impersonation' ? subject.target.name : subject.partner.name)

// The multi-step start for both kinds (ACCESS.md §8.1, §8.2): a reason and a fresh sign-in
// every time, which the prototype draws for impersonation only (designs/design.md §8).
export const StartSessionDialog = ({ subject, caller, meName, simulate, onClose, onStarted }: StartSessionDialogProps) => {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const reasonId = useId()
  const reasonHintId = useId()
  const ticketId = useId()
  const ticketHintId = useId()
  const [step, setStep] = useState<StartStep | null>(null)
  const [mine, setMine] = useState<readonly StaffSession[]>([])
  const [membershipId, setMembershipId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [ticket, setTicket] = useState('')
  const [message, setMessage] = useState<{ text: string; retry: boolean } | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (!subject) {
      if (dialog.open) dialog.close()
      setStep(null)
      return
    }
    setReason('')
    setTicket('')
    setMessage(null)
    setMembershipId(membershipOf(subject))
    setStep(null)
    if (!dialog.open) dialog.showModal()
    let current = true
    loadMySessions()
      .then((sessions) => {
        if (!current) return
        setMine(sessions)
        setStep(firstStep(subject, sessions))
      })
      .catch(() => current && setStep('why'))
    return () => {
      current = false
    }
  }, [subject, caller])

  useEffect(() => {
    bodyRef.current?.querySelector<HTMLElement>('input, textarea, button.df-button--primary, button')?.focus()
  }, [step])

  if (!subject) return <dialog ref={dialogRef} className="df-dialog df-start" />

  const name = subjectName(subject)
  const first = firstOf(name)
  const membership = subject.kind === 'impersonation' ? (subject.target.memberships.find((candidate) => candidate.id === membershipId) ?? null) : null
  const counted = countedSteps(subject, subject.kind === 'impersonation' && subject.membershipId !== null)
  const other = openOfKind(mine, subject.kind)
  const now = Date.now()

  const fail = (text: string, retry: boolean, tab?: PortalTab) => {
    tab?.close()
    setMessage({ text, retry })
    setStep('msg')
  }

  const finish = (result: StartResult, tab: PortalTab) => {
    if (!result.ok) return fail(refusalText(result.reason, subject.kind === 'impersonation' ? subject.target : undefined), result.reason === 'REAUTH_REQUIRED', tab)
    tab.go(result.handoff)
    sessionsChanged()
    onStarted(result.session, tab.blocked)
    onClose()
  }

  const confirm = () => {
    const tab = reservePortalTab()
    const cleanTicket = ticket.trim() === '' ? null : ticket.trim()
    const start = (): Promise<StartResult> =>
      subject.kind === 'impersonation' && membershipId
        ? startImpersonation(subject.target.id, membershipId, reason, cleanTicket)
        : subject.kind === 'setup'
          ? startSetupSession(subject.partner, reason, cleanTicket, meName)
          : Promise.resolve({ ok: false, reason: 'NOT_FOUND' })
    // The harness's sign-in answer stands in for the API asking for one (?state=reauthFailed).
    const asked = simulate ? (): Promise<StartResult> => Promise.resolve({ ok: false, reason: 'REAUTH_REQUIRED' }) : start
    setStep('reauth')
    startWithReauth(asked, () => (simulate ? Promise.resolve(simulate) : tab.reauthenticate()), tab.blocked && !simulate)
      .then((outcome) => {
        if (outcome.kind === 'done') return finish(outcome.result, tab)
        fail(outcome.outcome === 'blocked' ? words.reauthBlocked : outcome.outcome === 'failed' ? words.reauthFailed : words.reauthCancelled, true, tab)
      })
      .catch(() => fail(messages.impersonate.toasts.failed, true, tab))
  }

  const returnTo = (id: string) => {
    const tab = reservePortalTab()
    returnToSession(id)
      .then((result) => finish(result, tab))
      .catch(() => fail(messages.impersonate.toasts.failed, false, tab))
  }

  const endOther = () => {
    if (!other) return
    endSession(other.id)
      .then((result) => {
        if (!result.ok) return fail(refusalText(result.reason), false)
        sessionsChanged()
        setMine((sessions) => sessions.filter((session) => session.id !== other.id))
        setStep(subject.kind === 'setup' ? 'why' : afterBusy({ ...subject, membershipId }))
      })
      .catch(() => fail(messages.impersonate.toasts.failed, false))
  }

  const titles = words.titles
  const title = (() => {
    const values = { first, name, partner: name }
    switch (step) {
      case 'blocked':
        return fill(subject.kind === 'setup' ? titles.blockedSetup : titles.blocked, values)
      case 'busy':
        return subject.kind === 'setup' ? titles.busySetup : titles.busy
      case 'return':
        return fill(subject.kind === 'setup' ? titles.returnSetup : titles.return, values)
      case 'where':
        return titles.where
      case 'why':
        return fill(subject.kind === 'setup' ? titles.whySetup : titles.why, values)
      case 'confirm':
        return fill(subject.kind === 'setup' ? titles.confirmSetup : titles.confirm, values)
      case 'reauth':
        return titles.reauth
      case 'msg':
        return titles.msg
      case null:
        return fill(subject.kind === 'setup' ? words.labelSetup : words.label, values)
    }
  })()

  const counter = step === 'where' || step === 'why' || step === 'confirm' ? fill(words.step, { step: String(counted.indexOf(step) + 1), total: String(counted.length), name: words.stepNames[step] }) : null
  const reasonMissing = reason.trim() === ''
  const badTicket = ticketError(ticket)

  const confirmText =
    subject.kind === 'setup'
      ? fill(words.confirmSetup, { partner: name })
      : membership
        ? fill(words.confirm, {
            name,
            first,
            role: roleText(membership),
            where: whereText(membership),
            owner: words.owners[membership.level],
            place: placeText(membership),
            me: firstOf(meName),
          })
        : ''

  const actions = (...buttons: (ReactElement | false)[]) => <div className="df-actions">{buttons}</div>
  const cancel = (
    <button key="cancel" type="button" className="df-button" onClick={onClose}>
      {words.cancel}
    </button>
  )

  return (
    <dialog
      ref={dialogRef}
      className="df-dialog df-start"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        if (step !== 'reauth') onClose()
      }}
    >
      <p className="df-eyebrow">{fill(subject.kind === 'setup' ? words.labelSetup : words.label, { name, partner: name })}</p>
      {counter && <p className="df-start-step">{counter}</p>}
      <h2 id={titleId}>{title}</h2>
      <div ref={bodyRef} className="df-start-body">
        {step === 'blocked' && subject.kind === 'impersonation' && !subject.target.impersonate.allowed && (
          <>
            <p>{refusalText(subject.target.impersonate.reason, subject.target)}</p>
            {actions(
              <button key="close" type="button" className="df-button" onClick={onClose}>
                {words.close}
              </button>,
            )}
          </>
        )}
        {step === 'busy' && other && (
          <>
            <p>
              {subject.kind === 'setup'
                ? fill(words.busySetup, { partner: other.partner.name, time: timeLeftText(other.expiresAt, now) })
                : fill(words.busy, { other: other.target?.name ?? '', time: timeLeftText(other.expiresAt, now) })}
            </p>
            {actions(
              cancel,
              <button key="return" type="button" className="df-button" onClick={() => returnTo(other.id)}>
                {words.returnToIt}
              </button>,
              <button key="end" type="button" className="df-button df-button--primary" onClick={endOther}>
                {words.endAndContinue}
              </button>,
            )}
          </>
        )}
        {step === 'return' && (
          <>
            <p>{words.returnBody}</p>
            {actions(
              cancel,
              <button
                key="return"
                type="button"
                className="df-button df-button--primary"
                onClick={() => {
                  const id = subject.kind === 'impersonation' ? subject.target.openSession : openOfKind(mine, 'setup')?.id
                  if (id) returnTo(id)
                }}
              >
                {words.returnTab}
              </button>,
            )}
          </>
        )}
        {step === 'where' && subject.kind === 'impersonation' && (
          <>
            <fieldset className="df-start-where">
              <legend className="df-visually-hidden">{words.whereLegend}</legend>
              {subject.target.memberships.map((candidate) => (
                <label key={candidate.id} className="df-start-option">
                  <input type="radio" name="where" value={candidate.id} checked={membershipId === candidate.id} onChange={() => setMembershipId(candidate.id)} />
                  {membershipLine(candidate)}
                </label>
              ))}
            </fieldset>
            {!membershipId && <p className="df-field-hint">{words.whereHint}</p>}
            {actions(
              cancel,
              <button key="next" type="button" className="df-button df-button--primary" disabled={!membershipId} onClick={() => setStep('why')}>
                {words.next}
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
                placeholder={subject.kind === 'setup' ? words.reasonPlaceholderSetup : words.reasonPlaceholder}
                aria-describedby={reasonMissing ? reasonHintId : undefined}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              {reasonMissing && (
                <p id={reasonHintId} className="df-field-hint">
                  {words.reasonHint}
                </p>
              )}
            </div>
            <div className="df-field">
              <label htmlFor={ticketId}>{words.ticket}</label>
              <input
                id={ticketId}
                type="url"
                maxLength={300}
                placeholder={words.ticketPlaceholder}
                aria-invalid={badTicket}
                aria-describedby={badTicket ? ticketHintId : undefined}
                value={ticket}
                onChange={(event) => setTicket(event.target.value)}
              />
              {badTicket && (
                <p id={ticketHintId} className="df-field-hint">
                  {words.ticketError}
                </p>
              )}
            </div>
            {actions(
              counted.includes('where') && (
                <button key="back" type="button" className="df-button" onClick={() => setStep('where')}>
                  {words.back}
                </button>
              ),
              cancel,
              <button key="next" type="button" className="df-button df-button--primary" disabled={reasonMissing || badTicket} onClick={() => setStep('confirm')}>
                {words.next}
              </button>,
            )}
          </>
        )}
        {step === 'confirm' && (
          <>
            <p>{confirmText}</p>
            <dl className="df-start-summary">
              <div>
                <dt>{words.summaryReason}</dt>
                <dd>{reason.trim()}</dd>
              </div>
              <div>
                <dt>{words.summaryTicket}</dt>
                <dd>{ticket.trim() || words.noTicket}</dd>
              </div>
            </dl>
            {actions(
              <button key="back" type="button" className="df-button" onClick={() => setStep('why')}>
                {words.back}
              </button>,
              cancel,
              <button key="go" type="button" className="df-button df-button--primary" onClick={confirm}>
                {words.confirmReauth}
              </button>,
            )}
          </>
        )}
        {step === 'reauth' && (
          <p className="df-start-waiting" role="status">
            {words.reauthWaiting}
          </p>
        )}
        {step === 'msg' && message && (
          <>
            <p role="alert">{message.text}</p>
            {actions(
              <button key="close" type="button" className="df-button" onClick={onClose}>
                {words.close}
              </button>,
              message.retry && (
                <button key="retry" type="button" className="df-button df-button--primary" onClick={() => setStep('confirm')}>
                  {words.tryAgain}
                </button>
              ),
            )}
          </>
        )}
      </div>
    </dialog>
  )
}

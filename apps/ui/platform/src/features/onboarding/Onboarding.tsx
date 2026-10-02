// States: draft (the checklist), awaiting (what happens next), sentback (DripFunnel's reason).
// Harness: ?partner= picks the state (api/me.ts), ?setup=dripfunnel shows a partner set up by staff.
import { ConfirmDialog } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/shell.css'
import '@dripfunnel/shared/ui/states.css'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import type { Me } from '../../api/me'
import { checksLeft, failingCheck, partnerOnlyItems, runTestSignup, submitForApproval, type Onboarding as OnboardingData, type OnboardingRefusal } from '../../api/onboarding'
import { fill, formatDate, formatWait, messages } from '../../messages'
import { Checklist } from './Checklist'
import './onboarding.css'

const words = messages.onboarding

export interface OnboardingProps {
  me: Me
  onboarding: OnboardingData
  staffSetup: boolean
  // The Owner's first sign-in after staff set things up (FIRST-RELEASE §4 "Who completed it").
  welcome: boolean
}

const refusalWords = (refusal: OnboardingRefusal): string =>
  refusal.code === 'GO_LIVE_CHECK_FAILED' && refusal.check
    ? fill(words.refused.GO_LIVE_CHECK_FAILED, { check: words.checks[refusal.check] })
    : words.refused[refusal.code]

const firstName = (name: string) => name.split(' ')[0] ?? name

export const Onboarding = ({ me, onboarding: initial, staffSetup, welcome }: OnboardingProps) => {
  const [onboarding, setOnboarding] = useState(initial)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [testOutcome, setTestOutcome] = useState<{ error: string | null; done: string | null }>({ error: null, done: null })
  const [welcomeShown, setWelcomeShown] = useState(welcome)
  const state = onboarding.state
  const canSubmit = me.role === 'partner-owner' || me.role === 'partner-admin'
  const left = checksLeft(onboarding)
  // Submit is the eleventh step and counts once the partner has submitted.
  const done = onboarding.items.filter((x) => x.status === 'done').length + (state === 'awaiting' || state === 'live' ? 1 : 0)
  const total = onboarding.items.length + 1
  const yours = onboarding.items.filter((x) => partnerOnlyItems.includes(x.key) && x.status !== 'done')

  const submit = async () => {
    setBusy(true)
    const result = await submitForApproval(me.role, onboarding)
    setBusy(false)
    setConfirming(false)
    if (!result.ok) return setRefusal(refusalWords(result))
    setRefusal(null)
    setOnboarding({ ...onboarding, state: 'awaiting', submittedAt: result.submittedAt, submittedBy: staffSetup ? 'DripFunnel' : 'partner', sentBackReason: null, fixes: [] })
  }

  const runTest = async () => {
    setBusy(true)
    const result = await runTestSignup(me.role)
    setBusy(false)
    if (!result.ok) return setTestOutcome({ error: refusalWords(result), done: null })
    setTestOutcome({ error: null, done: fill(words.testDone, { seconds: formatWait(result.seconds) }) })
    setOnboarding({ ...onboarding, items: onboarding.items.map((x) => (x.key === 'testSignup' ? { ...x, status: 'done', detail: words.items.testSignup.doneDetail, doneBy: staffSetup ? 'DripFunnel' : firstName(me.name) } : x)) })
  }

  const submitWhy = !canSubmit
    ? words.refused.OWNERS_AND_ADMINS_ONLY
    : left > 0
      ? fill(words.finishFirst, { count: String(left), items: left === 1 ? words.itemOne : words.itemMany })
      : null
  const title = state === 'awaiting' ? words.awaiting.title : state === 'sentback' ? words.sentBack.title : fill(words.draft.title, { product: me.partner.product })
  const lede =
    state === 'draft'
      ? words.draft.lede
      : state === 'awaiting'
        ? fill(onboarding.submittedBy === 'DripFunnel' ? words.awaiting.submittedByDripFunnel : words.awaiting.submitted, { date: onboarding.submittedAt ? formatDate(onboarding.submittedAt) : '' })
        : words.sentBack.lede

  return (
    <div className="df-page df-onboarding">
      <h1 className="df-page-title">{title}</h1>
      <p className="df-page-lede">{lede}</p>

      {welcomeShown && !staffSetup && me.role === 'partner-owner' && state !== 'sentback' && (
        <section role="status" className="df-onb-card df-onb-card--info">
          <div>
            <strong>{fill(words.welcome.title, { name: firstName(me.name) })}</strong>
            <span>{fill(state === 'awaiting' ? words.welcome.bodySubmitted : words.welcome.body, { product: me.partner.product })}</span>
            <span>
              {left > 0 ? fill(left === 1 ? words.welcome.leftOne : words.welcome.left, { count: String(left) }) : ''}
              {yours.length > 0 ? ' ' + fill(words.welcome.yours, { items: yours.map((x) => words.items[x.key].label.toLowerCase()).join(words.and) }) : ''}
            </span>
          </div>
          <button type="button" className="df-button" onClick={() => setWelcomeShown(false)}>
            {words.welcome.dismiss}
          </button>
        </section>
      )}

      {state === 'sentback' && (
        <section role="alert" className="df-onb-card df-onb-card--danger">
          <strong>{words.sentBack.reason}</strong>
          <p>{onboarding.sentBackReason}</p>
          <ul className="df-onb-fixes">
            {onboarding.fixes.map((fix) => (
              <li key={fix.label}>
                <Link to={fix.to}>{fix.label}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {state === 'awaiting' && (
        <section className="df-onb-card" aria-labelledby="onb-next">
          <h2 id="onb-next">{words.awaiting.nextTitle}</h2>
          <ol className="df-onb-next">
            {words.awaiting.next.map((step, i) => (
              <li key={step.title}>
                <span className="df-checklist-n" aria-hidden="true">
                  {i + 1}
                </span>
                <div>
                  <strong>{step.title}</strong>
                  <span>{step.body}</span>
                </div>
              </li>
            ))}
          </ol>
          <p className="df-onb-note">{words.awaiting.note}</p>
        </section>
      )}

      <section className="df-onb-card" aria-labelledby="onb-checklist">
        <div className="df-onb-head">
          <h2 id="onb-checklist">{words.checklistTitle}</h2>
          <span>{fill(words.progress, { done: String(done), total: String(total) })}</span>
        </div>
        <div className="df-onb-bar" aria-hidden="true">
          <div style={{ width: `${Math.round((done / total) * 100)}%` }} />
        </div>
        <Checklist
          items={onboarding.items}
          role={me.role}
          partner={me.partner.name}
          staffSetup={staffSetup}
          testSignup={{ run: () => void runTest(), busy, cannot: canSubmit ? null : words.refused.OWNERS_AND_ADMINS_ONLY, error: testOutcome.error, done: testOutcome.done }}
        />
        {state !== 'awaiting' && (
          <div className="df-checklist-row df-checklist-row--submit">
            <span className="df-checklist-n" aria-hidden="true">
              {total}
            </span>
            <div className="df-checklist-body">
              <strong>{state === 'sentback' ? words.submitAgain : words.submit}</strong>
              <span className="df-checklist-detail">{words.submitDetail}</span>
            </div>
            <div className="df-checklist-action">
              <button type="button" className="df-button df-button--primary" disabled={submitWhy !== null || busy} aria-describedby={(submitWhy ?? refusal) ? 'submit-why' : undefined} onClick={() => setConfirming(true)}>
                {state === 'sentback' ? words.submitAgain : words.submit}
              </button>
              {(submitWhy ?? refusal) && (
                <span id="submit-why" className="df-checklist-why" role={refusal ? 'alert' : undefined}>
                  {submitWhy ?? refusal}
                </span>
              )}
            </div>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={confirming}
        title={words.confirm.title}
        target={me.partner.product}
        consequence={words.confirm.consequence}
        notes={failingCheck(onboarding) ? [] : [words.confirm.note]}
        confirmLabel={words.submit}
        cancelLabel={words.confirm.cancel}
        onConfirm={() => void submit()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}

import { minorOf, moneyText as fieldText } from '@dripfunnel/shared/format'
import { isApiError } from '@dripfunnel/shared/graphql'
import { ConfirmDialog, ErrorState, LoadingState } from '@dripfunnel/shared/ui'
import { Link, useBlocker } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { loadReminderSettings, reminderDelays, reminderPercents, reminderText, saveReminderSettings, sendTestReminder, type ReminderSettings, type ReminderStep } from '../../api/carts'
import { loadOfferFacts } from '../../api/offers'
import { fill, messages } from '../../messages'
import { cartRefusal } from './cartActions'
import { consentNoteOf, type CartAccess } from './cartView'

// The Reminders tab (designs/Carts.dc.html, Reminders; FIRST-RELEASE §9): up to three reminders, who gets reminded, a
// preview of the chosen one and "Send me a test", saved as one at the revision read.

const words = messages.carts.reminders

interface Form {
  enabled: boolean
  minimum: string
  skipOutOfStock: boolean
  quietHours: boolean
  weeklyCap: boolean
  steps: ReminderStep[]
}

type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; settings: ReminderSettings; currency: string; country: string | null }

const formOf = (s: ReminderSettings): Form => ({
  enabled: s.enabled,
  minimum: s.minimum ? fieldText({ amount: Number(s.minimum.amount), currency: s.minimum.currency }) : '',
  skipOutOfStock: s.skipOutOfStock,
  quietHours: s.quietHours,
  weeklyCap: s.weeklyCap,
  steps: [...s.steps].sort((a, b) => a.position - b.position).map((x) => ({ ...x })),
})

/**
 * Each step's problem, as the API would refuse it: later than the one before, and a subject for an email (#321). A step
 * locked below the plan's automatic is drawn without its fields, so it is sent back as read and never blocks a save.
 */
const stepErrors = (steps: readonly ReminderStep[], automatic: boolean): (string | null)[] =>
  steps.map((x, i) => {
    if (!x.enabled || (!automatic && i > 0)) return null
    const before = steps.slice(0, i).filter((y, j) => y.enabled && (automatic || j === 0)).pop()
    if (before && x.delayMinutes <= before.delayMinutes) return words.errors.later
    if (x.channel === 'email' && !x.subject.trim()) return words.errors.subject
    if (x.subject.trim().length > reminderText.subject || x.body.trim().length > reminderText.body) return fill(words.errors.long, { subject: String(reminderText.subject), body: String(reminderText.body) })
    return null
  })

export const RemindersPane = ({ access, forced, sample, storeName, email }: { access: CartAccess; forced: 'loading' | 'error' | null; sample: ReminderSettings | null; storeName: string; email: string }) => {
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [form, setForm] = useState<Form | null>(null)
  const [orig, setOrig] = useState('')
  const [shown, setShown] = useState(0)
  const [problem, setProblem] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [tested, setTested] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [sending, setSending] = useState(false)
  const [testError, setTestError] = useState<string | null>(null)
  const latest = useRef(0)

  const load = useCallback(() => {
    const mine = ++latest.current
    const ready = (settings: ReminderSettings, currency: string, country: string | null) => {
      const f = formOf(settings)
      setForm(f)
      setOrig(JSON.stringify(f))
      setView({ kind: 'ready', settings, currency, country })
    }
    if (forced === 'loading') return setView({ kind: 'loading' })
    if (forced === 'error') return setView({ kind: 'error' })
    if (sample) return ready(sample, 'INR', 'IN')
    setView({ kind: 'loading' })
    void Promise.all([loadReminderSettings(), loadOfferFacts()]).then(
      ([settings, facts]) => {
        if (mine !== latest.current) return
        if (!settings) return setView({ kind: 'error' })
        ready(settings, settings.minimum?.currency ?? facts.main, facts.country)
      },
      () => mine === latest.current && setView({ kind: 'error' }),
    )
  }, [forced, sample])
  useEffect(load, [load])

  const dirty = form !== null && JSON.stringify(form) !== orig
  useBlocker({ shouldBlockFn: () => dirty && !window.confirm(words.leave), enableBeforeUnload: () => dirty })

  if (view.kind === 'error') return <ErrorState title={words.error} body={messages.carts.error.body} retry={{ label: messages.carts.error.retry, onRetry: load }} />
  if (view.kind === 'loading' || !form) return <LoadingState label={words.loading} />

  const { settings, currency, country } = view
  const level = settings.level
  const automatic = level === 'automatic'
  const ro = !access.canEdit
  const errors = stepErrors(form.steps, automatic)
  const minimumMinor = form.minimum.trim() ? minorOf(form.minimum, currency) : null
  const minimumBad = minimumMinor === 'invalid' || minimumMinor === 0
  const set = (patch: Partial<Form>) => {
    setSaved(null)
    setForm({ ...form, ...patch })
  }
  const setStep = (i: number, patch: Partial<ReminderStep>) => set({ steps: form.steps.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
  const delayText = (m: number) => words.delays[String(m) as keyof typeof words.delays] ?? String(m)
  const channelText = (c: string) => (c === 'whatsapp' ? words.whatsapp : words.email)
  // A step past the first, a code and WhatsApp need the plan's automatic (Pricing; #321).
  const lockedStep = (i: number) => !automatic && i > 0

  const save = () => {
    const bad = errors.findIndex(Boolean)
    if (bad >= 0) return setShown(bad)
    if (minimumBad) return
    if (sample) {
      setOrig(JSON.stringify(form))
      return setSaved(words.saved)
    }
    setSaving(true)
    setProblem(null)
    const input = {
      enabled: form.enabled,
      minimum: typeof minimumMinor === 'number' ? { amount: String(minimumMinor), currency } : null,
      skipOutOfStock: form.skipOutOfStock,
      quietHours: form.quietHours,
      weeklyCap: form.weeklyCap,
      steps: form.steps.map((x) => ({ ...x, subject: x.subject.trim(), body: x.body.trim() })),
    }
    void saveReminderSettings(input, settings.revision)
      .then((revision) => {
        setOrig(JSON.stringify(form))
        setView({ ...view, settings: { ...settings, ...input, revision } })
        setSaved(form.enabled && automatic ? words.savedTimings : words.saved)
      })
      .catch((error: unknown) => (isApiError(error, 'STALE_REVISION') ? setStale(true) : setProblem(cartRefusal(error, access.canUpgrade))))
      .finally(() => setSaving(false))
  }

  const step = form.steps[shown] ?? form.steps[0]
  const code = step && automatic && step.discountPercent ? step.discountPercent : null
  const consent = words.consent[consentNoteOf(country)]
  // A test sends the saved reminder as the plan would, so an unsaved, locked or switched-off one has nothing to send.
  const testBlock = dirty ? words.testSaveFirst : lockedStep(shown) ? words.testLocked : step && !step.enabled ? words.testOff : null

  return (
    <div className="df-reminders">
      <div className="df-reminders-form">
        <section className="df-cart-card df-reminders-auto">
          <span className="df-carts-cell">
            <strong>{words.auto}</strong>
            <span className="df-carts-sub">{level === 'youSend' ? words.autoYouSend : form.enabled ? (automatic ? words.autoOn : words.autoOne) : words.autoOff}</span>
          </span>
          {level === 'youSend' ? (
            access.canUpgrade ? (
              <Link className="df-button" to="/billing">
                {words.seePlans}
              </Link>
            ) : (
              <span className="df-carts-sub">{words.askOwner}</span>
            )
          ) : (
            <button type="button" role="switch" className="df-reminders-switch" aria-checked={form.enabled} aria-label={words.auto} disabled={ro} onClick={() => set({ enabled: !form.enabled })}>
              <span />
            </button>
          )}
        </section>

        {form.steps.map((x, i) => {
          const locked = lockedStep(i)
          const n = String(x.position)
          const errorId = `df-step-${n}-error`
          const said = (bad: boolean) => (bad ? { 'aria-invalid': true, 'aria-describedby': errorId } : {})
          const long = errors[i] !== null && errors[i] !== words.errors.later && errors[i] !== words.errors.subject
          const summary = locked ? words.lockedStep : !x.enabled ? words.stepOff : `${i === 0 && (!form.enabled || level === 'youSend') ? words.byHand : fill(words.after, { delay: delayText(x.delayMinutes) })} · ${channelText(x.channel)}${automatic && x.discountPercent ? ` · ${fill(words.percentOff, { percent: String(x.discountPercent) })}` : ''}`
          return (
            <section key={x.position} className="df-cart-card df-reminders-step" data-shown={shown === i || undefined} aria-labelledby={`df-step-${n}`}>
              <div className="df-reminders-step-head">
                <span className="df-reminders-n" aria-hidden="true">
                  {n}
                </span>
                <span className="df-carts-cell">
                  <strong id={`df-step-${n}`}>{fill(words.step, { n })}</strong>
                  <span className="df-carts-sub">{summary}</span>
                </span>
                <button type="button" className="df-button" aria-pressed={shown === i} aria-label={fill(words.previewStep, { n })} onClick={() => setShown(i)}>
                  {words.preview}
                </button>
                {i > 0 && !locked && (
                  <button type="button" role="switch" className="df-reminders-switch" aria-checked={x.enabled} aria-label={fill(words.stepOn, { n })} disabled={ro} onClick={() => setStep(i, { enabled: !x.enabled })}>
                    <span />
                  </button>
                )}
              </div>
              {!locked && x.enabled && (
                <div className="df-reminders-fields">
                  <div className="df-reminders-row">
                    <label>
                      <span>{words.delay}</span>
                      <select value={x.delayMinutes} disabled={ro} {...said(errors[i] === words.errors.later)} onChange={(e) => setStep(i, { delayMinutes: Number(e.target.value) })}>
                        {reminderDelays.map((d) => (
                          <option key={d} value={d}>
                            {delayText(d)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {country === 'IN' && automatic && (
                      <label>
                        <span>{words.sendBy}</span>
                        <select value={x.channel} disabled={ro} onChange={(e) => setStep(i, { channel: e.target.value === 'whatsapp' ? 'whatsapp' : 'email' })}>
                          <option value="email">{words.email}</option>
                          <option value="whatsapp">{words.whatsapp}</option>
                        </select>
                      </label>
                    )}
                    {automatic && (
                      <label>
                        <span>{words.discount}</span>
                        <select value={x.discountPercent ?? 0} disabled={ro} onChange={(e) => setStep(i, { discountPercent: Number(e.target.value) || null })}>
                          <option value={0}>{words.noDiscount}</option>
                          {reminderPercents.map((p) => (
                            <option key={p} value={p}>
                              {fill(words.percentOff, { percent: String(p) })}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  {x.channel === 'email' && (
                    <label className="df-reminders-wide">
                      <span>{words.subject}</span>
                      <input value={x.subject} readOnly={ro} maxLength={reminderText.subject} {...said(errors[i] === words.errors.subject || (long && x.subject.trim().length > reminderText.subject))} onChange={(e) => setStep(i, { subject: e.target.value })} />
                    </label>
                  )}
                  <label className="df-reminders-wide">
                    <span>{words.message}</span>
                    <textarea value={x.body} readOnly={ro} rows={2} maxLength={reminderText.body} {...said(long && x.body.trim().length > reminderText.body)} onChange={(e) => setStep(i, { body: e.target.value })} />
                    <span className="df-carts-sub">{words.messageHelp}</span>
                  </label>
                  {automatic && x.discountPercent && <span className="df-carts-sub">{fill(words.codeNote, { percent: String(x.discountPercent) })}</span>}
                  {errors[i] && (
                    <span id={errorId} className="df-carts-error" role="alert">
                      {errors[i]}
                    </span>
                  )}
                </div>
              )}
            </section>
          )
        })}

        <section className="df-cart-card" aria-labelledby="df-reminders-who">
          <h2 id="df-reminders-who">{words.who}</h2>
          <label className="df-reminders-inline">
            <span>{words.minimum}</span>
            <span className="df-reminders-affixed">
              <input value={form.minimum} inputMode="decimal" readOnly={ro} aria-invalid={minimumBad || undefined} aria-describedby={minimumBad ? 'df-reminders-minimum-error' : undefined} onChange={(e) => set({ minimum: e.target.value.replace(/[^\d.]/g, '') })} />
              <span>{currency}</span>
            </span>
          </label>
          {minimumBad && (
            <span id="df-reminders-minimum-error" className="df-carts-error" role="alert">
              {words.errors.minimum}
            </span>
          )}
          {(
            [
              ['skipOutOfStock', words.rules.skipOutOfStock],
              ['quietHours', words.rules.quietHours],
              ['weeklyCap', words.rules.weeklyCap],
            ] as const
          ).map(([key, rule]) => (
            <label key={key} className="df-reminders-rule">
              <input type="checkbox" checked={form[key]} disabled={ro} onChange={() => set({ [key]: !form[key] })} />
              <span className="df-carts-cell">
                <strong>{rule.title}</strong>
                <span className="df-carts-sub">{rule.body}</span>
              </span>
            </label>
          ))}
          <label className="df-reminders-rule">
            <input type="checkbox" checked disabled />
            <span className="df-carts-cell">
              <strong>{words.rules.stop.title}</strong>
              <span className="df-carts-sub">{words.rules.stop.body}</span>
            </span>
          </label>
          <p className="df-carts-note">
            <strong>{consent.title}</strong> {consent.body}
          </p>
        </section>
      </div>

      {step && (
        <aside className="df-reminders-preview" aria-label={words.previewLabel}>
          <div className="df-reminders-preview-head">
            <span className="df-eyebrow">{fill(words.previewOf, { n: String(step.position), channel: channelText(step.channel) })}</span>
            {!ro && (
              <button type="button" className="df-button" disabled={testBlock !== null} aria-describedby={testBlock ? 'df-reminders-test-note' : undefined} onClick={() => {
                  setTestError(null)
                  setTesting(true)
                }}>
                {words.test}
              </button>
            )}
          </div>
          {!ro && testBlock && (
            <span id="df-reminders-test-note" className="df-carts-sub">
              {testBlock}
            </span>
          )}
          {step.channel === 'email' ? (
            <div className="df-reminders-mail">
              <div className="df-reminders-mail-head">
                <span>{fill(words.from, { store: storeName })}</span>
                <strong>{step.subject || words.noSubject}</strong>
              </div>
              <div className="df-reminders-mail-body">
                <strong>{storeName}</strong>
                <span>{words.hi}</span>
                <span>{step.body}</span>
                <span className="df-reminders-lines">{words.lines}</span>
                {code && <span className="df-reminders-code">{fill(words.code, { percent: String(code) })}</span>}
                <span className="df-reminders-cta">{words.cta}</span>
                <span className="df-carts-sub">{fill(words.foot, { store: storeName })}</span>
              </div>
            </div>
          ) : (
            <div className="df-reminders-wa">
              <span className="df-carts-sub">{fill(words.waFrom, { store: storeName })}</span>
              <p>
                {words.hi} {step.body}
                {code ? ` ${fill(words.code, { percent: String(code) })}` : ''}
              </p>
              <span className="df-carts-sub">{words.waStop}</span>
            </div>
          )}
        </aside>
      )}

      {stale && (
        <p className="df-carts-note df-carts-note--warning df-reminders-span" role="alert">
          <strong>{words.stale}</strong>{' '}
          <button type="button" className="df-button" onClick={() => {
              setStale(false)
              load()
            }}>
            {words.reload}
          </button>
        </p>
      )}
      {problem && <p className="df-carts-note df-carts-note--danger df-reminders-span" role="alert">{problem}</p>}
      {saved && !dirty && <p className="df-carts-note df-reminders-span" role="status">{saved}</p>}
      {tested && <p className="df-carts-note df-reminders-span" role="status">{tested}</p>}

      {dirty && !ro && (
        <div className="df-reminders-bar">
          <span>
            <strong>{words.unsaved}</strong>
          </span>
          <span className="df-reminders-bar-actions">
            <button type="button" className="df-button" disabled={saving} onClick={() => {
                setForm(JSON.parse(orig) as Form)
                setProblem(null)
                setStale(false)
                setSaved(null)
                setTested(null)
              }}>
              {words.discard}
            </button>
            <button type="button" className="df-button df-button--primary" disabled={saving} onClick={save}>
              {saving ? words.saving : words.save}
            </button>
          </span>
        </div>
      )}

      {testing && step && (
        <ConfirmDialog
          open
          title={fill(words.testTitle, { n: String(step.position) })}
          target={email}
          consequence={words.testBody}
          confirmLabel={words.testSend}
          cancelLabel={words.cancel}
          error={testError}
          blocked={sending ? words.testSending : null}
          onConfirm={() => {
            if (sample) return setTesting(false)
            // One test per press: the dialog waits while one is on its way, so a double click sends one email.
            if (sending) return
            setSending(true)
            void sendTestReminder(step.position)
              .then(
                () => {
                  setTesting(false)
                  setTested(fill(words.testSent, { email }))
                },
                (error: unknown) => setTestError(isApiError(error, 'RATE_LIMITED') ? words.testTooMany : cartRefusal(error, access.canUpgrade)),
              )
              .finally(() => setSending(false))
          }}
          onCancel={() => setTesting(false)}
        />
      )}
    </div>
  )
}

import { isApiError } from '@dripfunnel/shared/graphql'
import { ErrorState, LoadingState } from '@dripfunnel/shared/ui'
import { Link, useBlocker } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { reminderDelays, reminderText } from '../../api/carts'
import { loadWishlistReminderSettings, saveWishlistReminderSettings, type WishlistReminderSettings, type WishlistReminderStep } from '../../api/wishlists'
import { fill, messages } from '../../messages'
import '../common/switch.css'
import { cartRefusal } from './cartActions'
import type { CartAccess } from './cartView'
import { stepErrors } from './RemindersPane'

// The Wishlists Reminders tab (FIRST-RELEASE §9): up to three emails after a shopper last saved, who gets them, and a preview.

const words = messages.carts.wishlists.reminders
const shared = messages.carts.reminders

interface Form {
  enabled: boolean
  skipOutOfStock: boolean
  quietHours: boolean
  weeklyCap: boolean
  steps: WishlistReminderStep[]
}

type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; settings: WishlistReminderSettings }

const formOf = (s: WishlistReminderSettings): Form => ({
  enabled: s.enabled,
  skipOutOfStock: s.skipOutOfStock,
  quietHours: s.quietHours,
  weeklyCap: s.weeklyCap,
  steps: [...s.steps].sort((a, b) => a.position - b.position).map((x) => ({ ...x })),
})

export const WishlistRemindersPane = ({ access, forced, sample, storeName }: { access: CartAccess; forced: 'loading' | 'error' | null; sample: WishlistReminderSettings | null; storeName: string }) => {
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [form, setForm] = useState<Form | null>(null)
  const [orig, setOrig] = useState('')
  const [shown, setShown] = useState(0)
  const [problem, setProblem] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const latest = useRef(0)

  const load = useCallback(() => {
    const mine = ++latest.current
    const ready = (settings: WishlistReminderSettings) => {
      const f = formOf(settings)
      setForm(f)
      setOrig(JSON.stringify(f))
      setView({ kind: 'ready', settings })
    }
    if (forced === 'loading') return setView({ kind: 'loading' })
    if (forced === 'error') return setView({ kind: 'error' })
    if (sample) return ready(sample)
    setView({ kind: 'loading' })
    void loadWishlistReminderSettings().then(
      (settings) => {
        if (mine !== latest.current) return
        if (settings) ready(settings)
        else setView({ kind: 'error' })
      },
      () => mine === latest.current && setView({ kind: 'error' }),
    )
  }, [forced, sample])
  useEffect(load, [load])

  const dirty = form !== null && JSON.stringify(form) !== orig
  useBlocker({ shouldBlockFn: () => dirty && !window.confirm(words.leave), enableBeforeUnload: () => dirty })

  if (view.kind === 'error') return <ErrorState title={words.error} body={messages.carts.error.body} retry={{ label: messages.carts.error.retry, onRetry: load }} />
  if (view.kind === 'loading' || !form) return <LoadingState label={words.loading} />

  const { settings } = view
  const level = settings.level
  const automatic = level === 'automatic'
  const ro = !access.canEdit
  const errors = stepErrors(form.steps, automatic)
  const set = (patch: Partial<Form>) => {
    setSaved(null)
    setForm({ ...form, ...patch })
  }
  const setStep = (i: number, patch: Partial<WishlistReminderStep>) => set({ steps: form.steps.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
  const delayText = (m: number) => shared.delays[String(m) as keyof typeof shared.delays] ?? String(m)
  const lockedStep = (i: number) => !automatic && i > 0

  const save = () => {
    const bad = errors.findIndex(Boolean)
    if (bad >= 0) return setShown(bad)
    if (sample) {
      setOrig(JSON.stringify(form))
      return setSaved(words.saved)
    }
    setSaving(true)
    setProblem(null)
    const input = { ...form, steps: form.steps.map((x) => ({ ...x, subject: x.subject.trim(), body: x.body.trim() })) }
    void saveWishlistReminderSettings(input, settings.revision)
      .then((revision) => {
        setOrig(JSON.stringify(form))
        setView({ kind: 'ready', settings: { ...settings, ...input, revision } })
        setSaved(form.enabled && automatic ? words.savedTimings : words.saved)
      })
      .catch((error: unknown) => (isApiError(error, 'STALE_REVISION') ? setStale(true) : setProblem(cartRefusal(error, access.canUpgrade))))
      .finally(() => setSaving(false))
  }

  const step = form.steps[shown] ?? form.steps[0]

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
                {shared.seePlans}
              </Link>
            ) : (
              <span className="df-carts-sub">{shared.askOwner}</span>
            )
          ) : (
            <button type="button" role="switch" className="df-switch" aria-checked={form.enabled} aria-label={words.auto} disabled={ro} onClick={() => set({ enabled: !form.enabled })}>
              <span aria-hidden="true" />
            </button>
          )}
        </section>

        {form.steps.map((x, i) => {
          const locked = lockedStep(i)
          const n = String(x.position)
          const errorId = `df-wstep-${n}-error`
          const said = (bad: boolean) => (bad ? { 'aria-invalid': true, 'aria-describedby': errorId } : {})
          const long = errors[i] !== null && errors[i] !== shared.errors.later && errors[i] !== shared.errors.subject
          const summary = locked ? shared.lockedStep : !x.enabled ? shared.stepOff : i === 0 && (!form.enabled || level === 'youSend') ? shared.byHand : fill(words.after, { delay: delayText(x.delayMinutes) })
          return (
            <section key={x.position} className="df-cart-card df-reminders-step" data-shown={shown === i || undefined} aria-labelledby={`df-wstep-${n}`}>
              <div className="df-reminders-step-head">
                <span className="df-reminders-n" aria-hidden="true">
                  {n}
                </span>
                <span className="df-carts-cell">
                  <strong id={`df-wstep-${n}`}>{fill(words.step, { n })}</strong>
                  <span className="df-carts-sub">{summary}</span>
                </span>
                <button type="button" className="df-button" aria-pressed={shown === i} aria-label={fill(shared.previewStep, { n })} onClick={() => setShown(i)}>
                  {shared.preview}
                </button>
                {i > 0 && !locked && (
                  <button type="button" role="switch" className="df-switch" aria-checked={x.enabled} aria-label={fill(words.stepOn, { n })} disabled={ro} onClick={() => setStep(i, { enabled: !x.enabled })}>
                    <span aria-hidden="true" />
                  </button>
                )}
              </div>
              {!locked && x.enabled && (
                <div className="df-reminders-fields">
                  <div className="df-reminders-row">
                    <label>
                      <span>{words.delay}</span>
                      <select value={x.delayMinutes} disabled={ro} {...said(errors[i] === shared.errors.later)} onChange={(e) => setStep(i, { delayMinutes: Number(e.target.value) })}>
                        {reminderDelays.map((d) => (
                          <option key={d} value={d}>
                            {delayText(d)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="df-reminders-wide">
                    <span>{shared.subject}</span>
                    <input value={x.subject} readOnly={ro} maxLength={reminderText.subject} {...said(errors[i] === shared.errors.subject || (long && x.subject.trim().length > reminderText.subject))} onChange={(e) => setStep(i, { subject: e.target.value })} />
                  </label>
                  <label className="df-reminders-wide">
                    <span>{shared.message}</span>
                    <textarea value={x.body} readOnly={ro} rows={2} maxLength={reminderText.body} {...said(long && x.body.trim().length > reminderText.body)} onChange={(e) => setStep(i, { body: e.target.value })} />
                    <span className="df-carts-sub">{words.messageHelp}</span>
                  </label>
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

        <section className="df-cart-card" aria-labelledby="df-wreminders-who">
          <h2 id="df-wreminders-who">{words.who}</h2>
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
        </section>
      </div>

      {step && (
        <aside className="df-reminders-preview" aria-label={shared.previewLabel}>
          <div className="df-reminders-preview-head">
            <span className="df-eyebrow">{fill(shared.previewOf, { n: String(step.position), channel: words.email })}</span>
          </div>
          <div className="df-reminders-mail">
            <div className="df-reminders-mail-head">
              <span>{fill(shared.from, { store: storeName })}</span>
              <strong>{step.subject || shared.noSubject}</strong>
            </div>
            <div className="df-reminders-mail-body">
              <strong>{storeName}</strong>
              <span>{shared.hi}</span>
              <span>{step.body}</span>
              <span className="df-reminders-lines">{words.lines}</span>
              <span className="df-reminders-cta">{words.cta}</span>
              <span className="df-carts-sub">{fill(words.foot, { store: storeName })}</span>
            </div>
          </div>
        </aside>
      )}

      {stale && (
        <p className="df-carts-note df-carts-note--warning df-reminders-span" role="alert">
          <strong>{shared.stale}</strong>{' '}
          <button type="button" className="df-button" onClick={() => {
              setStale(false)
              load()
            }}>
            {shared.reload}
          </button>
        </p>
      )}
      {problem && <p className="df-carts-note df-carts-note--danger df-reminders-span" role="alert">{problem}</p>}
      {saved && !dirty && <p className="df-carts-note df-reminders-span" role="status">{saved}</p>}

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
              }}>
              {shared.discard}
            </button>
            <button type="button" className="df-button df-button--primary" disabled={saving} onClick={save}>
              {saving ? shared.saving : shared.save}
            </button>
          </span>
        </div>
      )}
    </div>
  )
}

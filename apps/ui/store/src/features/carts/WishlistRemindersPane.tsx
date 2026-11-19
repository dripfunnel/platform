import { isApiError } from '@dripfunnel/shared/graphql'
import { ErrorState, LoadingState } from '@dripfunnel/shared/ui'
import { useBlocker } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { reminderDelays, reminderText } from '../../api/carts'
import { loadWishlistReminderSettings, saveWishlistReminderSettings, type WishlistReminderSettings, type WishlistReminderStep } from '../../api/wishlists'
import { fill, messages } from '../../messages'
import { cartRefusal } from './cartActions'
import type { CartAccess } from './cartView'
import { AutoCard, FormNotes, RuleChecks, SaveBar, StepHead } from './ReminderParts'
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
        <AutoCard title={words.auto} summary={level === 'youSend' ? words.autoYouSend : form.enabled ? (automatic ? words.autoOn : words.autoOne) : words.autoOff} level={level} on={form.enabled} readOnly={ro} canUpgrade={access.canUpgrade} seePlans={shared.seePlans} askOwner={shared.askOwner} onToggle={() => set({ enabled: !form.enabled })} />

        {form.steps.map((x, i) => {
          const locked = lockedStep(i)
          const n = String(x.position)
          const errorId = `df-wstep-${n}-error`
          const said = (bad: boolean) => (bad ? { 'aria-invalid': true, 'aria-describedby': errorId } : {})
          const long = errors[i] !== null && errors[i] !== shared.errors.later && errors[i] !== shared.errors.subject
          const summary = locked ? shared.lockedStep : !x.enabled ? shared.stepOff : i === 0 && (!form.enabled || level === 'youSend') ? shared.byHand : fill(words.after, { delay: delayText(x.delayMinutes) })
          return (
            <section key={x.position} className="df-cart-card df-reminders-step" data-shown={shown === i || undefined} aria-labelledby={`df-wstep-${n}`}>
              <StepHead idPrefix="df-wstep" n={n} name={fill(words.step, { n })} summary={summary} shown={shown === i} previewLabel={fill(shared.previewStep, { n })} previewText={shared.preview} switchLabel={fill(words.stepOn, { n })} showSwitch={i > 0 && !locked} on={x.enabled} readOnly={ro} onPreview={() => setShown(i)} onToggle={() => setStep(i, { enabled: !x.enabled })} />
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
          <RuleChecks rules={words.rules} form={form} readOnly={ro} onToggle={(key) => set({ [key]: !form[key] })} />
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

      <FormNotes stale={stale} staleText={shared.stale} reloadText={shared.reload} problem={problem} saved={dirty ? null : saved} onReload={() => {
          setStale(false)
          load()
        }} />

      {dirty && !ro && (
        <SaveBar unsaved={words.unsaved} discard={shared.discard} save={shared.save} saving={shared.saving} busy={saving} onSave={save} onDiscard={() => {
            setForm(JSON.parse(orig) as Form)
            setProblem(null)
            setStale(false)
            setSaved(null)
          }} />
      )}
    </div>
  )
}
